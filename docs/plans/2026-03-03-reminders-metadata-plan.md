# Apple Reminders Metadata Enhancement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add priority, flagged, url, creationDate, and completionDate fields to Apple Reminders items across all 4 layers (Swift CLI → host TS → IPC → container MCP).

**Architecture:** Bottom-up enhancement of the existing 4-layer pipeline. Each layer forwards new optional fields to the next. All changes are additive — no breaking changes.

**Tech Stack:** Swift (EventKit), TypeScript (Node.js), vitest, zod, MCP SDK

**Design doc:** `docs/plans/2026-03-03-reminders-metadata-design.md`

---

### Task 1: Swift CLI — add helper functions and output fields

**Files:**
- Modify: `tools/reminders-cli/reminders-cli.swift:72-86` (reminderToDict)
- Modify: `tools/reminders-cli/reminders-cli.swift:20-21` (add helpers after store declaration)

**Step 1: Add helper functions after the `store` declaration (line 22)**

Insert these three functions before `findCalendar`:

```swift
func priorityToString(_ p: Int) -> String {
    switch p {
    case 1: return "high"
    case 5: return "medium"
    case 9: return "low"
    default: return "none"
    }
}

func stringToPriority(_ s: String) -> Int {
    switch s.lowercased() {
    case "high": return 1
    case "medium": return 5
    case "low": return 9
    default: return 0
    }
}

func dateToISO(_ d: Date?) -> Any {
    guard let date = d else { return NSNull() }
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.string(from: date)
}
```

**Step 2: Update `reminderToDict` to include new fields**

Replace the existing `reminderToDict` function (lines 72-86) with:

```swift
func reminderToDict(_ r: EKReminder) -> [String: Any] {
    var d: [String: Any] = [
        "name": r.title ?? "",
        "notes": r.notes ?? "",
        "completed": r.isCompleted,
        "priority": priorityToString(r.priority),
        "flagged": r.isFlagged,
        "url": r.url?.absoluteString as Any? ?? NSNull(),
        "creationDate": dateToISO(r.creationDate),
        "completionDate": dateToISO(r.completionDate),
    ]
    if let dc = r.dueDateComponents, let date = Calendar.current.date(from: dc) {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime]
        d["dueDate"] = fmt.string(from: date)
    } else {
        d["dueDate"] = NSNull()
    }
    return d
}
```

**Step 3: Build and smoke-test**

Run: `cd tools/reminders-cli && ./build.sh`
Expected: `Built: /path/to/tools/reminders-cli/reminders-cli`

Run: `./tools/reminders-cli/reminders-cli list_lists`
Expected: JSON with success:true (confirms binary runs)

Run: `./tools/reminders-cli/reminders-cli list_items "Reminders"`
Expected: Each item now has `priority`, `flagged`, `url`, `creationDate`, `completionDate` fields

**Step 4: Commit**

```bash
git add tools/reminders-cli/reminders-cli.swift
git commit -m "feat(reminders-cli): add metadata output fields (priority, flagged, url, dates)"
```

---

### Task 2: Swift CLI — add input flags for add_item and update_item

**Files:**
- Modify: `tools/reminders-cli/reminders-cli.swift:132-148` (addItem function)
- Modify: `tools/reminders-cli/reminders-cli.swift:150-168` (updateItem function)
- Modify: `tools/reminders-cli/reminders-cli.swift:226-236` (add_item arg parsing)
- Modify: `tools/reminders-cli/reminders-cli.swift:238-251` (update_item arg parsing)

**Step 1: Update `addItem` function signature and body**

Replace the existing `addItem` function with:

```swift
func addItem(listName: String, title: String, notes: String?, dueDate: String?, priority: String?, flagged: Bool?, url: String?) {
    guard let cal = findCalendar(listName) else { fail("List not found: \(listName)") }
    let reminder = EKReminder(eventStore: store)
    reminder.title = title
    reminder.calendar = cal
    if let n = notes { reminder.notes = n }
    if let d = dueDate, let date = ISO8601DateFormatter().date(from: d) {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: date
        )
    }
    if let p = priority { reminder.priority = stringToPriority(p) }
    if let f = flagged { reminder.isFlagged = f }
    if let u = url { reminder.url = URL(string: u) }
    do {
        try store.save(reminder, commit: true)
        succeed("Added \"\(title)\" to \"\(listName)\"", data: reminderToDict(reminder))
    } catch {
        fail("Failed to save: \(error.localizedDescription)")
    }
}
```

