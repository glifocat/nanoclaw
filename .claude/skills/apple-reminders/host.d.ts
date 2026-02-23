/**
 * Apple Reminders IPC Handler
 *
 * Handles all reminders_* IPC messages from container agents.
 * Follows the same pattern as x-integration/host.ts.
 */
/**
 * Handle Apple Reminders IPC messages.
 *
 * @returns true if message was handled, false if not a reminders message
 */
export declare function handleRemindersIpc(data: Record<string, unknown>, sourceGroup: string, _isMain: boolean, dataDir: string): Promise<boolean>;
//# sourceMappingURL=host.d.ts.map