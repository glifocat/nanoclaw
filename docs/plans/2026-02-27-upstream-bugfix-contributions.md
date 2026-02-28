# Upstream Bug Fix Contributions

## Goal

Contribute bug fixes from our private repo back to upstream (`qwibitai/nanoclaw`), so they benefit all users and reduce our divergence from upstream.

Per CONTRIBUTING.md: bug fixes go as source code PRs, not skills.

## Candidate Bug Fixes

### 1. Duplicate Task Prevention (race condition)

- **Files**: `src/task-scheduler.ts`, `src/db.ts`
- **Problem**: Scheduler can enqueue the same task multiple times during a race condition because `next_run` is only advanced after execution.
- **Fix**: Advance `next_run` BEFORE enqueueing. Add `recordTaskResult()` to record results for recurring tasks without modifying `next_run`.
- **Verification needed**: Check if upstream `src/task-scheduler.ts` still has this race condition.

### 2. Message Timestamp Format Fix

- **Files**: `src/channels/whatsapp.ts`
- **Problem**: `toISOString()` produces UTC timestamps with `Z` suffix. The message loop uses string comparison for its cursor, and UTC timestamps appear "older" than local ones, causing messages to be silently skipped.
- **Fix**: Format timestamps as local time (`YYYY-MM-DDTHH:MM:SS`) without the Z suffix.
- **Verification needed**: Check if upstream still uses `toISOString()` for message timestamps.

### 3. WhatsApp Reconnection with Exponential Backoff

- **Files**: `src/channels/whatsapp.ts`
- **Problem**: On disconnect, reconnection attempts can stack up with no backoff, and old socket listeners aren't cleaned up.
- **Fix**: Track `reconnecting` state and `reconnectAttempts`, implement exponential backoff (2s -> 4s -> 8s -> 16s -> 30s cap), clean up old listeners on reconnect.
- **Verification needed**: Check upstream's current reconnection logic in `whatsapp.ts`.

### 4. Error Handling in Message Handler

- **Files**: `src/channels/whatsapp.ts`
- **Problem**: One bad message can crash the entire WhatsApp channel handler.
- **Fix**: Wrap individual message processing in try/catch so failures are logged but don't take down the channel.
- **Verification needed**: Check if upstream has added error handling since our fork.

### 5. Date/Time Context Injection in Task Prompts

- **Files**: `src/task-scheduler.ts`
- **Problem**: Scheduled tasks run without the agent knowing the current date/time, causing it to miscalculate day-of-week and give wrong answers.
- **Fix**: Inject current local date and time into the task prompt before sending to agent.
- **Verification needed**: Check if upstream task scheduler includes date context.

## Process for Each Fix

1. **Read the upstream file** (`origin/main`) and check if the bug still exists
2. **If still relevant**: create a clean branch from `origin/main`, apply minimal fix, test
3. **PR format**: use the contribution template with "Fix" type checked
4. **Push to `fork` remote**, create PR against `qwibitai/nanoclaw`
5. **One PR per fix** — keep them small and reviewable

## Remotes

- `origin` = `qwibitai/nanoclaw` (upstream)
- `fork` = `glifocat/nanoclaw` (public fork for contributions)
- `private` = `glifocat/nanoclaw-personal` (daily work)

## Notes

- Run `git fetch origin` before starting to get latest upstream
- Use `--no-verify` when pushing to fork (pre-push hook blocks non-TTY)
- The timestamp fix was previously contributed as PR #4 but as a feature — may need to check its status
- Some fixes may have been independently addressed by other contributors
