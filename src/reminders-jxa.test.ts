import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { execFile } from 'child_process';

import {
  addRemindersItem,
  completeRemindersItem,
  listRemindersItems,
  listRemindersLists,
  moveRemindersItem,
  removeRemindersItem,
  updateRemindersItem,
} from './reminders-jxa.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function mockJxaSuccess(stdout: string) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, stdout, '');
    return undefined as any;
  });
}

function mockJxaError(stderr: string) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    const err = new Error('osascript failed');
    cb(err, '', stderr);
    return undefined as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- listRemindersLists ---

describe('listRemindersLists', () => {
  it('returns parsed list data on success', async () => {
    const lists = [
      { name: 'Shopping', id: 'x-apple-reminder://list1', count: 3, completedCount: 5 },
      { name: 'Work', id: 'x-apple-reminder://list2', count: 1, completedCount: 0 },
    ];
    mockJxaSuccess(JSON.stringify(lists));

    const result = await listRemindersLists();

    expect(result.success).toBe(true);
    expect(result.data).toEqual(lists);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith(
      'osascript',
      ['-l', 'JavaScript', '-e', expect.any(String)],
      { timeout: 15000 },
      expect.any(Function),
    );
  });

  it('returns error result on JXA failure', async () => {
    mockJxaError('Reminders got an error: something went wrong');

    const result = await listRemindersLists();

    expect(result.success).toBe(false);
    expect(result.message).toContain('osascript failed');
  });

  it('returns error result when stdout is not valid JSON', async () => {
    mockJxaSuccess('not valid json{');

    const result = await listRemindersLists();

    expect(result.success).toBe(false);
    expect(result.message).toContain('parse');
  });
});

// --- listRemindersItems ---

describe('listRemindersItems', () => {
  it('returns items from the specified list', async () => {
    const items = [
      { name: 'Buy milk', notes: '', dueDate: null, completed: false },
      { name: 'Buy eggs', notes: 'Free range', dueDate: '2026-03-05', completed: false },
    ];
    mockJxaSuccess(JSON.stringify(items));

    const result = await listRemindersItems('Shopping');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(items);

    // Verify the JXA script contains the list name passed via JSON.stringify
    const script = mockExecFile.mock.calls[0][2 + 1 - 2]; // the -e arg
    // Actually let's check the args array
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('"Shopping"');
  });

  it('passes includeCompleted=false by default', async () => {
    mockJxaSuccess(JSON.stringify([]));

    await listRemindersItems('Work');

    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('false');
  });

  it('passes includeCompleted=true when specified', async () => {
    mockJxaSuccess(JSON.stringify([]));

    await listRemindersItems('Work', true);

    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('true');
  });

  it('handles JXA errors gracefully', async () => {
    mockJxaError('list not found');

    const result = await listRemindersItems('NonExistent');

    expect(result.success).toBe(false);
    expect(result.message).toContain('osascript failed');
  });
});

// --- addRemindersItem ---

describe('addRemindersItem', () => {
  it('creates item with title only', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'New item', completed: false }));

    const result = await addRemindersItem('Shopping', 'New item');

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('"New item"');
    expect(jxaScript).toContain('"Shopping"');
  });

  it('creates item with notes and dueDate', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Task', notes: 'Do it', dueDate: '2026-03-10' }));

    const result = await addRemindersItem('Work', 'Task', 'Do it', '2026-03-10T09:00:00');

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('"Task"');
    expect(jxaScript).toContain('"Do it"');
    expect(jxaScript).toContain('2026-03-10T09:00:00');
  });

  it('handles JXA errors gracefully', async () => {
    mockJxaError('access denied');

    const result = await addRemindersItem('Shopping', 'New item');

    expect(result.success).toBe(false);
  });
});

// --- updateRemindersItem ---

