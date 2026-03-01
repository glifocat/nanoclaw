# icloud-tools: ipc.ts changes

Two changes:

1. Remove the import: `import { handleRemindersIpc } from './reminders-ipc.js';`
2. Simplify the `default` case in `processTaskIpc` switch -- replace the `handleRemindersIpc` delegation with just `logger.warn({ type: data.type }, 'Unknown IPC task type');`

The reminders IPC handler is no longer needed since reminders are now handled by the icloud-tools MCP server inside the container.
