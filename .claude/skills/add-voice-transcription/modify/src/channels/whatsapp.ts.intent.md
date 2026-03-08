# Intent: src/channels/whatsapp.ts modifications

## What changed
Added voice message transcription support. When a WhatsApp voice note (PTT audio) arrives, it is downloaded and transcribed via any OpenAI-compatible endpoint before being stored as message content.

## Key sections

### Imports (top of file)
- Added: `isVoiceMessage`, `transcribeAudioMessage` from `../transcription.js`

### messages.upsert handler (inside connectInternal)
- Added: `const isVoice = isVoiceMessage(msg)` after PDF handling
- Changed: empty-content skip from `if (!content) continue` to `if (!content && !isVoice) continue`
- Added: `let finalContent = content` variable to allow voice transcription to override text content
- Added: try/catch block calling `transcribeAudioMessage(msg, this.sock)`
  - Success: `finalContent = '[Voice: <transcript>]'`
  - Null result: `finalContent = '[Voice Message - transcription unavailable]'`
  - Error: `finalContent = '[Voice Message - transcription failed]'`
- Changed: `this.opts.onMessage()` call uses `finalContent` instead of `content`

## Dependencies
This template assumes add-image-vision and add-pdf-reader are already applied. It includes:
- `normalizeMessageContent`, `downloadMediaMessage` from Baileys
- `GROUPS_DIR` from config
- `isImageMessage`/`processImage` from `../image.js`
- PDF handling block with `downloadMediaMessage`
- try/catch around each message in `messages.upsert`
- `scheduleReconnect` with exponential backoff
- `syncGroups` public method

## Invariants (must-keep)
- All existing message handling (conversation, extendedTextMessage, imageMessage, videoMessage) unchanged
- Image handling block (`isImageMessage` → `processImage`) unchanged
- PDF handling block (`documentMessage?.mimetype === 'application/pdf'`) unchanged
- Connection lifecycle (connect, reconnect via scheduleReconnect, disconnect) unchanged
- LID translation logic unchanged
- Outgoing message queue unchanged
- Group metadata sync unchanged
- sendMessage prefix logic unchanged
- setTyping, ownsJid, isConnected — all unchanged

## If merge conflicts occur
The `messages.upsert` handler is the conflict zone. Order within the registered-group block:
1. Content extraction (conversation, extendedTextMessage, etc.)
2. Image handling (`isImageMessage` check)
3. PDF handling (`documentMessage?.mimetype` check)
4. Voice check + empty-content skip (`isVoice`, `!content && !isVoice`)
5. Sender/fromMe/isBotMessage detection
6. Voice transcription (`if (isVoice)` block)
7. `onMessage` call with `finalContent`