**Step 2: Update `updateItem` function signature and body**

Replace the existing `updateItem` function with:

```swift
func updateItem(listName: String, title: String, newTitle: String?, newNotes: String?, newDueDate: String?, newPriority: String?, newFlagged: Bool?, newUrl: String?) {
    guard let cal = findCalendar(listName) else { fail("List not found: \(listName)") }
    guard let reminder = findReminder(inCalendar: cal, title: title) else { fail("Reminder not found: \(title)") }

    if let t = newTitle { reminder.title = t }
    if let n = newNotes { reminder.notes = n }
    if let d = newDueDate, let date = ISO8601DateFormatter().date(from: d) {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: date
        )
    }
    if let p = newPriority { reminder.priority = stringToPriority(p) }
    if let f = newFlagged { reminder.isFlagged = f }
    if let u = newUrl { reminder.url = URL(string: u) }
    do {
        try store.save(reminder, commit: true)
        succeed("Updated \"\(reminder.title ?? title)\"", data: reminderToDict(reminder))
    } catch {
        fail("Failed to update: \(error.localizedDescription)")
    }
}
```

**Step 3: Update `add_item` argument parsing (case "add_item" block)**

Replace the `add_item` case block with:

```swift
case "add_item":
    guard args.count >= 3 else { fail("Usage: add_item <list_name> <title> [--notes <text>] [--due <ISO8601>] [--priority <none|low|medium|high>] [--flagged] [--no-flagged] [--url <string>]") }
    var notes: String?
    var dueDate: String?
    var priority: String?
    var flagged: Bool?
    var url: String?
    var i = 3
    while i < args.count {
        if args[i] == "--notes" && i + 1 < args.count { notes = args[i + 1]; i += 2 }
        else if args[i] == "--due" && i + 1 < args.count { dueDate = args[i + 1]; i += 2 }
        else if args[i] == "--priority" && i + 1 < args.count { priority = args[i + 1]; i += 2 }
        else if args[i] == "--flagged" { flagged = true; i += 1 }
        else if args[i] == "--no-flagged" { flagged = false; i += 1 }
        else if args[i] == "--url" && i + 1 < args.count { url = args[i + 1]; i += 2 }
        else { i += 1 }
    }
    addItem(listName: args[1], title: args[2], notes: notes, dueDate: dueDate, priority: priority, flagged: flagged, url: url)
```

**Step 4: Update `update_item` argument parsing (case "update_item" block)**

Replace the `update_item` case block with:

```swift
case "update_item":
    guard args.count >= 3 else { fail("Usage: update_item <list_name> <title> [--new-title <t>] [--new-notes <n>] [--new-due <d>] [--new-priority <none|low|medium|high>] [--new-flagged] [--new-no-flagged] [--new-url <string>]") }
    var newTitle: String?
    var newNotes: String?
    var newDueDate: String?
    var newPriority: String?
    var newFlagged: Bool?
    var newUrl: String?
    var i = 3
    while i < args.count {
        if args[i] == "--new-title" && i + 1 < args.count { newTitle = args[i + 1]; i += 2 }
        else if args[i] == "--new-notes" && i + 1 < args.count { newNotes = args[i + 1]; i += 2 }
        else if args[i] == "--new-due" && i + 1 < args.count { newDueDate = args[i + 1]; i += 2 }
        else if args[i] == "--new-priority" && i + 1 < args.count { newPriority = args[i + 1]; i += 2 }
        else if args[i] == "--new-flagged" { newFlagged = true; i += 1 }
        else if args[i] == "--new-no-flagged" { newFlagged = false; i += 1 }
        else if args[i] == "--new-url" && i + 1 < args.count { newUrl = args[i + 1]; i += 2 }
        else { i += 1 }
    }
    if newTitle == nil && newNotes == nil && newDueDate == nil && newPriority == nil && newFlagged == nil && newUrl == nil { fail("No update fields provided") }
    updateItem(listName: args[1], title: args[2], newTitle: newTitle, newNotes: newNotes, newDueDate: newDueDate, newPriority: newPriority, newFlagged: newFlagged, newUrl: newUrl)
```

