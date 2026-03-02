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

function mockCliSuccess(data: unknown) {
  const output = JSON.stringify({ success: true, message: 'OK', data });
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, output, '');
    return undefined as any;
  });
}

function mockCliError(message: string) {
  const output = JSON.stringify({ success: false, message });
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    const err = new Error('exit code 1');
    cb(err, output, '');
    return undefined as any;
  });
}

function mockExecError(message: string) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    const err = new Error(message);
    cb(err, '', message);
    return undefined as any;
  });
}

function getCliArgs(): string[] {
  return mockExecFile.mock.calls[0][1] as string[];
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
    mockCliSuccess(lists);

    const result = await listRemindersLists();

    expect(result.success).toBe(true);
    expect(result.data).toEqual(lists);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const args = getCliArgs();
    expect(args).toEqual(['list_lists']);
  });

  it('returns error result on CLI failure', async () => {
    mockCliError('Reminders access denied');

    const result = await listRemindersLists();

    expect(result.success).toBe(false);
    expect(result.message).toContain('access denied');
  });

  it('returns error result when stdout is not valid JSON', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, 'not valid json{', '');
      return undefined as any;
    });

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
    mockCliSuccess(items);

    const result = await listRemindersItems('Shopping');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(items);

    const args = getCliArgs();
    expect(args).toEqual(['list_items', 'Shopping']);
  });

  it('passes --include-completed flag when specified', async () => {
    mockCliSuccess([]);

    await listRemindersItems('Work', true);

    const args = getCliArgs();
    expect(args).toEqual(['list_items', 'Work', '--include-completed']);
  });

  it('does not pass --include-completed by default', async () => {
    mockCliSuccess([]);

    await listRemindersItems('Work');

    const args = getCliArgs();
    expect(args).toEqual(['list_items', 'Work']);
  });

  it('handles CLI errors gracefully', async () => {
    mockCliError('List not found: NonExistent');

    const result = await listRemindersItems('NonExistent');

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// --- addRemindersItem ---

describe('addRemindersItem', () => {
  it('creates item with title only', async () => {
    mockCliSuccess({ name: 'New item', completed: false });

    const result = await addRemindersItem('Shopping', 'New item');

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toEqual(['add_item', 'Shopping', 'New item']);
  });

  it('creates item with notes and dueDate', async () => {
    mockCliSuccess({ name: 'Task', notes: 'Do it', dueDate: '2026-03-10' });

    const result = await addRemindersItem('Work', 'Task', 'Do it', '2026-03-10T09:00:00');

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toEqual([
      'add_item', 'Work', 'Task',
      '--notes', 'Do it',
      '--due', '2026-03-10T09:00:00',
    ]);
  });

  it('handles CLI errors gracefully', async () => {
    mockCliError('access denied');

    const result = await addRemindersItem('Shopping', 'New item');

    expect(result.success).toBe(false);
  });
});

// --- updateRemindersItem ---

describe('updateRemindersItem', () => {
  it('updates title of existing item', async () => {
    mockCliSuccess({ name: 'Updated title', completed: false });

    const result = await updateRemindersItem('Shopping', 'Old title', { newTitle: 'Updated title' });

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toEqual([
      'update_item', 'Shopping', 'Old title',
      '--new-title', 'Updated title',
    ]);
  });

  it('updates notes of existing item', async () => {
    mockCliSuccess({ name: 'Item', notes: 'New notes' });

    const result = await updateRemindersItem('Shopping', 'Item', { newNotes: 'New notes' });

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--new-notes');
    expect(args).toContain('New notes');
  });

  it('updates dueDate of existing item', async () => {
    mockCliSuccess({ name: 'Item', dueDate: '2026-04-01' });

    const result = await updateRemindersItem('Shopping', 'Item', {
      newDueDate: '2026-04-01T10:00:00',
    });

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--new-due');
    expect(args).toContain('2026-04-01T10:00:00');
  });

  it('updates multiple fields at once', async () => {
    mockCliSuccess({ name: 'New name', notes: 'New notes' });

    const result = await updateRemindersItem('Shopping', 'Item', {
      newTitle: 'New name',
      newNotes: 'New notes',
      newDueDate: '2026-04-01T10:00:00',
    });

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toContain('--new-title');
    expect(args).toContain('--new-notes');
    expect(args).toContain('--new-due');
  });

  it('returns error when no update fields provided', async () => {
    const result = await updateRemindersItem('Shopping', 'Item', {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('No update fields');
    // Should NOT have called CLI at all
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('handles CLI errors gracefully', async () => {
    mockCliError('item not found');

    const result = await updateRemindersItem('Shopping', 'Ghost', { newTitle: 'X' });

    expect(result.success).toBe(false);
  });
});

// --- completeRemindersItem ---

describe('completeRemindersItem', () => {
  it('marks item as completed', async () => {
    mockCliSuccess({ name: 'Buy milk', completed: true });

    const result = await completeRemindersItem('Shopping', 'Buy milk');

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toEqual(['complete_item', 'Shopping', 'Buy milk']);
  });

  it('handles CLI errors gracefully', async () => {
    mockCliError('item not found');

    const result = await completeRemindersItem('Shopping', 'Ghost item');

    expect(result.success).toBe(false);
  });
});

// --- removeRemindersItem ---

describe('removeRemindersItem', () => {
  it('deletes item from list', async () => {
    mockCliSuccess({ deleted: true });

    const result = await removeRemindersItem('Shopping', 'Buy milk');

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toEqual(['remove_item', 'Shopping', 'Buy milk']);
  });

  it('handles CLI errors gracefully', async () => {
    mockCliError('item not found');

    const result = await removeRemindersItem('Shopping', 'Ghost item');

    expect(result.success).toBe(false);
  });
});

// --- moveRemindersItem ---

describe('moveRemindersItem', () => {
  it('moves item between lists', async () => {
    mockCliSuccess({ moved: true, name: 'Buy milk' });

    const result = await moveRemindersItem('Shopping', 'Buy milk', 'Groceries');

    expect(result.success).toBe(true);
    const args = getCliArgs();
    expect(args).toEqual(['move_item', 'Shopping', 'Buy milk', 'Groceries']);
  });

  it('handles CLI errors gracefully', async () => {
    mockCliError('list not found');

    const result = await moveRemindersItem('Shopping', 'Buy milk', 'NonExistent');

    expect(result.success).toBe(false);
  });
});

// --- Edge cases ---

describe('edge cases', () => {
  it('handles empty stdout gracefully', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, '', '');
      return undefined as any;
    });

    const result = await listRemindersLists();

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('handles exec failure without JSON output', async () => {
    mockExecError('spawn ENOENT');

    const result = await listRemindersLists();

    expect(result.success).toBe(false);
    expect(result.message).toContain('reminders-cli failed');
  });

  it('passes special characters in arguments safely', async () => {
    mockCliSuccess({ name: 'Item with "quotes"', completed: false });

    const result = await addRemindersItem('Shopping', 'Item with "quotes"');

    expect(result.success).toBe(true);
    const args = getCliArgs();
    // Arguments passed directly, no shell escaping needed (execFile, not exec)
    expect(args[2]).toBe('Item with "quotes"');
  });

  it('uses 30s timeout', async () => {
    mockCliSuccess([]);

    await listRemindersLists();

    const opts = mockExecFile.mock.calls[0][2] as { timeout: number };
    expect(opts.timeout).toBe(30000);
  });
});
