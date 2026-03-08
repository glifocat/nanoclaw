import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';

const execFileAsync = promisify(execFile);
const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

async function convertOggToWav(oggBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const id = `nanoclaw-voice-${Date.now()}`;
  const tmpOgg = path.join(tmpDir, `${id}.ogg`);
  const tmpWav = path.join(tmpDir, `${id}.wav`);

  try {
    fs.writeFileSync(tmpOgg, oggBuffer);
    await execFileAsync('ffmpeg', [
      '-i', tmpOgg,
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      '-y', tmpWav,
    ], { timeout: 30_000 });
    return fs.readFileSync(tmpWav);
  } finally {
    for (const f of [tmpOgg, tmpWav]) {
      try { fs.unlinkSync(f); } catch { /* best effort cleanup */ }
    }
  }
}

async function transcribeAudio(
  audioBuffer: Buffer,
): Promise<string | null> {
  const env = readEnvFile(['TRANSCRIPTION_API_KEY', 'TRANSCRIPTION_BASE_URL', 'TRANSCRIPTION_MODEL']);
  const apiKey = env.TRANSCRIPTION_API_KEY || 'not-needed';
  const baseURL = env.TRANSCRIPTION_BASE_URL;
  const model = env.TRANSCRIPTION_MODEL || 'whisper-1';

  if (!baseURL) {
    console.warn('TRANSCRIPTION_BASE_URL not set in .env');
    return null;
  }

  try {
    // Convert ogg/opus to 16kHz mono WAV for maximum endpoint compatibility
    const wavBuffer = await convertOggToWav(audioBuffer);

    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    const openai = new OpenAI({ apiKey, baseURL });

    const file = await toFile(wavBuffer, 'voice.wav', {
      type: 'audio/wav',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: model,
      response_format: 'text',
    });

    // When response_format is 'text', the API returns a plain string
    return transcription as unknown as string;
  } catch (err) {
    console.error('Transcription failed:', err);
    return null;
  }
}

export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      console.error('Failed to download audio message');
      return FALLBACK_MESSAGE;
    }

    console.log(`Downloaded audio message: ${buffer.length} bytes`);

    const transcript = await transcribeAudio(buffer);

    if (!transcript) {
      return FALLBACK_MESSAGE;
    }

    return transcript.trim();
  } catch (err) {
    console.error('Transcription error:', err);
    return FALLBACK_MESSAGE;
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}
