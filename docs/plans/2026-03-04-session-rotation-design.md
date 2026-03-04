# Session Rotation by Size Threshold

**Date**: 2026-03-04
**Issue**: #21 — Session JSONL files grow without bound, causing container timeouts on restart

## Problem

The Claude Agent SDK's JSONL session files are append-only. Compaction adds a `compact_boundary` marker but never truncates pre-compaction lines. Over time this causes slow container startups, timeouts, and wasted disk.

Current sizes (2026-03-04): casa 23 MB, passion 5.7 MB, main 4.7 MB.

## Approach

Session rotation by size threshold in `runAgent()`. Before passing `sessionId` to the container, check the JSONL file size. If over 5 MB, delete the session from the DB and let the SDK create a fresh one.

### Why this is safe

Agent memory lives in 5 independent layers:

| Layer | Location | Affected? |
|-------|----------|-----------|
| Auto-memory | `data/sessions/{group}/.claude/.../memory/MEMORY.md` | No |
| Group CLAUDE.md | `groups/{group}/CLAUDE.md` | No |
| Conversation archives | `groups/{group}/conversations/*.md` | No |
| Compaction summary | First user message after last `compact_boundary` | Lost (already archived by PreCompact hook) |
| Raw historical messages | Lines before last `compact_boundary` | Already inaccessible to the model |

### Rejected alternatives

- **JSONL truncation at compaction boundary**: Cannot confirm SDK only reads the last boundary. Too risky.
- **Scheduled rotation**: Over-engineered — rotation only matters right before agent runs.

## Changes

1. **`src/db.ts`**: Add `deleteSession(groupFolder)` function
2. **`src/index.ts`**: Add size check in `runAgent()` after reading `sessionId`, before calling `runContainerAgent()`

## Threshold

5 MB constant (`MAX_SESSION_FILE_SIZE`). Based on observed data: casa hit timeout issues at ~18 MB, and active sessions reach 5 MB within weeks of normal use.