**Step 5: Rebuild and test**

Run: `cd tools/reminders-cli && ./build.sh`

Run: `./tools/reminders-cli/reminders-cli add_item "Reminders" "Test priority" --priority high --flagged`
Expected: JSON with `"priority":"high"`, `"flagged":true` in returned data

Run: `./tools/reminders-cli/reminders-cli remove_item "Reminders" "Test priority"`
Expected: `"success":true`

**Step 6: Commit**

```bash
git add tools/reminders-cli/reminders-cli.swift
git commit -m "feat(reminders-cli): add metadata input flags (priority, flagged, url)"
```

---

### Task 3: Host TypeScript — update addRemindersItem and tests

**Files:**
- Modify: `src/reminders-jxa.ts:113-123` (addRemindersItem)
- Modify: `src/reminders-jxa.test.ts:151-185` (addRemindersItem tests)

**Step 1: Write the failing tests**

Add these tests to the `addRemindersItem` describe block in `src/reminders-jxa.test.ts`, after the existing "handles CLI errors gracefully" test:

```typescript
  it('creates item with priority flag', async () => {
    mockCliSuccess({ name: 'Task', priority: 'high' });

    const result = await addRemindersItem('Work', 'Task', undefined, undefined, 'high');

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toEqual(['add_item', 'Work', 'Task', '--priority', 'high']);
  });

  it('creates item with flagged=true', async () => {
    mockCliSuccess({ name: 'Task', flagged: true });

    const result = await addRemindersItem('Work', 'Task', undefined, undefined, undefined, true);

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--flagged');
    expect(args).not.toContain('--no-flagged');
  });

  it('creates item with flagged=false', async () => {
    mockCliSuccess({ name: 'Task', flagged: false });

    const result = await addRemindersItem('Work', 'Task', undefined, undefined, undefined, false);

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--no-flagged');
    expect(args).not.toContain('--flagged');
  });

  it('creates item with url', async () => {
    mockCliSuccess({ name: 'Task', url: 'https://example.com' });

    const result = await addRemindersItem('Work', 'Task', undefined, undefined, undefined, undefined, 'https://example.com');

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toEqual(['add_item', 'Work', 'Task', '--url', 'https://example.com']);
  });

  it('creates item with all metadata fields', async () => {
    mockCliSuccess({ name: 'Full item' });

    await addRemindersItem('Work', 'Full item', 'notes here', '2026-04-01T09:00:00', 'medium', true, 'https://example.com');

    const args = getCliArgs();
    expect(args).toContain('--notes');
    expect(args).toContain('--due');
    expect(args).toContain('--priority');
    expect(args).toContain('medium');
    expect(args).toContain('--flagged');
    expect(args).toContain('--url');
    expect(args).toContain('https://example.com');
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/reminders-jxa.test.ts`
Expected: FAIL — `addRemindersItem` doesn't accept new params yet

**Step 3: Update `addRemindersItem` in `src/reminders-jxa.ts`**

Replace the existing function (lines 113-123) with:

```typescript
export function addRemindersItem(
  listName: string,
  title: string,
  notes?: string,
  dueDate?: string,
  priority?: string,
  flagged?: boolean,
  url?: string,
): Promise<RemindersResult> {
  const args = ['add_item', listName, title];
  if (notes !== undefined) args.push('--notes', notes);
  if (dueDate !== undefined) args.push('--due', dueDate);
  if (priority !== undefined) args.push('--priority', priority);
  if (flagged === true) args.push('--flagged');
  if (flagged === false) args.push('--no-flagged');
  if (url !== undefined) args.push('--url', url);
  return runCli(args);
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/reminders-jxa.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/reminders-jxa.ts src/reminders-jxa.test.ts
git commit -m "feat(reminders): add metadata params to addRemindersItem"
```

---

### Task 4: Host TypeScript — update updateRemindersItem and tests

**Files:**
- Modify: `src/reminders-jxa.ts:128-145` (updateRemindersItem)
- Modify: `src/reminders-jxa.test.ts:189-258` (updateRemindersItem tests)

**Step 1: Write the failing tests**

Add these tests to the `updateRemindersItem` describe block in `src/reminders-jxa.test.ts`, after the "handles CLI errors gracefully" test:

