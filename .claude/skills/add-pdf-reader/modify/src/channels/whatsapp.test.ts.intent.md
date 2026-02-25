# Intent: src/channels/whatsapp.test.ts modifications

## What changed
Added mock for downloadMediaMessage and test cases for PDF attachment handling.

## Key sections

### Mocks (top of file)
- Modified: config mock to export `GROUPS_DIR` (needed for PDF save path)
- Modified: fs mock to include `writeFileSync` as vi.fn()
- Modified: Baileys mock to export `downloadMediaMessage` as vi.fn() returning a default Buffer
- Modified: fake socket factory to include `updateMediaMessage` (used by downloadMediaMessage options)
- Added: import for `downloadMediaMessage` from `@whiskeysockets/baileys` for test assertions

### Test cases (inside "message handling" describe block)
- Added: "downloads and injects PDF attachment path" -- verifies PDF download, save, and content replacement
- Added: "handles PDF download failure gracefully" -- verifies error handling (message is skipped since content remains empty)

## Invariants (must-keep)
- All existing test cases unchanged
- All existing mocks unchanged (only additive changes)
- All existing test helpers unchanged
- All describe blocks preserved
