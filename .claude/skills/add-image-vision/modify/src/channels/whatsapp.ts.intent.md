# Intent: src/channels/whatsapp.ts

## What Changed
- Added `downloadMediaMessage` import from Baileys
- Added `normalizeMessageContent` import from Baileys for unwrapping container types
- Added `GROUPS_DIR` to config import
- Added `processImage` import from `../image.js`
- Added `transcribeAudioMessage` import from `../transcription.js`
- Uses `normalizeMessageContent(msg.message)` to unwrap viewOnce, ephemeral, edited messages
- Changed `const content =` to `let content =` (allows mutation by image/voice/PDF handlers)
- Added PDF download block before image block
- Added image download/process block between content extraction and `!content` guard
- Added voice transcription block (checks `audioMessage?.ptt === true`)

## Key Sections
- **Imports** (top of file): New imports for downloadMediaMessage, normalizeMessageContent, processImage, transcribeAudioMessage, GROUPS_DIR
- **messages.upsert handler** (inside `connectInternal`): normalizeMessageContent call, PDF/image/voice blocks inserted after text extraction, before the `!content` skip guard

## Invariants (must-keep)
- WhatsAppChannel class structure and all existing methods
- Connection lifecycle (connect, reconnect with exponential backoff, disconnect)
- LID-to-phone translation logic
- Outgoing message queue and flush logic
- Group metadata sync with 24h cache
- The `!content` guard must remain AFTER media blocks (they provide content for otherwise-empty messages)
- Local timestamp format (no Z suffix) for cursor compatibility
