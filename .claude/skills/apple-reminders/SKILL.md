---
name: apple-reminders
description: Apple Reminders integration for NanoClaw. List, add, complete, and remove items in any Reminders list. Available to all groups. Use for setup, testing, or troubleshooting. Triggers on "reminders", "apple reminders", "lista de compras", "recordatorios".
---

# Apple Reminders Integration

Manage Apple Reminders lists from any WhatsApp group via JXA (JavaScript for Automation).

> **Compatibility:** NanoClaw v1.0.0. macOS only (requires osascript).

## Features

| Action | Tool | Description |
|--------|------|-------------|
| List lists | `reminders_list_lists` | Show all Reminders lists with item counts |
| List items | `reminders_list_items` | Show items in a specific list |
| Add item | `reminders_add_item` | Add a new reminder to a list |
| Complete item | `reminders_complete_item` | Mark a reminder as done |
| Remove item | `reminders_remove_item` | Delete a reminder from a list |

**Note:** Unlike X integration, Reminders is available to **all groups**, not just main.

## Prerequisites

1. **NanoClaw is installed and running** — WhatsApp connected, service active
2. **TCC permissions granted** for Reminders:
   ```bash
   # Run this manually — macOS will prompt for Reminders access
   osascript -l JavaScript -e 'Application("Reminders").lists().map(l => l.name())'
   ```
   Accept the permission prompt. Verify in System Settings > Privacy & Security > Reminders.

## Quick Start

```bash
# 1. Grant TCC permission (see Prerequisites above)

# 2. Rebuild host to include src/reminders.ts
npm run build

# 3. Rebuild container to include MCP tools
./container/build.sh

# 4. Restart service
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# 5. Test via WhatsApp: "lista mis recordatorios"
```

## Architecture

```
Container (Linux)                    Host (macOS)
-----------------                    -------------
MCP tool called      --writes-->     /data/ipc/{group}/tasks/*.json
by the agent                               |
                                           v
                                     ipc.ts detects file
                                     -> calls handleRemindersIpc()
                                     -> executes osascript (JXA)
                                           |
                                           v
MCP tool polls       <--reads--      /data/ipc/{group}/reminders_results/{requestId}.json
waitForRemindersResult()
returns to agent
```

### Why JXA?

- Apple Reminders has no REST API
- `osascript -l JavaScript` gives full access to the Reminders app via scripting bridge
- JXA runs natively on macOS — no dependencies needed
- Security: all user strings are interpolated via `JSON.stringify()` to prevent script injection

### File Structure

```
.claude/skills/apple-reminders/
|-- SKILL.md          # This documentation
|-- host.ts           # Host-side IPC handler (imports src/reminders.ts)

src/
|-- reminders.ts      # JXA functions (listRemindersLists, addRemindersItem, etc.)
|-- reminders.test.ts # Unit tests (mocked osascript)
```

## Integration Points

To integrate this skill into NanoClaw, make the following modifications:

---

**1. Host side: `src/ipc.ts`**

Add import after other local imports:
```typescript
import { handleRemindersIpc } from '../.claude/skills/apple-reminders/host.js';
```

Modify `processTaskIpc` function's switch statement default case:
```typescript
// Find:
default:
  logger.warn({ type: data.type }, 'Unknown IPC task type');

// Replace with:
default: {
  const handled = await handleRemindersIpc(data as Record<string, unknown>, sourceGroup, isMain, DATA_DIR);
  if (!handled) {
    logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}
```

---

**2. Container side: `container/agent-runner/src/ipc-mcp-stdio.ts`**

Add after the `register_group` tool (before `// Start the stdio transport`):

```typescript
// ---------------------------------------------------------------------------
// Apple Reminders tools
// ---------------------------------------------------------------------------

const REMINDERS_RESULTS_DIR = path.join(IPC_DIR, 'reminders_results');

async function waitForRemindersResult(
  requestId: string,
  maxWait = 15000,
): Promise<{ success: boolean; message: string; data?: unknown }> {
  const resultFile = path.join(REMINDERS_RESULTS_DIR, `${requestId}.json`);
  const pollInterval = 500;
  let elapsed = 0;

  while (elapsed < maxWait) {
    if (fs.existsSync(resultFile)) {
      try {
        const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
        fs.unlinkSync(resultFile);
        return result;
      } catch (err) {
        return { success: false, message: `Failed to read result: ${err}` };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
  }

  return { success: false, message: 'Reminders request timed out (15s)' };
}

server.tool(
  'reminders_list_lists',
  'List all Apple Reminders lists with their incomplete item counts.',
  {},
  async () => {
    const requestId = `rem-lists-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeIpcFile(TASKS_DIR, {
      type: 'reminders_list_lists',
      requestId,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    const result = await waitForRemindersResult(requestId);
    return {
      content: [{ type: 'text' as const, text: result.success ? JSON.stringify(result.data, null, 2) : result.message }],
      isError: !result.success,
    };
  },
);

