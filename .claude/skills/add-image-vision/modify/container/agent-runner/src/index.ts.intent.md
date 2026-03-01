# Intent: container/agent-runner/src/index.ts

## What Changed
- Added `imageAttachments?` field to ContainerInput interface
- Added `assistantName?` field to ContainerInput interface
- Added `ImageContentBlock`, `TextContentBlock`, `ContentBlock` type definitions
- Changed `SDKUserMessage.message.content` type from `string` to `string | ContentBlock[]`
- Added `pushMultimodal(content: ContentBlock[])` method to MessageStream class
- In `runQuery`: image loading logic reads attachments from disk, base64-encodes, sends as multimodal content blocks
- `createPreCompactHook` accepts optional `assistantName` parameter
- `formatTranscriptMarkdown` uses `assistantName` parameter for sender label
- Extended `SECRET_ENV_VARS` with Google OAuth secrets
- Extended `allowedTools` with `mcp__vanta__*` and `mcp__google-workspace__*`

## Key Sections
- **Types** (top of file): New content block interfaces, updated SDKUserMessage
- **MessageStream class**: New pushMultimodal method
- **runQuery function**: Image loading block, assistantName threading
- **SECRET_ENV_VARS**: Extended for Google OAuth
- **allowedTools**: Extended for Vanta and Google Workspace MCP

## Invariants (must-keep)
- All IPC protocol logic (input polling, close sentinel, message stream)
- MessageStream push/end/asyncIterator (text messages still work)
- readStdin, writeOutput, log functions
- Session management (getSessionSummary, sessions index)
- PreCompact hook (transcript archiving)
- Bash sanitization hook
- SDK query options structure (mcpServers, hooks, permissions)
- Query loop in main() (query → wait for IPC → repeat)