```typescript
  it('updates priority of existing item', async () => {
    mockCliSuccess({ name: 'Item', priority: 'high' });

    const result = await updateRemindersItem('Shopping', 'Item', { newPriority: 'high' });

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--new-priority');
    expect(args).toContain('high');
  });

  it('updates flagged to true', async () => {
    mockCliSuccess({ name: 'Item', flagged: true });

    const result = await updateRemindersItem('Shopping', 'Item', { newFlagged: true });

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--new-flagged');
    expect(args).not.toContain('--new-no-flagged');
  });

  it('updates flagged to false', async () => {
    mockCliSuccess({ name: 'Item', flagged: false });

    const result = await updateRemindersItem('Shopping', 'Item', { newFlagged: false });

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--new-no-flagged');
    expect(args).not.toContain('--new-flagged');
  });

  it('updates url of existing item', async () => {
    mockCliSuccess({ name: 'Item', url: 'https://example.com' });

    const result = await updateRemindersItem('Shopping', 'Item', { newUrl: 'https://example.com' });

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--new-url');
    expect(args).toContain('https://example.com');
  });

  it('returns error when only new metadata fields are empty objects', async () => {
    // No original or new fields — still should fail
    const result = await updateRemindersItem('Shopping', 'Item', {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('No update fields');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('allows update with only new metadata fields (no original fields)', async () => {
    mockCliSuccess({ name: 'Item', priority: 'low', flagged: true });

    const result = await updateRemindersItem('Shopping', 'Item', {
      newPriority: 'low',
      newFlagged: true,
      newUrl: 'https://example.com',
    });

    expect(result.success).toBe(true);
    expect(mockExecFile).toHaveBeenCalled();
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/reminders-jxa.test.ts`
Expected: FAIL — `updates` type doesn't have new fields

**Step 3: Update `updateRemindersItem` in `src/reminders-jxa.ts`**

Replace the existing function (lines 128-145) with:

```typescript
export function updateRemindersItem(
  listName: string,
  itemTitle: string,
  updates: {
    newTitle?: string;
    newNotes?: string;
    newDueDate?: string;
    newPriority?: string;
    newFlagged?: boolean;
    newUrl?: string;
  },
): Promise<RemindersResult> {
  if (
    !updates.newTitle &&
    !updates.newNotes &&
    !updates.newDueDate &&
    !updates.newPriority &&
    updates.newFlagged === undefined &&
    !updates.newUrl
  ) {
    return Promise.resolve({
      success: false,
      message: 'No update fields provided',
    });
  }

  const args = ['update_item', listName, itemTitle];
  if (updates.newTitle !== undefined) args.push('--new-title', updates.newTitle);
  if (updates.newNotes !== undefined) args.push('--new-notes', updates.newNotes);
  if (updates.newDueDate !== undefined) args.push('--new-due', updates.newDueDate);
  if (updates.newPriority !== undefined) args.push('--new-priority', updates.newPriority);
  if (updates.newFlagged === true) args.push('--new-flagged');
  if (updates.newFlagged === false) args.push('--new-no-flagged');
  if (updates.newUrl !== undefined) args.push('--new-url', updates.newUrl);
  return runCli(args);
}
```