server.tool(
  'reminders_list_items',
  'List items in a specific Apple Reminders list. By default shows only incomplete items.',
  {
    list_name: z.string().describe('The name of the Reminders list (e.g., "Compra (Súper)")'),
    include_completed: z.boolean().optional().default(false).describe('Whether to include completed items'),
  },
  async (args) => {
    const requestId = `rem-items-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeIpcFile(TASKS_DIR, {
      type: 'reminders_list_items',
      requestId,
      listName: args.list_name,
      includeCompleted: args.include_completed,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    const result = await waitForRemindersResult(requestId);
    return {
      content: [{ type: 'text' as const, text: result.success ? JSON.stringify(result.data, null, 2) : result.message }],
      isError: !result.success,
    };
  },
);

server.tool(
  'reminders_add_item',
  'Add a new item to an Apple Reminders list.',
  {
    list_name: z.string().describe('The name of the Reminders list (e.g., "Compra (Súper)")'),
    title: z.string().describe('The title of the new reminder item'),
    notes: z.string().optional().describe('Optional notes/body for the reminder'),
    due_date: z.string().optional().describe('Optional due date in ISO 8601 format (e.g., "2026-02-23T09:00:00")'),
  },
  async (args) => {
    const requestId = `rem-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeIpcFile(TASKS_DIR, {
      type: 'reminders_add_item',
      requestId,
      listName: args.list_name,
      title: args.title,
      notes: args.notes,
      dueDate: args.due_date,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    const result = await waitForRemindersResult(requestId);
    return {
      content: [{ type: 'text' as const, text: result.message }],
      isError: !result.success,
    };
  },
);

server.tool(
  'reminders_complete_item',
  'Mark a reminder item as completed in an Apple Reminders list.',
  {
    list_name: z.string().describe('The name of the Reminders list (e.g., "Compra (Súper)")'),
    item_title: z.string().describe('The exact title of the reminder item to complete'),
  },
  async (args) => {
    const requestId = `rem-done-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeIpcFile(TASKS_DIR, {
      type: 'reminders_complete_item',
      requestId,
      listName: args.list_name,
      itemTitle: args.item_title,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    const result = await waitForRemindersResult(requestId);
    return {
      content: [{ type: 'text' as const, text: result.message }],
      isError: !result.success,
    };
  },
);

server.tool(
  'reminders_remove_item',
  'Remove (delete) a reminder item from an Apple Reminders list.',
  {
    list_name: z.string().describe('The name of the Reminders list (e.g., "Compra (Súper)")'),
    item_title: z.string().describe('The exact title of the reminder item to remove'),
  },
  async (args) => {
    const requestId = `rem-del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeIpcFile(TASKS_DIR, {
      type: 'reminders_remove_item',
      requestId,
      listName: args.list_name,
      itemTitle: args.item_title,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    const result = await waitForRemindersResult(requestId);
    return {
      content: [{ type: 'text' as const, text: result.message }],
      isError: !result.success,
    };
  },
);
```

---

**3. Build and restart**

```bash
npm run build
./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Testing

### Run unit tests

```bash
npx vitest run src/reminders.test.ts
```

### Test JXA directly

```bash
# List all lists
osascript -l JavaScript -e 'Application("Reminders").lists().map(l => l.name())'

# List items in a specific list
osascript -l JavaScript -e 'const app = Application("Reminders"); app.lists.byName("Compra (Súper)").reminders.whose({completed: false})().map(r => r.name())'

# Add an item
osascript -l JavaScript -e 'const app = Application("Reminders"); const list = app.lists.byName("Compra (Súper)"); list.reminders.push(app.Reminder({name: "Test item"}));'
```

### Usage via WhatsApp

```
@Gambi lista mis listas de recordatorios

@Gambi que hay en la lista Compra (Súper)

@Gambi añade leche a Compra (Súper)

@Gambi completa leche en Compra (Súper)

@Gambi elimina leche de Compra (Súper)
```

## Troubleshooting

### TCC Permission Denied

```
Error: Not authorized to send Apple events to Reminders
```

Fix: System Settings > Privacy & Security > Reminders > enable for Terminal/osascript. Or re-run the manual osascript command from Prerequisites.

### List Not Found

Reminders list names are case-sensitive and must match exactly, including special characters like parentheses. Use `reminders_list_lists` first to get exact names.

### Request Timeout (15s)

The container-side poll times out after 15 seconds. If the host is slow to process:
1. Check host logs: `grep -i "reminders" logs/nanoclaw.log | tail -20`
2. Verify the IPC watcher is running
3. Test JXA directly (see Testing section above)

### Check Logs

```bash
# Host-side reminders processing
grep -i "reminders\|reminders_" logs/nanoclaw.log | tail -20

# IPC errors
grep -i "error.*ipc\|ipc.*error" logs/nanoclaw.log | tail -10
```

## Security

- All user-provided strings are escaped via `JSON.stringify()` before interpolation into JXA scripts — prevents script injection
- No network access required — everything runs locally via Apple's scripting bridge
- Available to all groups (no `isMain` restriction) since Reminders is personal data, not a public-facing service