describe('updateRemindersItem', () => {
  it('updates title of existing item', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Updated title', completed: false }));

    const result = await updateRemindersItem('Shopping', 'Old title', { newTitle: 'Updated title' });

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('"Updated title"');
  });

  it('updates notes of existing item', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Item', notes: 'New notes' }));

    const result = await updateRemindersItem('Shopping', 'Item', { newNotes: 'New notes' });

    expect(result.success).toBe(true);
  });

  it('updates dueDate of existing item', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Item', dueDate: '2026-04-01' }));

    const result = await updateRemindersItem('Shopping', 'Item', {
      newDueDate: '2026-04-01T10:00:00',
    });

    expect(result.success).toBe(true);
  });

  it('updates multiple fields at once', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'New name', notes: 'New notes' }));

    const result = await updateRemindersItem('Shopping', 'Item', {
      newTitle: 'New name',
      newNotes: 'New notes',
      newDueDate: '2026-04-01T10:00:00',
    });

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('"New name"');
    expect(jxaScript).toContain('"New notes"');
    expect(jxaScript).toContain('2026-04-01T10:00:00');
  });

  it('returns error when no update fields provided', async () => {
    const result = await updateRemindersItem('Shopping', 'Item', {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('No update fields');
    // Should NOT have called osascript at all
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('handles JXA errors gracefully', async () => {
    mockJxaError('item not found');

    const result = await updateRemindersItem('Shopping', 'Ghost', { newTitle: 'X' });

    expect(result.success).toBe(false);
  });
});

// --- completeRemindersItem ---

describe('completeRemindersItem', () => {
  it('marks item as completed', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Buy milk', completed: true }));

    const result = await completeRemindersItem('Shopping', 'Buy milk');

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('"Buy milk"');
    expect(jxaScript).toContain('"Shopping"');
    expect(jxaScript).toContain('completed');
  });

  it('handles JXA errors gracefully', async () => {
    mockJxaError('item not found');

    const result = await completeRemindersItem('Shopping', 'Ghost item');

    expect(result.success).toBe(false);
  });
});

// --- removeRemindersItem ---

describe('removeRemindersItem', () => {
  it('deletes item from list', async () => {
    mockJxaSuccess(JSON.stringify({ deleted: true }));

    const result = await removeRemindersItem('Shopping', 'Buy milk');

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('"Buy milk"');
    expect(jxaScript).toContain('"Shopping"');
  });

  it('handles JXA errors gracefully', async () => {
    mockJxaError('item not found');

    const result = await removeRemindersItem('Shopping', 'Ghost item');

    expect(result.success).toBe(false);
  });
});

// --- moveRemindersItem ---

describe('moveRemindersItem', () => {
  it('moves item between lists', async () => {
    mockJxaSuccess(JSON.stringify({ moved: true, name: 'Buy milk' }));

    const result = await moveRemindersItem('Shopping', 'Buy milk', 'Groceries');

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain('"Shopping"');
    expect(jxaScript).toContain('"Buy milk"');
    expect(jxaScript).toContain('"Groceries"');
  });

  it('handles JXA errors gracefully', async () => {
    mockJxaError('list not found');

    const result = await moveRemindersItem('Shopping', 'Buy milk', 'NonExistent');

    expect(result.success).toBe(false);
  });
});

// --- Input sanitization ---

describe('input sanitization', () => {
  it('handles quotes in item titles', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Item with "quotes"' }));

    const result = await addRemindersItem('Shopping', 'Item with "quotes"');

    expect(result.success).toBe(true);
    // The script should use JSON.stringify which escapes quotes
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    // JSON.stringify('Item with "quotes"') produces: "Item with \"quotes\""
    expect(jxaScript).toContain('\\"quotes\\"');
  });

  it('handles backslashes in item titles', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'path\\to\\file' }));

    const result = await addRemindersItem('Shopping', 'path\\to\\file');

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    // JSON.stringify('path\\to\\file') produces: "path\\to\\file"
    expect(jxaScript).toContain('\\\\');
  });

  it('handles single quotes in list names', async () => {
    mockJxaSuccess(JSON.stringify([]));

    const result = await listRemindersItems("Ethan's List");

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    expect(jxaScript).toContain("Ethan's List");
  });

  it('handles newlines in notes', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Item', notes: 'line1\nline2' }));

    const result = await addRemindersItem('Shopping', 'Item', 'line1\nline2');

    expect(result.success).toBe(true);
    const args = mockExecFile.mock.calls[0][1] as string[];
    const jxaScript = args[args.length - 1];
    // JSON.stringify escapes newlines as \n
    expect(jxaScript).toContain('\\n');
  });

  it('handles special characters in move operation', async () => {
    mockJxaSuccess(JSON.stringify({ moved: true }));

    const result = await moveRemindersItem(
      'List "A"',
      'Item with \\backslash',
      "Target's List",
    );

    expect(result.success).toBe(true);
  });
});
