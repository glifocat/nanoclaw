/**
 * Apple Reminders IPC Handler
 *
 * Handles all reminders_* IPC messages from container agents.
 * Follows the same pattern as x-integration/host.ts.
 */
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { listRemindersLists, listRemindersItems, addRemindersItem, completeRemindersItem, removeRemindersItem, } from '../../src/reminders.js';
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: { target: 'pino-pretty', options: { colorize: true } },
});
// Write result to IPC results directory
function writeResult(dataDir, sourceGroup, requestId, result) {
    const resultsDir = path.join(dataDir, 'ipc', sourceGroup, 'reminders_results');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, `${requestId}.json`), JSON.stringify(result));
}
/**
 * Handle Apple Reminders IPC messages.
 *
 * @returns true if message was handled, false if not a reminders message
 */
export async function handleRemindersIpc(data, sourceGroup, _isMain, dataDir) {
    const type = data.type;
    // Only handle reminders_* types
    if (!type?.startsWith('reminders_')) {
        return false;
    }
    // No isMain restriction — any group can use Reminders
    const requestId = data.requestId;
    if (!requestId) {
        logger.warn({ type }, 'Reminders request blocked: missing requestId');
        return true;
    }
    logger.info({ type, requestId, sourceGroup }, 'Processing Reminders request');
    let result;
    switch (type) {
        case 'reminders_list_lists':
            result = await listRemindersLists();
            break;
        case 'reminders_list_items': {
            const listName = data.listName;
            if (!listName) {
                result = { success: false, message: 'Missing listName' };
                break;
            }
            const includeCompleted = data.includeCompleted === true;
            result = await listRemindersItems(listName, includeCompleted);
            break;
        }
        case 'reminders_add_item': {
            const listName = data.listName;
            const title = data.title;
            if (!listName || !title) {
                result = { success: false, message: 'Missing listName or title' };
                break;
            }
            result = await addRemindersItem(listName, title, data.notes, data.dueDate);
            break;
        }
        case 'reminders_complete_item': {
            const listName = data.listName;
            const itemTitle = data.itemTitle;
            if (!listName || !itemTitle) {
                result = { success: false, message: 'Missing listName or itemTitle' };
                break;
            }
            result = await completeRemindersItem(listName, itemTitle);
            break;
        }
        case 'reminders_remove_item': {
            const listName = data.listName;
            const itemTitle = data.itemTitle;
            if (!listName || !itemTitle) {
                result = { success: false, message: 'Missing listName or itemTitle' };
                break;
            }
            result = await removeRemindersItem(listName, itemTitle);
            break;
        }
        default:
            // Type starts with reminders_ but is not recognized
            return false;
    }
    writeResult(dataDir, sourceGroup, requestId, result);
    if (result.success) {
        logger.info({ type, requestId }, 'Reminders request completed');
    }
    else {
        logger.error({ type, requestId, message: result.message }, 'Reminders request failed');
    }
    return true;
}
//# sourceMappingURL=host.js.map