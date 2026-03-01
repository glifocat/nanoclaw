# Intent: src/channels/whatsapp.ts modifications

## What changed
Added voice message transcription support. When a WhatsApp voice note (PTT audio) arrives, it is downloaded and transcribed before being stored as message content. Also uses `normalizeMessageContent()` from Baileys to unwrap container types (viewOnce, ephemeral, edited) before checking message fields.

## Key sections

### Imports (top of file)
- Added: `normalizeMessageContent` from `@whiskeysockets/baileys`
- Added: `downloadMediaMessage` from `@whiskeysockets/baileys`
- Added: `processImage` from `../image.js`
- Added: `transcribeAudioMessage` from `../transcription.js`
- Added: `GROUPS_DIR` from `../config.js`

### messages.upsert handler (inside connectInternal)
- Added: `normalizeMessageContent(msg.message)` call to unwrap container types before reading fields
- Changed: `let content` instead of `const content` to allow mutation by voice/image/PDF handlers
- Added: PDF download block (checks `documentMessage?.mimetype === 'application/pdf'`)
- Added: Image download/process block (checks `normalized.imageMessage`)
- Added: Voice transcription block (checks `audioMessage?.ptt === true`)
  - Success: `content = '[Voice: <transcript>]'`
  - Null result: `content = '[Voice Message - transcription unavailable]'`
  - Error: `content = '[Voice Message - transcription failed]'`
- Note: Voice/image/PDF blocks run BEFORE the `!content` guard so media-only messages aren't skipped

## Invariants (must-keep)
- All existing text message handling (conversation, extendedTextMessage, imageMessage caption, videoMessage caption)
- Connection lifecycle (connect, reconnect, disconnect) with exponential backoff
- LID translation logic (translateJid, lidToPhoneMap)
- Outgoing message queue with flush on reconnect
- Group metadata sync with 24h cache
- sendMessage prefix logic (ASSISTANT_HAS_OWN_NUMBER check)
- setTyping, ownsJid, isConnected — all unchanged
- Local timestamp format (no Z suffix) for message cursor compatibility
