# Intent: src/channels/whatsapp.test.ts modifications

## What changed
Added mock for downloadMediaMessage, normalizeMessageContent, image module, transcription module, and test cases for PDF/image/voice attachment handling.

## Key sections

### Mocks (top of file)
- Modified: config mock to export `GROUPS_DIR`
- Added: `../transcription.js` mock with `transcribeAudioMessage`
- Added: `../image.js` mock with `isImageMessage` and `processImage`
- Modified: `fs` mock to include `writeFileSync` as vi.fn()
- Modified: Baileys mock to export `downloadMediaMessage`, `normalizeMessageContent`
- Modified: fake socket factory to include `updateMediaMessage`
- Added: imports for `downloadMediaMessage`, `transcribeAudioMessage`, `isImageMessage`, `processImage`

### Test cases (inside "message handling" describe block)
- "downloads and injects PDF attachment path" — verifies PDF download, save, and content replacement
- "handles PDF download failure gracefully" — verifies error handling (message skipped since content remains empty)
- Image and voice test cases also present (shared with other skills)

## Invariants (must-keep)
- All existing test cases unchanged
- All existing mocks unchanged (only additive changes)
- All existing test helpers unchanged
- All describe blocks preserved
