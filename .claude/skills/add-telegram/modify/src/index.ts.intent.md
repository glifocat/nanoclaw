# Intent: src/index.ts modifications

## What changed
Refactored from single WhatsApp channel to multi-channel architecture using the `Channel` interface. Added Telegram as an optional second channel. Also includes datePrefix injection, image attachment threading, and container-runtime abstraction.

## Key sections

### Imports (top of file)
- Added: `TelegramChannel` from `./channels/telegram.js`
- Added: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ONLY` from `./config.js`
- Added: `TIMEZONE` from `./config.js`
- Added: `parseImageReferences` from `./image.js`
- Added: `resolveGroupFolderPath` from `./group-folder.js`
- Added: `cleanupOrphans`, `ensureContainerRuntimeRunning` from `./container-runtime.js`
- Already present: `findChannel` from `./router.js`, `Channel` type from `./types.js`, `channels: Channel[]` array

### datePrefix()
- New function using es-ES locale with weekday for agent date awareness
- Prepended to all prompts in processGroupMessages and startMessageLoop

### processGroupMessages()
- Uses `findChannel(channels, chatJid)` lookup (multi-channel)
- Uses `channel.setTyping?.()` (optional chaining for channels without typing)
- Uses `channel.sendMessage()` for output delivery
- Prepends `datePrefix()` to formatted messages
- Extracts `parseImageReferences()` and threads to `runAgent`

### runAgent()
- Added `imageAttachments` parameter
- Passes `assistantName: ASSISTANT_NAME` to container input
- Conditionally spreads `imageAttachments` into container input

### startMessageLoop()
- Uses `findChannel(channels, chatJid)` per group
- Uses `channel.setTyping?.()` with `.catch()` for typing indicators
- Prepends `datePrefix()` to formatted messages

### main()
- Uses `ensureContainerRuntimeRunning()` + `cleanupOrphans()` (abstracted)
- Shutdown disconnects all channels via `for (const ch of channels)`
- Shared `channelOpts` object for channel callbacks
- Conditional WhatsApp creation (`if (!TELEGRAM_ONLY)`)
- Conditional Telegram creation (`if (TELEGRAM_BOT_TOKEN)`)
- Scheduler and IPC use `findChannel()` for multi-channel routing
- `startMessageLoop().catch()` for crash handling

## Invariants
- All existing message processing logic (triggers, cursors, idle timers) preserved
- State management (loadState/saveState) unchanged
- Recovery logic unchanged
- `escapeXml` and `formatMessages` re-exports preserved
- `_setRegisteredGroups` test helper preserved
- `isDirectRun` guard preserved
- Error rollback with duplicate prevention preserved
