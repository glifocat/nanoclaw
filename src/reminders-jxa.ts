/**
 * Host-side Apple Reminders layer using a compiled Swift EventKit CLI.
 *
 * Replaces the previous JXA/osascript approach which was too slow for large
 * lists (Apple Event IPC overhead: ~30s for 54 items vs ~0.6s via EventKit).
 *
 * The Swift binary lives at tools/reminders-cli/reminders-cli and is compiled
 * once with `swiftc -O`. It uses EventKit directly, bypassing Apple Events.
 *
 * Every function returns a RemindersResult and never throws.
 */

import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './logger.js';

export interface RemindersResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '..', 'tools', 'reminders-cli', 'reminders-cli');

function runCli(args: string[]): Promise<RemindersResult> {
  return new Promise((resolve) => {
    execFile(
      CLI_PATH,
      args,
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) {
          // The CLI outputs JSON even on error (exit code 1)
          const trimmed = stdout.trim();
          if (trimmed) {
            try {
              const parsed = JSON.parse(trimmed);
              resolve({
                success: false,
                message: parsed.message || err.message,
              });
              return;
            } catch {
              // fall through to generic error
            }
          }
          logger.error({ err, stderr }, 'reminders-cli failed');
          resolve({
            success: false,
            message: `reminders-cli failed: ${err.message}`,
          });
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve({ success: true, message: 'OK', data: null });
          return;
        }

        try {
          const parsed = JSON.parse(trimmed);
          resolve({
            success: parsed.success ?? true,
            message: parsed.message ?? 'OK',
            data: parsed.data,
          });
        } catch (parseErr) {
          logger.error({ stdout: trimmed, parseErr }, 'Failed to parse CLI output');
          resolve({
            success: false,
            message: `Failed to parse CLI output: ${(parseErr as Error).message}`,
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
  return runCli(['list_lists']);
}

/**
 * List items in a specific reminder list.
 */
export function listRemindersItems(
  listName: string,
  includeCompleted: boolean = false,
): Promise<RemindersResult> {
  const args = ['list_items', listName];
  if (includeCompleted) args.push('--include-completed');
  return runCli(args);
}

/**
 * Add a new reminder item to a list.
 */
export function addRemindersItem(
  listName: string,
  title: string,
  notes?: string,
  dueDate?: string,
  priority?: string,
): Promise<RemindersResult> {
  const args = ['add_item', listName, title];
  if (notes !== undefined) args.push('--notes', notes);
  if (dueDate !== undefined) args.push('--due', dueDate);
  if (priority !== undefined) args.push('--priority', priority);
  return runCli(args);
}

/**
 * Update fields on an existing reminder item.
 */
export function updateRemindersItem(
  listName: string,
  itemTitle: string,
  updates: {
    newTitle?: string;
    newNotes?: string;
    newDueDate?: string;
    newPriority?: string;
  },
): Promise<RemindersResult> {
  if (
    !updates.newTitle &&
    !updates.newNotes &&
    !updates.newDueDate &&
    !updates.newPriority
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
  return runCli(args);
}

/**
 * Mark a reminder item as completed.
 */
export function completeRemindersItem(
  listName: string,
  itemTitle: string,
): Promise<RemindersResult> {
  return runCli(['complete_item', listName, itemTitle]);
}

/**
 * Delete a reminder item from a list.
 */
export function removeRemindersItem(
  listName: string,
  itemTitle: string,
): Promise<RemindersResult> {
  return runCli(['remove_item', listName, itemTitle]);
}

/**
 * Move a reminder item from one list to another.
 *
 * EventKit supports direct calendar reassignment (no copy+delete needed).
 */
export function moveRemindersItem(
  listName: string,
  itemTitle: string,
  targetList: string,
): Promise<RemindersResult> {
  return runCli(['move_item', listName, itemTitle, targetList]);
}
