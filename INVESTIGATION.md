# Session Trim Investigation (PR #700 rework)

## Context
PR #700 originally rotated oversized sessions. gavrielc suggested trimming JSONL at compaction boundaries instead, preserving context while reducing file size.

## Key Findings

### Compaction in Claude Agent SDK
- SDK emits `system/compact_boundary` message after compaction
- `PreCompact` hook exists (used in agent-runner to archive transcripts)
- **No `PostCompact` hook exists** in the SDK
- Compaction is triggered manually (`/compact`) or automatically when context fills up
- `compact_boundary` message includes `compact_metadata.pre_tokens` and `compact_metadata.trigger`

### JSONL Structure
Session files at: `data/sessions/<group>/.claude/projects/-workspace-group/<sessionId>.jsonl`

Message types observed: `assistant`, `user`, `queue-operation`, `progress`
- Each line is a JSON object with keys: `type`, `operation`, `timestamp`, `sessionId`, `content`
- After compaction, SDK writes a `compact_boundary` line — everything before it is "dead weight"

### Current PreCompact Hook (agent-runner)
Location: `container/agent-runner/src/index.ts:146-186`
- Archives full transcript to `/workspace/group/conversations/` as markdown before compaction
- Uses `transcript_path` and `session_id` from `PreCompactHookInput`

### Current Session Rotation (to be replaced)
Location: `src/index.ts:297-324`
- Checks JSONL size before spawning container
- If > 5MB, deletes session and starts fresh (loses all context)

## Proposed Approach

### Option A: Detect compact_boundary in message loop (RECOMMENDED)
In `container/agent-runner/src/index.ts` (~line 457), the message loop already processes SDK messages. Add:

```typescript
if (message.type === 'system' && message.subtype === 'compact_boundary') {
  trimSessionFile(transcriptPath);
}
```

`trimSessionFile()` would:
1. Read JSONL line by line
2. Find the last `compact_boundary` line
3. Rewrite file with only that line + everything after it

Pros: Immediate cleanup, simple, no new hooks needed
Cons: Runs inside the container (needs access to JSONL path)

### Option B: Trim in PreCompact hook
In the existing PreCompact hook, trim old entries before the previous compact_boundary.
Pros: Reuses existing hook infrastructure
Cons: Delayed cleanup (trims on NEXT compaction, not current one)

### Open Questions
- [ ] Need to inspect an actual post-compaction JSONL to confirm `compact_boundary` line format
- [ ] Verify `transcript_path` from PreCompactHookInput points to the same JSONL the SDK appends to
- [ ] Check if SDK reads the JSONL at session resume — trimming must not break resume
- [ ] Consider: should we keep a backup of trimmed content? (archive already handles this)
- [ ] The message loop runs inside the container — does it have write access to the JSONL?

## References
- PR #700: https://github.com/qwibitai/nanoclaw/pull/700
- Issue #697: oversized sessions cause container timeouts
- SDK hooks docs: https://platform.claude.com/docs/en/agent-sdk/hooks
