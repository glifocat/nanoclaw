# Intent: src/channels/whatsapp.test.ts modifications

## What changed
Added mocks for transcription module, image module, and downloadMediaMessage. Added test cases for voice message handling, image processing, and PDF downloads.

## Key sections

### Mocks (top of file)
- Added: `vi.mock('../transcription.js', ...)` with `transcribeAudioMessage` mock
- Added: `vi.mock('../image.js', ...)` with `isImageMessage` and `processImage` mocks
- Added: `GROUPS_DIR` to config mock
- Modified: `fs` mock to include `writeFileSync` as vi.fn()
- Modified: Baileys mock to include `normalizeMessageContent` (pass-through), `downloadMediaMessage` (returns Buffer)
- Modified: fake socket factory to include `updateMediaMessage` method

### Imports
- Added: `downloadMediaMessage` from `@whiskeysockets/baileys`
- Added: `transcribeAudioMessage` from `../transcription.js`
- Added: `isImageMessage`, `processImage` from `../image.js`

### Test cases (inside "message handling" describe block)
- "transcribes voice messages" — expects `[Voice: Hello this is a voice message]`
- "falls back when transcription returns null" — expects `[Voice Message - transcription unavailable]`
- "falls back when transcription throws" — expects `[Voice Message - transcription failed]`
- Image and PDF test cases also present (shared with other skills)

## Invariants (must-keep)
- All existing test cases for text, extendedTextMessage, imageMessage caption, videoMessage caption
- All connection lifecycle tests (connect, disconnect, reconnect, QR auth)
- All LID translation tests
- All outgoing queue tests
- All group metadata sync tests
- All ownsJid, setTyping, channel properties tests
- Test helpers (createTestOpts, triggerConnection, triggerDisconnect, triggerMessages, connectChannel)
