# Apple Reminders Metadata Enhancement

**Date:** 2026-03-03
**Status:** Approved

## Problem

The Apple Reminders MCP currently exposes only 4 fields per item: `name`, `notes`, `completed`, `dueDate`. EventKit provides additional metadata that would be useful to agents — priority, flagged status, URL, and timestamps — but these are not serialized by the Swift CLI.

## Scope

Add 5 new fields to reminder items across all 4 layers of the stack:

| Field | Type (JSON) | Read | Write | EventKit Property |
|-------|-------------|------|-------|-------------------|
| `priority` | `"none" \| "low" \| "medium" \| "high"` | Yes | Yes | `priority` (Int: 0→none, 1→high, 5→medium, 9→low) |
| `flagged` | `boolean` | Yes | Yes | `isFlagged` |
| `url` | `string \| null` | Yes | Yes | `url` (URL?) |
| `creationDate` | `string \| null` (ISO 8601) | Yes | No (read-only) | `creationDate` |
| `completionDate` | `string \| null` (ISO 8601) | Yes | No (read-only) | `completionDate` |

## Design Decisions

- **Human-readable priority strings** instead of Apple's unintuitive integers (1=high, 9=low). The Swift CLI maps between them internally.
- **Always include all fields** in item output — no `--verbose` opt-in. The fields are small strings and provide useful context to agents.
- **All new fields are optional** on input — 100% backward compatible with existing callers.

## Architecture

Changes flow bottom-up through the existing 4-layer pipeline:

```
Layer 1: Swift CLI (tools/reminders-cli/reminders-cli.swift)
    ↕ execFile + JSON stdout
Layer 2: Host TypeScript (src/reminders-jxa.ts)
    ↕ function calls
Layer 3: IPC Bridge (src/reminders-ipc.ts)
    ↕ JSON task/result files in /workspace/ipc/
Layer 4: Container MCP Server (container/apple-reminders-mcp/src/server.ts)
```

### Layer 1: Swift CLI

**Output changes (`reminderToDict`):**

Add to every item's JSON dict:
```swift
d["priority"] = priorityToString(r.priority)
d["flagged"] = r.isFlagged
d["url"] = r.url?.absoluteString ?? NSNull()
d["creationDate"] = dateToISO(r.creationDate)
d["completionDate"] = dateToISO(r.completionDate)
```

New helper functions:
- `priorityToString(_ p: Int) -> String` — 0→"none", 1→"high", 5→"medium", 9→"low", default→"none"
- `stringToPriority(_ s: String) -> Int` — reverse mapping
- `dateToISO(_ d: Date?) -> Any` — ISO 8601 string or NSNull

**Input changes:**

`add_item` — new optional flags:
- `--priority <none|low|medium|high>`
- `--flagged` (set true) / `--no-flagged` (set false)
- `--url <string>`

`update_item` — new optional flags:
- `--new-priority <none|low|medium|high>`
- `--new-flagged` / `--new-no-flagged`
- `--new-url <string>`

Update the "no update fields provided" validation to include the new fields.

### Layer 2: Host TypeScript (reminders-jxa.ts)

- `addRemindersItem()` — add optional params: `priority?: string`, `flagged?: boolean`, `url?: string`; forward as CLI flags
- `updateRemindersItem()` — extend `updates` type with `newPriority?: string`, `newFlagged?: boolean`, `newUrl?: string`; forward as CLI flags
- Read path unchanged (CLI JSON output is parsed generically)

### Layer 3: IPC Bridge (reminders-ipc.ts)

- `reminders_add_item` case — pass `data.priority`, `data.flagged`, `data.url` through to `addRemindersItem()`
- `reminders_update_item` case — pass `data.newPriority`, `data.newFlagged`, `data.newUrl` through to `updateRemindersItem()`
- Pure forwarding — no new validation needed

### Layer 4: Container MCP Server (server.ts)

`add_item` tool — add zod schemas:
```typescript
priority: z.enum(['none', 'low', 'medium', 'high']).optional(),
flagged: z.boolean().optional(),
url: z.string().optional(),
```

`update_item` tool — add zod schemas:
```typescript
new_priority: z.enum(['none', 'low', 'medium', 'high']).optional(),
new_flagged: z.boolean().optional(),
new_url: z.string().optional(),
```

Response data automatically includes new fields (pass-through from IPC).

## Backward Compatibility

100% backward compatible:
- All new output fields are additive (existing consumers ignore unknown fields)
- All new input parameters are optional (existing calls work unchanged)
- No IPC protocol changes (just more optional fields in JSON)
- No database/schema migrations

## Testing

1. Swift CLI direct invocation — test each new flag on add/update, verify output includes all fields
2. Full stack round-trip — MCP → IPC → CLI → IPC → MCP
3. Regression — verify existing operations work unchanged without new params

## Out of Scope

Deferred to future work:
- Recurrence rules (`EKRecurrenceRule`) — complex object model
- Subtasks — parent/child relationships, affects list rendering
- Tags — macOS 13+ API, needs feature detection
- Alarms/notifications — `EKAlarm` array