Note: `newFlagged` uses `=== undefined` instead of `!` because `false` is a valid value that should NOT be treated as "no field provided".

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/reminders-jxa.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/reminders-jxa.ts src/reminders-jxa.test.ts
git commit -m "feat(reminders): add metadata params to updateRemindersItem"
```

---

### Task 5: IPC Bridge — forward new fields and update tests

**Files:**
- Modify: `src/reminders-ipc.ts:107-118` (reminders_add_item case)
- Modify: `src/reminders-ipc.ts:120-130` (reminders_update_item case)
- Modify: `src/reminders-ipc.test.ts:261-335` (add_item tests)
- Modify: `src/reminders-ipc.test.ts:341-405` (update_item tests)

**Step 1: Write the failing tests**

Add to the `reminders_add_item` describe block in `src/reminders-ipc.test.ts`:

```typescript
  it('forwards metadata fields (priority, flagged, url)', async () => {
    vi.mocked(addRemindersItem).mockResolvedValue(
      okResult({ name: 'Task', priority: 'high', flagged: true, url: 'https://example.com' }),
    );

    await handleRemindersIpc(
      {
        type: 'reminders_add_item',
        requestId: 'req-add-meta-1',
        listName: 'Work',
        title: 'Task',
        priority: 'high',
        flagged: true,
        url: 'https://example.com',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(addRemindersItem).toHaveBeenCalledWith(
      'Work', 'Task', undefined, undefined, 'high', true, 'https://example.com',
    );
  });
```

Add to the `reminders_update_item` describe block:

```typescript
  it('forwards metadata update fields (newPriority, newFlagged, newUrl)', async () => {
    vi.mocked(updateRemindersItem).mockResolvedValue(okResult({ name: 'Updated' }));

    await handleRemindersIpc(
      {
        type: 'reminders_update_item',
        requestId: 'req-upd-meta-1',
        listName: 'Shopping',
        itemTitle: 'Buy eggs',
        newPriority: 'low',
        newFlagged: false,
        newUrl: 'https://example.com',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(updateRemindersItem).toHaveBeenCalledWith('Shopping', 'Buy eggs', {
      newTitle: undefined,
      newNotes: undefined,
      newDueDate: undefined,
      newPriority: 'low',
      newFlagged: false,
      newUrl: 'https://example.com',
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/reminders-ipc.test.ts`
Expected: FAIL — IPC handler doesn't pass new fields yet

**Step 3: Update `reminders_add_item` case in `src/reminders-ipc.ts`**

Replace the `reminders_add_item` case (lines 107-118) with:

```typescript
    case 'reminders_add_item': {
      const listName = data.listName as string | undefined;
      const title = data.title as string | undefined;
      if (!listName) return missingParam(dataDir, sourceGroup, requestId, 'listName');
      if (!title) return missingParam(dataDir, sourceGroup, requestId, 'title');
      result = await addRemindersItem(
        listName,
        title,
        data.notes as string | undefined,
        data.dueDate as string | undefined,
        data.priority as string | undefined,
        data.flagged as boolean | undefined,
        data.url as string | undefined,
      );
      break;
    }
```

**Step 4: Update `reminders_update_item` case in `src/reminders-ipc.ts`**

Replace the `reminders_update_item` case (lines 120-130) with:

```typescript
    case 'reminders_update_item': {
      const listName = data.listName as string | undefined;
      const itemTitle = data.itemTitle as string | undefined;
      if (!listName) return missingParam(dataDir, sourceGroup, requestId, 'listName');
      if (!itemTitle) return missingParam(dataDir, sourceGroup, requestId, 'itemTitle');
      result = await updateRemindersItem(listName, itemTitle, {
        newTitle: data.newTitle as string | undefined,
        newNotes: data.newNotes as string | undefined,
        newDueDate: data.newDueDate as string | undefined,
        newPriority: data.newPriority as string | undefined,
        newFlagged: data.newFlagged as boolean | undefined,
        newUrl: data.newUrl as string | undefined,
      });
      break;
    }
```

**Step 5: Run tests to verify they pass**

Run: `npm test -- --run src/reminders-ipc.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/reminders-ipc.ts src/reminders-ipc.test.ts
git commit -m "feat(reminders): forward metadata fields through IPC bridge"
```

---

### Task 6: Container MCP Server — add zod schemas and update tests

**Files:**
- Modify: `container/apple-reminders-mcp/src/server.ts:87-109` (add_item tool)
- Modify: `container/apple-reminders-mcp/src/server.ts:114-140` (update_item tool)
- Modify: `container/apple-reminders-mcp/src/__tests__/server.test.ts:122-189` (add/update tests)

**Step 1: Write the failing tests**

Add to the `tool handlers` describe block in `container/apple-reminders-mcp/src/__tests__/server.test.ts`, after the existing `add_item omits undefined optional params` test:

```typescript
  it('add_item maps metadata fields (priority, flagged, url)', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { name: 'Task', priority: 'high', flagged: true, url: 'https://example.com' },
    });

    const server = createServer();
    await callTool(server, 'add_item', {
      list_name: 'Work',
      title: 'Task',
      priority: 'high',
      flagged: true,
      url: 'https://example.com',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('add_item', {
      listName: 'Work',
      title: 'Task',
      notes: undefined,
      dueDate: undefined,
      priority: 'high',
      flagged: true,
      url: 'https://example.com',
    });
  });

  it('update_item maps metadata update fields', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { name: 'Updated', priority: 'low' },
    });

    const server = createServer();
    await callTool(server, 'update_item', {
      list_name: 'Shopping',
      item_title: 'Buy eggs',
      new_priority: 'low',
      new_flagged: true,
      new_url: 'https://example.com',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('update_item', {
      listName: 'Shopping',
      itemTitle: 'Buy eggs',
      newTitle: undefined,
      newNotes: undefined,
      newDueDate: undefined,
      newPriority: 'low',
      newFlagged: true,
      newUrl: 'https://example.com',
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `cd container/apple-reminders-mcp && npm test -- --run`
Expected: FAIL — zod schemas reject unknown `priority`, `flagged`, `url` params

**Step 3: Update `add_item` tool in `server.ts`**

Replace the `add_item` tool schema (lines 87-109) with:

```typescript
  server.tool(
    'add_item',
    'Add a new item to an Apple Reminders list.',
    {
      list_name: z.string().describe('Name of the reminders list'),
      title: z.string().describe('Title of the new reminder'),
      notes: z.string().optional().describe('Optional notes for the reminder'),
      due_date: z
        .string()
        .optional()
        .describe('Optional due date (YYYY-MM-DD or ISO 8601)'),
      priority: z
        .enum(['none', 'low', 'medium', 'high'])
        .optional()
        .describe('Priority level (default: none)'),
      flagged: z.boolean().optional().describe('Whether the reminder is flagged'),
      url: z.string().optional().describe('Optional URL to attach to the reminder'),
    },
    async (args) => {
      const result = await callReminders('add_item', {
        listName: args.list_name,
        title: args.title,
        notes: args.notes,
        dueDate: args.due_date,
        priority: args.priority,
        flagged: args.flagged,
        url: args.url,
      });
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );
```

**Step 4: Update `update_item` tool in `server.ts`**

Replace the `update_item` tool schema (lines 114-140) with:

```typescript
  server.tool(
    'update_item',
    'Update an existing item in an Apple Reminders list.',
    {
      list_name: z.string().describe('Name of the reminders list'),
      item_title: z
        .string()
        .describe('Current title of the reminder to update'),
      new_title: z.string().optional().describe('New title for the reminder'),
      new_notes: z.string().optional().describe('New notes for the reminder'),
      new_due_date: z
        .string()
        .optional()
        .describe('New due date (YYYY-MM-DD or ISO 8601)'),
      new_priority: z
        .enum(['none', 'low', 'medium', 'high'])
        .optional()
        .describe('New priority level'),
      new_flagged: z.boolean().optional().describe('New flagged state'),
      new_url: z.string().optional().describe('New URL to attach'),
    },
    async (args) => {
      const result = await callReminders('update_item', {
        listName: args.list_name,
        itemTitle: args.item_title,
        newTitle: args.new_title,
        newNotes: args.new_notes,
        newDueDate: args.new_due_date,
        newPriority: args.new_priority,
        newFlagged: args.new_flagged,
        newUrl: args.new_url,
      });
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );
```

**Step 5: Run tests to verify they pass**

Run: `cd container/apple-reminders-mcp && npm test -- --run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add container/apple-reminders-mcp/src/server.ts container/apple-reminders-mcp/src/__tests__/server.test.ts
git commit -m "feat(reminders-mcp): add metadata schemas to add_item and update_item tools"
```

---

### Task 7: Run all tests, rebuild, and verify

**Files:** None (verification only)

**Step 1: Run all host-side tests**

Run: `npm test -- --run`
Expected: ALL PASS (no regressions in reminders-jxa, reminders-ipc, or other tests)

**Step 2: Run container MCP tests**

Run: `cd container/apple-reminders-mcp && npm test -- --run`
Expected: ALL PASS

**Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Rebuild Swift CLI**

Run: `cd tools/reminders-cli && ./build.sh`
Expected: Compiles successfully

**Step 5: Rebuild container**

Run: `./container/build.sh`
Expected: Build complete (this bakes the updated MCP server into the container image)

**Step 6: Commit binary (if tracked) or note in PR that rebuild is required**

The compiled Swift binary (`tools/reminders-cli/reminders-cli`) is gitignored. Note in the PR description that `tools/reminders-cli/build.sh` must be re-run after pulling.
