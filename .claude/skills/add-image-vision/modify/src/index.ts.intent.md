# Intent: src/index.ts

## What Changed
- Added `import { parseImageReferences } from './image.js'`
- Added `import { resolveGroupFolderPath } from './group-folder.js'`
- Added `datePrefix()` function that prepends `[Current date and time: ...]` with day-of-week to every prompt
- In `processGroupMessages`: extract image references after formatting, prepend datePrefix, pass `imageAttachments` to `runAgent`
- In `runAgent`: added `imageAttachments` parameter, conditionally spread into `runContainerAgent` input, pass `assistantName`
- In `startMessageLoop`: prepend datePrefix to formatted messages
- In `registerGroup`: uses `resolveGroupFolderPath` for safe path resolution

## Key Sections
- **Imports** (top of file): parseImageReferences, resolveGroupFolderPath, TIMEZONE
- **datePrefix()**: New function using es-ES locale with weekday for agent date awareness
- **processGroupMessages**: Image extraction, datePrefix prepend, threading to runAgent
- **runAgent**: Signature change + imageAttachments + assistantName in input
- **startMessageLoop**: datePrefix prepend for piped messages

## Invariants (must-keep)
- State management (lastTimestamp, sessions, registeredGroups, lastAgentTimestamp)
- loadState/saveState functions
- registerGroup function with folder validation
- getAvailableGroups function
- processGroupMessages trigger logic, cursor management, idle timer, error rollback with duplicate prevention
- runAgent task/group snapshot writes, session tracking, wrappedOnOutput
- startMessageLoop with dedup-by-group and piping logic
- recoverPendingMessages startup recovery
- main() with channel setup, scheduler, IPC watcher, queue
- ensureContainerSystemRunning using container-runtime abstraction
- Graceful shutdown with queue.shutdown
