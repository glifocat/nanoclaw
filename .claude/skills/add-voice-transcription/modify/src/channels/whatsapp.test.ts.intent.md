# Intent: src/channels/whatsapp.test.ts modifications

## What changed
Added mock and test cases for voice message transcription.

## Key sections

### Mocks (top of file)
- Added: `vi.mock('../transcription.js')` with `isVoiceMessage` and `transcribeAudioMessage` mocks

### Imports (after mocks)
- Added: `import { transcribeAudioMessage } from '../transcription.js'`

### Test cases (inside "message handling" describe block)
- Replaced: "handles message with no extractable text (e.g. voice note without caption)" → now three voice tests
- Added: "transcribes voice messages" — expects `[Voice: Hello this is a voice message]`
- Added: "falls back when transcription returns null" — expects `[Voice Message - transcription unavailable]`
- Added: "falls back when transcription throws" — expects `[Voice Message - transcription failed]`

## Invariants (must-keep)
- All existing test cases for text, extendedTextMessage, imageMessage caption, videoMessage unchanged
- All connection lifecycle tests unchanged
- All LID translation tests unchanged
- All outgoing queue tests unchanged
- All group metadata sync tests unchanged
- All ownsJid and setTyping tests unchanged
- Test helpers (createTestOpts, triggerConnection, triggerDisconnect, triggerMessages, connectChannel) unchanged

## If merge conflicts occur
The mock section at the top is most conflict-prone. Voice transcription adds only:
- `../transcription.js` mock with `isVoiceMessage` and `transcribeAudioMessage`
Other skills may add their own mocks (e.g. `../image.js`, `downloadMediaMessage`) — these are independent and can coexist.
