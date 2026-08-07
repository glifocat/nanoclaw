/**
 * Transcription module — channel-agnostic audio → text.
 *
 * MVP rule (Spark 2026-08-06): treat **every** inbound audio attachment as a
 * voice note (type===audio or mimeType audio/*). No speech-vs-music scoring.
 *
 * Runs as a router preprocessor before agent resolution. Supports:
 *  - chat-sdk path: attachment `data` as base64 (Mattermost)
 *  - native path: `localPath` under DATA_DIR (WhatsApp-style)
 *
 * Uses ffmpeg + OpenAI-compatible POST /v1/audio/transcriptions.
 * Prepends `[Voice: <transcript>]` to message text for the agent.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DATA_DIR } from '../../config.js';
import { log } from '../../log.js';
import { setMessagePreprocessor } from '../../router.js';
import { transcribeAudioFile } from './transcribe.js';

interface Attachment {
  type?: string;
  name?: string;
  mimeType?: string;
  localPath?: string;
  data?: string;
  isVoiceNote?: boolean;
  transcript?: string;
  size?: number;
}

const FALLBACK_TEXT = '[Voice Message - transcription failed]';

function isAudioAttachment(a: Attachment): boolean {
  if (!a || typeof a !== 'object') return false;
  // Explicit opt-in (WhatsApp ptt, etc.) still counts.
  if (a.isVoiceNote === true) return true;
  if (a.type === 'audio') return true;
  if (typeof a.mimeType === 'string' && a.mimeType.toLowerCase().startsWith('audio/')) {
    return true;
  }
  return false;
}

function extFromAttachment(a: Attachment): string {
  const name = typeof a.name === 'string' ? a.name : '';
  const fromName = path.extname(name);
  if (fromName) return fromName;
  const mime = (a.mimeType || '').toLowerCase();
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return '.m4a';
  if (mime.includes('ogg') || mime.includes('opus')) return '.ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('webm')) return '.webm';
  return '.audio';
}

/** Materialize attachment bytes to a temp file; caller must unlink. */
function materializeAudio(a: Attachment): string | null {
  if (typeof a.localPath === 'string' && a.localPath.length > 0) {
    const abs = path.isAbsolute(a.localPath)
      ? a.localPath
      : path.join(DATA_DIR, a.localPath);
    if (fs.existsSync(abs)) return abs;
    log.warn('Audio localPath missing on disk', { localPath: a.localPath, abs });
  }
  if (typeof a.data === 'string' && a.data.length > 0) {
    try {
      const buf = Buffer.from(a.data, 'base64');
      const tmp = path.join(
        os.tmpdir(),
        `nanoclaw-voice-in-${Date.now()}-${process.pid}${extFromAttachment(a)}`,
      );
      fs.writeFileSync(tmp, buf);
      return tmp;
    } catch (err) {
      log.error('Failed to decode base64 audio attachment', { err, name: a.name });
      return null;
    }
  }
  return null;
}

setMessagePreprocessor(async (event) => {
  if (typeof event.message.content !== 'string') return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.message.content);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;

  const attachments = parsed.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return;

  const voiceNotes = (attachments as Attachment[]).filter(isAudioAttachment);
  if (voiceNotes.length === 0) return;

  const transcripts: string[] = [];
  for (const att of voiceNotes) {
    const materialPath = materializeAudio(att);
    if (!materialPath) {
      transcripts.push(FALLBACK_TEXT);
      continue;
    }
    const isTemp = materialPath.startsWith(os.tmpdir());
    try {
      const transcript = await transcribeAudioFile(materialPath);
      if (transcript) {
        att.transcript = transcript;
        transcripts.push(`[Voice: ${transcript}]`);
        log.info('Transcribed voice note', {
          length: transcript.length,
          name: att.name,
          type: att.type,
          mimeType: att.mimeType,
        });
      } else {
        transcripts.push(FALLBACK_TEXT);
      }
    } finally {
      if (isTemp) {
        try {
          fs.unlinkSync(materialPath);
        } catch {
          /* best effort */
        }
      }
    }
  }

  const existingText = typeof parsed.text === 'string' ? parsed.text : '';
  const joined = transcripts.join(' ');
  parsed.text = existingText ? `${joined} ${existingText}` : joined;

  event.message.content = JSON.stringify(parsed);
});
