/**
 * Host-side JXA layer for Apple Reminders.
 *
 * Seven functions that shell out to `osascript -l JavaScript` to interact
 * with the macOS Reminders app. All user strings are escaped via
 * JSON.stringify() inside JXA scripts for injection safety.
 *
 * Every function returns a RemindersResult and never throws.
 */

import { execFile } from 'child_process';

import { logger } from './logger.js';

export interface RemindersResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runJxa(script: string): Promise<RemindersResult> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', script],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          logger.error({ err, stderr }, 'JXA script failed');
          resolve({
            success: false,
            message: `osascript failed: ${err.message}`,
          });
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve({ success: true, message: 'OK', data: null });
          return;
        }

        try {
          const data = JSON.parse(trimmed);
          resolve({ success: true, message: 'OK', data });
        } catch (parseErr) {
          logger.error({ stdout: trimmed, parseErr }, 'Failed to parse JXA output');
          resolve({
            success: false,
            message: `Failed to parse JXA output: ${(parseErr as Error).message}`,
          });
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all reminder lists with their item counts.
 */
export function listRemindersLists(): Promise<RemindersResult> {
  const script = `
    const app = Application("Reminders");
    const lists = app.lists();
    const result = lists.map(l => ({
      name: l.name(),
      id: l.id(),
      count: l.reminders.whose({completed: false})().length,
      completedCount: l.reminders.whose({completed: true})().length,
    }));
    JSON.stringify(result);
  `;
  return runJxa(script);
}

/**
 * List items in a specific reminder list.
 */
export function listRemindersItems(
  listName: string,
  includeCompleted: boolean = false,
): Promise<RemindersResult> {
  const safeListName = JSON.stringify(listName);
  const script = `
    const app = Application("Reminders");
    const includeCompleted = ${includeCompleted};
    const list = app.lists.byName(${safeListName});
    const items = includeCompleted
      ? list.reminders()
      : list.reminders.whose({completed: false})();
    const result = items.map(r => ({
      name: r.name(),
      notes: r.body() || "",
      dueDate: r.dueDate() ? r.dueDate().toISOString() : null,
      completed: r.completed(),
    }));
    JSON.stringify(result);
  `;
  return runJxa(script);
}

/**
 * Add a new reminder item to a list.
 */
export function addRemindersItem(
  listName: string,
  title: string,
  notes?: string,
  dueDate?: string,
): Promise<RemindersResult> {
  const safeListName = JSON.stringify(listName);
  const safeTitle = JSON.stringify(title);
  const safeNotes = notes !== undefined ? JSON.stringify(notes) : 'null';
  const safeDueDate = dueDate !== undefined ? JSON.stringify(dueDate) : 'null';

  const script = `
    const app = Application("Reminders");
    const list = app.lists.byName(${safeListName});
    const props = { name: ${safeTitle} };
    const notes = ${safeNotes};
    if (notes !== null) props.body = notes;
    const dueDateStr = ${safeDueDate};
    if (dueDateStr !== null) props.dueDate = new Date(dueDateStr);
    const item = app.Reminder(props);
    list.reminders.push(item);
    const created = list.reminders.byName(${safeTitle});
    JSON.stringify({
      name: created.name(),
      notes: created.body() || "",
      dueDate: created.dueDate() ? created.dueDate().toISOString() : null,
      completed: created.completed(),
    });
  `;
  return runJxa(script);
}

/**
 * Update fields on an existing reminder item.
 */
export function updateRemindersItem(
  listName: string,
  itemTitle: string,
  updates: { newTitle?: string; newNotes?: string; newDueDate?: string },
): Promise<RemindersResult> {
  // Validate before calling JXA
  if (!updates.newTitle && !updates.newNotes && !updates.newDueDate) {
    return Promise.resolve({
      success: false,
      message: 'No update fields provided',
    });
  }

  const safeListName = JSON.stringify(listName);
  const safeItemTitle = JSON.stringify(itemTitle);
  const safeNewTitle = updates.newTitle !== undefined ? JSON.stringify(updates.newTitle) : 'null';
  const safeNewNotes = updates.newNotes !== undefined ? JSON.stringify(updates.newNotes) : 'null';
  const safeNewDueDate =
    updates.newDueDate !== undefined ? JSON.stringify(updates.newDueDate) : 'null';

  const script = `
    const app = Application("Reminders");
    const list = app.lists.byName(${safeListName});
    const items = list.reminders.whose({name: ${safeItemTitle}})();
    if (items.length === 0) throw new Error("Reminder not found: " + ${safeItemTitle});
    const item = items[0];
    const newTitle = ${safeNewTitle};
    const newNotes = ${safeNewNotes};
    const newDueDateStr = ${safeNewDueDate};
    if (newTitle !== null) item.name = newTitle;
    if (newNotes !== null) item.body = newNotes;
    if (newDueDateStr !== null) item.dueDate = new Date(newDueDateStr);
    JSON.stringify({
      name: item.name(),
      notes: item.body() || "",
      dueDate: item.dueDate() ? item.dueDate().toISOString() : null,
      completed: item.completed(),
    });
  `;
  return runJxa(script);
}

/**
 * Mark a reminder item as completed.
 */
export function completeRemindersItem(
  listName: string,
  itemTitle: string,
): Promise<RemindersResult> {
  const safeListName = JSON.stringify(listName);
  const safeItemTitle = JSON.stringify(itemTitle);

  const script = `
    const app = Application("Reminders");
    const list = app.lists.byName(${safeListName});
    const items = list.reminders.whose({name: ${safeItemTitle}, completed: false})();
    if (items.length === 0) throw new Error("Active reminder not found: " + ${safeItemTitle});
    const item = items[0];
    item.completed = true;
    JSON.stringify({
      name: item.name(),
      completed: item.completed(),
    });
  `;
  return runJxa(script);
}

/**
 * Delete a reminder item from a list.
 */
export function removeRemindersItem(
  listName: string,
  itemTitle: string,
): Promise<RemindersResult> {
  const safeListName = JSON.stringify(listName);
  const safeItemTitle = JSON.stringify(itemTitle);

  const script = `
    const app = Application("Reminders");
    const list = app.lists.byName(${safeListName});
    const items = list.reminders.whose({name: ${safeItemTitle}})();
    if (items.length === 0) throw new Error("Reminder not found: " + ${safeItemTitle});
    const found = items[0];
    app.delete(found);
    JSON.stringify({ deleted: true });
  `;
  return runJxa(script);
}

/**
 * Move a reminder item from one list to another.
 *
 * JXA has no native move operation, so this reads properties from the source
 * item, creates a new item in the target list, and deletes the source.
 */
export function moveRemindersItem(
  listName: string,
  itemTitle: string,
  targetList: string,
): Promise<RemindersResult> {
  const safeListName = JSON.stringify(listName);
  const safeItemTitle = JSON.stringify(itemTitle);
  const safeTargetList = JSON.stringify(targetList);

  const script = `
    const app = Application("Reminders");
    const srcList = app.lists.byName(${safeListName});
    const items = srcList.reminders.whose({name: ${safeItemTitle}})();
    if (items.length === 0) throw new Error("Reminder not found: " + ${safeItemTitle});
    const src = items[0];
    const props = {
      name: src.name(),
      body: src.body() || "",
      completed: src.completed(),
    };
    if (src.dueDate()) props.dueDate = src.dueDate();
    const tgtList = app.lists.byName(${safeTargetList});
    const newItem = app.Reminder(props);
    tgtList.reminders.push(newItem);
    app.delete(src);
    JSON.stringify({ moved: true, name: props.name });
  `;
  return runJxa(script);
}
