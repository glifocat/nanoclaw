/**
 * Host-side IPC handler for Apple Reminders.
 *
 * Dispatches `reminders_*` IPC task types to the JXA functions in
 * reminders-jxa.ts and writes JSON results back to the group's IPC
 * results directory for the container-side MCP server to pick up.
 */

import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import {
  addRemindersItem,
  completeRemindersItem,
  listRemindersItems,
  listRemindersLists,
  moveRemindersItem,
  removeRemindersItem,
  RemindersResult,
  updateRemindersItem,
} from './reminders-jxa.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function writeResult(
  dataDir: string,
  sourceGroup: string,
  requestId: string,
  result: RemindersResult,
): void {
  try {
    const resultsDir = path.join(dataDir, 'ipc', sourceGroup, 'reminders_results');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, `${requestId}.json`), JSON.stringify(result));
  } catch (err) {
    logger.error({ err, sourceGroup, requestId }, 'Failed to write Reminders IPC result file');
  }
}

function missingParam(
  dataDir: string,
  sourceGroup: string,
  requestId: string,
  param: string,
): true {
  const result: RemindersResult = {
    success: false,
    message: `Missing required parameter: ${param}`,
  };
  writeResult(dataDir, sourceGroup, requestId, result);
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handle an IPC request for Apple Reminders operations.
 *
 * @returns `true` if the request was handled (or blocked), `false` if the
 *          request type is not a `reminders_*` type and should be passed to
 *          the next handler.
 */
export async function handleRemindersIpc(
  data: Record<string, unknown>,
  sourceGroup: string,
  _isMain: boolean,
  dataDir: string,
): Promise<boolean> {
  const type = data.type;
  if (typeof type !== 'string' || !type.startsWith('reminders_')) {
    return false;
  }

  // Validate requestId
  const requestId = data.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) {
    logger.warn(
      { type, requestId, sourceGroup },
      'Reminders IPC request blocked: invalid or missing requestId',
    );
    return true;
  }

  let result: RemindersResult;

  switch (type) {
    case 'reminders_list_lists': {
      result = await listRemindersLists();
      break;
    }

    case 'reminders_list_items': {
      const listName = data.listName as string | undefined;
      if (!listName) return missingParam(dataDir, sourceGroup, requestId, 'listName');
      const includeCompleted = (data.includeCompleted as boolean) ?? false;
      result = await listRemindersItems(listName, includeCompleted);
      break;
    }

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
      );
      break;
    }

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
      });
      break;
    }

    case 'reminders_complete_item': {
      const listName = data.listName as string | undefined;
      const itemTitle = data.itemTitle as string | undefined;
      if (!listName) return missingParam(dataDir, sourceGroup, requestId, 'listName');
      if (!itemTitle) return missingParam(dataDir, sourceGroup, requestId, 'itemTitle');
      result = await completeRemindersItem(listName, itemTitle);
      break;
    }

    case 'reminders_remove_item': {
      const listName = data.listName as string | undefined;
      const itemTitle = data.itemTitle as string | undefined;
      if (!listName) return missingParam(dataDir, sourceGroup, requestId, 'listName');
      if (!itemTitle) return missingParam(dataDir, sourceGroup, requestId, 'itemTitle');
      result = await removeRemindersItem(listName, itemTitle);
      break;
    }

    case 'reminders_move_item': {
      const listName = data.listName as string | undefined;
      const itemTitle = data.itemTitle as string | undefined;
      const targetList = data.targetList as string | undefined;
      if (!listName) return missingParam(dataDir, sourceGroup, requestId, 'listName');
      if (!itemTitle) return missingParam(dataDir, sourceGroup, requestId, 'itemTitle');
      if (!targetList) return missingParam(dataDir, sourceGroup, requestId, 'targetList');
      result = await moveRemindersItem(listName, itemTitle, targetList);
      break;
    }

    default:
      // reminders_ prefix but unknown subtype — not handled
      return false;
  }

  writeResult(dataDir, sourceGroup, requestId, result);

  if (result.success) {
    logger.info({ type, requestId, sourceGroup }, 'Reminders IPC request succeeded');
  } else {
    logger.error({ type, requestId, sourceGroup, message: result.message }, 'Reminders IPC request failed');
  }

  return true;
}
