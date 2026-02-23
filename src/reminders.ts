/**
 * Apple Reminders integration via JXA (JavaScript for Automation).
 *
 * Each function shells out to `osascript -l JavaScript` and returns a
 * { success, message, data? } result.  Functions never throw.
 *
 * Security: all interpolated strings go through JSON.stringify() to prevent
 * script injection in the JXA context.
 */

import { execFile } from 'child_process';
import { logger } from './logger.js';

export interface RemindersResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// JXA helper
// ---------------------------------------------------------------------------

function runJxa(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * List all Reminders lists (name + count of incomplete items).
 */
export async function listRemindersLists(): Promise<RemindersResult> {
  try {
    const script = `
      var app = Application("Reminders");
      var lists = app.lists();
      var result = [];
      for (var i = 0; i < lists.length; i++) {
        var completed = lists[i].reminders.completed();
        var count = 0;
        for (var j = 0; j < completed.length; j++) {
          if (!completed[j]) count++;
        }
        result.push({ name: lists[i].name(), count: count });
      }
      JSON.stringify(result);
    `;
    const raw = await runJxa(script);
    const data = JSON.parse(raw);
    return { success: true, message: `Found ${data.length} list(s)`, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'reminders: listRemindersLists failed');
    return { success: false, message: `Failed to list reminders lists: ${msg}` };
  }
}

/**
 * List items in a specific Reminders list.
 */
export async function listRemindersItems(
  listName: string,
  includeCompleted = false,
): Promise<RemindersResult> {
  try {
    const script = `
      var app = Application("Reminders");
      var list = app.lists.byName(${JSON.stringify(listName)});
      if (!list.exists()) { throw new Error("List not found: " + ${JSON.stringify(listName)}); }
      var names = list.reminders.name();
      var completedArr = list.reminders.completed();
      var dueDates = list.reminders.dueDate();
      var bodies = list.reminders.body();
      var result = [];
      for (var i = 0; i < names.length; i++) {
        if (${includeCompleted} || !completedArr[i]) {
          result.push({
            name: names[i],
            completed: completedArr[i],
            dueDate: dueDates[i] ? dueDates[i].toISOString() : null,
            body: bodies[i] || null
          });
        }
      }
      JSON.stringify(result);
    `;
    const raw = await runJxa(script);
    const data = JSON.parse(raw);
    return {
      success: true,
      message: `Found ${data.length} item(s) in "${listName}"`,
      data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, listName }, 'reminders: listRemindersItems failed');
    return { success: false, message: `Failed to list items: ${msg}` };
  }
}

/**
 * Add a new item to a Reminders list.
 */
export async function addRemindersItem(
  listName: string,
  title: string,
  notes?: string,
  dueDate?: string,
): Promise<RemindersResult> {
  try {
    // Build the properties object for the new reminder
    const props: Record<string, unknown> = { name: title };
    if (notes) props.body = notes;

    const script = `
      var app = Application("Reminders");
      var list = app.lists.byName(${JSON.stringify(listName)});
      if (!list.exists()) { throw new Error("List not found: " + ${JSON.stringify(listName)}); }
      var props = ${JSON.stringify(props)};
      ${dueDate ? `props.dueDate = new Date(${JSON.stringify(dueDate)});` : ''}
      var r = app.Reminder(props);
      list.reminders.push(r);
      JSON.stringify({ name: r.name(), dueDate: r.dueDate() ? r.dueDate().toISOString() : null });
    `;
    const raw = await runJxa(script);
    const data = JSON.parse(raw);
    return {
      success: true,
      message: `Added "${title}" to "${listName}"`,
      data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, listName, title }, 'reminders: addRemindersItem failed');
    return { success: false, message: `Failed to add item: ${msg}` };
  }
}

/**
 * Mark an item as completed in a Reminders list.
 */
export async function completeRemindersItem(
  listName: string,
  itemTitle: string,
): Promise<RemindersResult> {
  try {
    const script = `
      var app = Application("Reminders");
      var list = app.lists.byName(${JSON.stringify(listName)});
      if (!list.exists()) { throw new Error("List not found: " + ${JSON.stringify(listName)}); }
      var names = list.reminders.name();
      var completedArr = list.reminders.completed();
      var rems = list.reminders();
      var found = null;
      for (var i = 0; i < names.length; i++) {
        if (names[i] === ${JSON.stringify(itemTitle)} && !completedArr[i]) { found = rems[i]; break; }
      }
      if (!found) { throw new Error("Item not found: " + ${JSON.stringify(itemTitle)}); }
      found.completed = true;
      JSON.stringify({ name: found.name(), completed: true });
    `;
    const raw = await runJxa(script);
    const data = JSON.parse(raw);
    return {
      success: true,
      message: `Completed "${itemTitle}" in "${listName}"`,
      data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, listName, itemTitle }, 'reminders: completeRemindersItem failed');
    return { success: false, message: `Failed to complete item: ${msg}` };
  }
}

/**
 * Remove (delete) an item from a Reminders list.
 */
export async function removeRemindersItem(
  listName: string,
  itemTitle: string,
): Promise<RemindersResult> {
  try {
    const script = `
      var app = Application("Reminders");
      var list = app.lists.byName(${JSON.stringify(listName)});
      if (!list.exists()) { throw new Error("List not found: " + ${JSON.stringify(listName)}); }
      var names = list.reminders.name();
      var rems = list.reminders();
      var found = null;
      for (var i = 0; i < names.length; i++) {
        if (names[i] === ${JSON.stringify(itemTitle)}) { found = rems[i]; break; }
      }
      if (!found) { throw new Error("Item not found: " + ${JSON.stringify(itemTitle)}); }
      app.delete(found);
      JSON.stringify({ deleted: ${JSON.stringify(itemTitle)} });
    `;
    const raw = await runJxa(script);
    const data = JSON.parse(raw);
    return {
      success: true,
      message: `Removed "${itemTitle}" from "${listName}"`,
      data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, listName, itemTitle }, 'reminders: removeRemindersItem failed');
    return { success: false, message: `Failed to remove item: ${msg}` };
  }
}
