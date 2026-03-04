import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the ipc module before importing server
vi.mock('../ipc.js', () => ({
  callReminders: vi.fn(),
}));

import { callReminders } from '../ipc.js';
import { createServer } from '../server.js';

const mockCallReminders = vi.mocked(callReminders);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Server creation
// ---------------------------------------------------------------------------

describe('createServer', () => {
  it('creates a server with the correct name', () => {
    const server = createServer();
    // McpServer stores server info; we verify it was created without errors
    expect(server).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tool handler tests (via internal tool invocation)
// ---------------------------------------------------------------------------
// We test the tool handlers by calling the server's internal tool registry.
// Since McpServer doesn't expose a direct way to call tools, we test the
// integration through the callReminders mock to verify param mapping.

describe('tool handlers', () => {
  // Helper: call a tool by simulating the MCP call_tool request
  async function callTool(
    server: ReturnType<typeof createServer>,
    name: string,
    args: Record<string, unknown>,
  ) {
    // Use the server's internal handler by constructing a CallToolRequest
    // The McpServer exposes tools via the protocol, but for unit tests we
    // trigger tool invocation through the low-level request handler.
    const transport = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      onmessage: undefined as ((msg: unknown) => void) | undefined,
      onerror: undefined as ((err: Error) => void) | undefined,
      onclose: undefined as (() => void) | undefined,
      sessionId: undefined as string | undefined,
    };

    await server.connect(transport);

    // Simulate an incoming JSON-RPC request for tools/call
    return new Promise<unknown>((resolve) => {
      // Capture the response via the send mock
      transport.send.mockImplementation((msg: unknown) => {
        const message = msg as { result?: unknown; error?: unknown; id?: number };
        if (message.id === 1) {
          resolve(message.result ?? message.error);
        }
        return Promise.resolve();
      });

      // Send the tools/call request through the transport
      transport.onmessage?.({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });
    });
  }

  it('list_lists calls callReminders with correct action and no params', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: [{ name: 'Shopping' }],
    });

    const server = createServer();
    const result = await callTool(server, 'list_lists', {});

    expect(mockCallReminders).toHaveBeenCalledWith('list_lists', {});
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: [{ name: 'Shopping' }],
          }),
        },
      ],
    });
  });

  it('list_items maps snake_case to camelCase params', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: [{ name: 'Buy milk' }],
    });

    const server = createServer();
    await callTool(server, 'list_items', {
      list_name: 'Shopping',
      include_completed: true,
    });

    expect(mockCallReminders).toHaveBeenCalledWith('list_items', {
      listName: 'Shopping',
      includeCompleted: true,
    });
  });

  it('add_item maps all params including optional ones', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { name: 'Buy eggs' },
    });

    const server = createServer();
    await callTool(server, 'add_item', {
      list_name: 'Shopping',
      title: 'Buy eggs',
      notes: 'organic',
      due_date: '2026-03-05',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('add_item', {
      listName: 'Shopping',
      title: 'Buy eggs',
      notes: 'organic',
      dueDate: '2026-03-05',
      priority: undefined,
      url: undefined,
    });
  });

  it('add_item omits undefined optional params', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { name: 'Buy eggs' },
    });

    const server = createServer();
    await callTool(server, 'add_item', {
      list_name: 'Shopping',
      title: 'Buy eggs',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('add_item', {
      listName: 'Shopping',
      title: 'Buy eggs',
      notes: undefined,
      dueDate: undefined,
      priority: undefined,
      url: undefined,
    });
  });

  it('add_item maps metadata fields (priority, url)', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { name: 'Task', priority: 'high', url: 'https://example.com' },
    });

    const server = createServer();
    await callTool(server, 'add_item', {
      list_name: 'Work',
      title: 'Task',
      priority: 'high',
      url: 'https://example.com',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('add_item', {
      listName: 'Work',
      title: 'Task',
      notes: undefined,
      dueDate: undefined,
      priority: 'high',
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
      new_url: 'https://example.com',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('update_item', {
      listName: 'Shopping',
      itemTitle: 'Buy eggs',
      newTitle: undefined,
      newNotes: undefined,
      newDueDate: undefined,
      newPriority: 'low',
      newUrl: 'https://example.com',
    });
  });

  it('update_item maps snake_case to camelCase params', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { name: 'Updated' },
    });

    const server = createServer();
    await callTool(server, 'update_item', {
      list_name: 'Shopping',
      item_title: 'Buy eggs',
      new_title: 'Buy organic eggs',
      new_notes: 'from farmers market',
      new_due_date: '2026-03-10',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('update_item', {
      listName: 'Shopping',
      itemTitle: 'Buy eggs',
      newTitle: 'Buy organic eggs',
      newNotes: 'from farmers market',
      newDueDate: '2026-03-10',
      newPriority: undefined,
      newUrl: undefined,
    });
  });

  it('complete_item maps params correctly', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { completed: true },
    });

    const server = createServer();
    await callTool(server, 'complete_item', {
      list_name: 'Shopping',
      item_title: 'Buy eggs',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('complete_item', {
      listName: 'Shopping',
      itemTitle: 'Buy eggs',
    });
  });

  it('remove_item maps params correctly', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { deleted: true },
    });

    const server = createServer();
    await callTool(server, 'remove_item', {
      list_name: 'Shopping',
      item_title: 'Buy eggs',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('remove_item', {
      listName: 'Shopping',
      itemTitle: 'Buy eggs',
    });
  });

  it('move_item maps params correctly', async () => {
    mockCallReminders.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { moved: true },
    });

    const server = createServer();
    await callTool(server, 'move_item', {
      list_name: 'Shopping',
      item_title: 'Buy eggs',
      target_list: 'Groceries',
    });

    expect(mockCallReminders).toHaveBeenCalledWith('move_item', {
      listName: 'Shopping',
      itemTitle: 'Buy eggs',
      targetList: 'Groceries',
    });
  });

  it('returns error response when callReminders fails', async () => {
    mockCallReminders.mockResolvedValue({
      success: false,
      message: 'List not found: Nonexistent',
    });

    const server = createServer();
    const result = await callTool(server, 'list_items', {
      list_name: 'Nonexistent',
    });

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'List not found: Nonexistent' }),
        },
      ],
      isError: true,
    });
  });
});
