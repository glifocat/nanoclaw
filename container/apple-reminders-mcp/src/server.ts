/**
 * Apple Reminders MCP stdio server.
 *
 * Standalone MCP server that exposes Apple Reminders operations as tools.
 * Each tool call is bridged to the host via IPC files — the container writes
 * a task file, the host-side watcher processes it via JXA, and writes a
 * result file that this server polls for.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { callReminders } from './ipc.js';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ success: true, data }) },
    ],
  };
}

function err(message: string) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ error: message }) },
    ],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// Server factory (exported for testing)
// ---------------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'apple-reminders',
    version: '1.0.0',
  });

  // -----------------------------------------------------------------------
  // list_lists
  // -----------------------------------------------------------------------
  server.tool(
    'list_lists',
    'List all Apple Reminders lists.',
    {},
    async () => {
      const result = await callReminders('list_lists', {});
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );

  // -----------------------------------------------------------------------
  // list_items
  // -----------------------------------------------------------------------
  server.tool(
    'list_items',
    'List items in an Apple Reminders list.',
    {
      list_name: z.string().describe('Name of the reminders list'),
      include_completed: z
        .boolean()
        .optional()
        .describe('Include completed items (default: false)'),
    },
    async (args) => {
      const result = await callReminders('list_items', {
        listName: args.list_name,
        includeCompleted: args.include_completed ?? false,
      });
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );

  // -----------------------------------------------------------------------
  // add_item
  // -----------------------------------------------------------------------
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
    },
    async (args) => {
      const result = await callReminders('add_item', {
        listName: args.list_name,
        title: args.title,
        notes: args.notes,
        dueDate: args.due_date,
      });
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );

  // -----------------------------------------------------------------------
  // update_item
  // -----------------------------------------------------------------------
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
    },
    async (args) => {
      const result = await callReminders('update_item', {
        listName: args.list_name,
        itemTitle: args.item_title,
        newTitle: args.new_title,
        newNotes: args.new_notes,
        newDueDate: args.new_due_date,
      });
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );

  // -----------------------------------------------------------------------
  // complete_item
  // -----------------------------------------------------------------------
  server.tool(
    'complete_item',
    'Mark an item as completed in an Apple Reminders list.',
    {
      list_name: z.string().describe('Name of the reminders list'),
      item_title: z
        .string()
        .describe('Title of the reminder to mark as completed'),
    },
    async (args) => {
      const result = await callReminders('complete_item', {
        listName: args.list_name,
        itemTitle: args.item_title,
      });
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );

  // -----------------------------------------------------------------------
  // remove_item
  // -----------------------------------------------------------------------
  server.tool(
    'remove_item',
    'Remove (delete) an item from an Apple Reminders list.',
    {
      list_name: z.string().describe('Name of the reminders list'),
      item_title: z.string().describe('Title of the reminder to remove'),
    },
    async (args) => {
      const result = await callReminders('remove_item', {
        listName: args.list_name,
        itemTitle: args.item_title,
      });
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );

  // -----------------------------------------------------------------------
  // move_item
  // -----------------------------------------------------------------------
  server.tool(
    'move_item',
    'Move an item from one Apple Reminders list to another.',
    {
      list_name: z.string().describe('Name of the source reminders list'),
      item_title: z.string().describe('Title of the reminder to move'),
      target_list: z
        .string()
        .describe('Name of the destination reminders list'),
    },
    async (args) => {
      const result = await callReminders('move_item', {
        listName: args.list_name,
        itemTitle: args.item_title,
        targetList: args.target_list,
      });
      if (!result.success) return err(result.message);
      return ok(result.data);
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Main entry point (skip during tests)
// ---------------------------------------------------------------------------

if (!process.env.VITEST) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
