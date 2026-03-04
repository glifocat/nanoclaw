import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemindersResult } from './reminders-jxa.js';

// Mock reminders-jxa before importing the module under test
vi.mock('./reminders-jxa.js', () => ({
  listRemindersLists: vi.fn(),
  listRemindersItems: vi.fn(),
  addRemindersItem: vi.fn(),
  updateRemindersItem: vi.fn(),
  completeRemindersItem: vi.fn(),
  removeRemindersItem: vi.fn(),
  moveRemindersItem: vi.fn(),
}));

// Mock fs.mkdirSync and fs.writeFileSync
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import {
  addRemindersItem,
  completeRemindersItem,
  listRemindersItems,
  listRemindersLists,
  moveRemindersItem,
  removeRemindersItem,
  updateRemindersItem,
} from './reminders-jxa.js';
import { handleRemindersIpc } from './reminders-ipc.js';

const DATA_DIR = '/tmp/test-data';
const SOURCE_GROUP = 'test-group';

function okResult(data?: unknown): RemindersResult {
  return { success: true, message: 'OK', data: data ?? null };
}

function errorResult(msg: string): RemindersResult {
  return { success: false, message: msg };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Non-reminders types
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - non-reminders types', () => {
  it('returns false for non-reminders type', async () => {
    const result = await handleRemindersIpc(
      { type: 'schedule_task', requestId: 'req-1' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );
    expect(result).toBe(false);
  });

  it('returns false for unknown reminders subtype', async () => {
    const result = await handleRemindersIpc(
      { type: 'reminders_unknown_action', requestId: 'req-1' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );
    expect(result).toBe(false);
  });

  it('returns false when type is not a string', async () => {
    const result = await handleRemindersIpc(
      { type: 123, requestId: 'req-1' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requestId validation
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - requestId validation', () => {
  it('rejects path traversal in requestId', async () => {
    const result = await handleRemindersIpc(
      { type: 'reminders_list_lists', requestId: '../../../etc/passwd' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );
    // Handled (true) but blocked — no JXA call, no file written
    expect(result).toBe(true);
    expect(listRemindersLists).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects empty requestId', async () => {
    const result = await handleRemindersIpc(
      { type: 'reminders_list_lists', requestId: '' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );
    expect(result).toBe(true);
    expect(listRemindersLists).not.toHaveBeenCalled();
  });

  it('rejects missing requestId', async () => {
    const result = await handleRemindersIpc(
      { type: 'reminders_list_lists' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );
    expect(result).toBe(true);
    expect(listRemindersLists).not.toHaveBeenCalled();
  });

  it('rejects requestId with spaces', async () => {
    const result = await handleRemindersIpc(
      { type: 'reminders_list_lists', requestId: 'has spaces' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );
    expect(result).toBe(true);
    expect(listRemindersLists).not.toHaveBeenCalled();
  });

  it('accepts valid requestId with alphanumeric, hyphens, underscores', async () => {
    vi.mocked(listRemindersLists).mockResolvedValue(okResult([]));

    const result = await handleRemindersIpc(
      { type: 'reminders_list_lists', requestId: 'Abc-123_def' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );
    expect(result).toBe(true);
    expect(listRemindersLists).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reminders_list_lists
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - reminders_list_lists', () => {
  it('dispatches to listRemindersLists and writes result', async () => {
    const mockData = [{ name: 'Shopping', count: 3 }];
    vi.mocked(listRemindersLists).mockResolvedValue(okResult(mockData));

    const result = await handleRemindersIpc(
      { type: 'reminders_list_lists', requestId: 'req-list-1' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(result).toBe(true);
    expect(listRemindersLists).toHaveBeenCalledOnce();
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(DATA_DIR, 'ipc', SOURCE_GROUP, 'reminders_results'),
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(DATA_DIR, 'ipc', SOURCE_GROUP, 'reminders_results', 'req-list-1.json'),
      JSON.stringify(okResult(mockData)),
    );
  });
});

// ---------------------------------------------------------------------------
// reminders_list_items
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - reminders_list_items', () => {
  it('dispatches with correct params', async () => {
    const items = [{ name: 'Buy milk', completed: false }];
    vi.mocked(listRemindersItems).mockResolvedValue(okResult(items));

    const result = await handleRemindersIpc(
      {
        type: 'reminders_list_items',
        requestId: 'req-items-1',
        listName: 'Shopping',
        includeCompleted: true,
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(result).toBe(true);
    expect(listRemindersItems).toHaveBeenCalledWith('Shopping', true);
    expect(fs.writeFileSync).toHaveBeenCalledOnce();
  });

  it('defaults includeCompleted to false when not provided', async () => {
    vi.mocked(listRemindersItems).mockResolvedValue(okResult([]));

    await handleRemindersIpc(
      {
        type: 'reminders_list_items',
        requestId: 'req-items-2',
        listName: 'Work',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(listRemindersItems).toHaveBeenCalledWith('Work', false);
  });

  it('writes error result when listName is missing', async () => {
    const result = await handleRemindersIpc(
      { type: 'reminders_list_items', requestId: 'req-items-3' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(result).toBe(true);
    expect(listRemindersItems).not.toHaveBeenCalled();
    // Should write an error result
    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
    expect(writtenJson.message).toMatch(/listName/i);
  });
});

// ---------------------------------------------------------------------------
// reminders_add_item
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - reminders_add_item', () => {
  it('dispatches with all params', async () => {
    vi.mocked(addRemindersItem).mockResolvedValue(
      okResult({ name: 'Buy eggs', notes: 'organic', dueDate: '2026-03-05', completed: false }),
    );

    const result = await handleRemindersIpc(
      {
        type: 'reminders_add_item',
        requestId: 'req-add-1',
        listName: 'Shopping',
        title: 'Buy eggs',
        notes: 'organic',
        dueDate: '2026-03-05',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(result).toBe(true);
    expect(addRemindersItem).toHaveBeenCalledWith(
      'Shopping', 'Buy eggs', 'organic', '2026-03-05', undefined,
    );
  });

  it('dispatches without optional params', async () => {
    vi.mocked(addRemindersItem).mockResolvedValue(okResult({ name: 'Buy eggs' }));

    await handleRemindersIpc(
      {
        type: 'reminders_add_item',
        requestId: 'req-add-2',
        listName: 'Shopping',
        title: 'Buy eggs',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(addRemindersItem).toHaveBeenCalledWith(
      'Shopping', 'Buy eggs', undefined, undefined, undefined,
    );
  });

  it('forwards priority metadata field', async () => {
    vi.mocked(addRemindersItem).mockResolvedValue(
      okResult({ name: 'Task', priority: 'high' }),
    );

    await handleRemindersIpc(
      {
        type: 'reminders_add_item',
        requestId: 'req-add-meta-1',
        listName: 'Work',
        title: 'Task',
        priority: 'high',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(addRemindersItem).toHaveBeenCalledWith(
      'Work', 'Task', undefined, undefined, 'high',
    );
  });

  it('writes error result when required params are missing', async () => {
    // Missing title
    await handleRemindersIpc(
      { type: 'reminders_add_item', requestId: 'req-add-3', listName: 'Shopping' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(addRemindersItem).not.toHaveBeenCalled();
    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
    expect(writtenJson.message).toMatch(/title/i);
  });

  it('writes error when listName is missing', async () => {
    await handleRemindersIpc(
      { type: 'reminders_add_item', requestId: 'req-add-4', title: 'Buy eggs' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(addRemindersItem).not.toHaveBeenCalled();
    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
    expect(writtenJson.message).toMatch(/listName/i);
  });
});

// ---------------------------------------------------------------------------
// reminders_update_item
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - reminders_update_item', () => {
  it('dispatches with update fields', async () => {
    vi.mocked(updateRemindersItem).mockResolvedValue(okResult({ name: 'Updated' }));

    await handleRemindersIpc(
      {
        type: 'reminders_update_item',
        requestId: 'req-upd-1',
        listName: 'Shopping',
        itemTitle: 'Buy eggs',
        newTitle: 'Buy organic eggs',
        newNotes: 'from farmers market',
        newDueDate: '2026-03-10',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(updateRemindersItem).toHaveBeenCalledWith('Shopping', 'Buy eggs', {
      newTitle: 'Buy organic eggs',
      newNotes: 'from farmers market',
      newDueDate: '2026-03-10',
      newPriority: undefined,
    });
  });

  it('forwards newPriority metadata update field', async () => {
    vi.mocked(updateRemindersItem).mockResolvedValue(okResult({ name: 'Updated' }));

    await handleRemindersIpc(
      {
        type: 'reminders_update_item',
        requestId: 'req-upd-meta-1',
        listName: 'Shopping',
        itemTitle: 'Buy eggs',
        newPriority: 'low',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(updateRemindersItem).toHaveBeenCalledWith('Shopping', 'Buy eggs', {
      newTitle: undefined,
      newNotes: undefined,
      newDueDate: undefined,
      newPriority: 'low',
    });
  });

  it('writes error when listName is missing', async () => {
    await handleRemindersIpc(
      {
        type: 'reminders_update_item',
        requestId: 'req-upd-2',
        itemTitle: 'Buy eggs',
        newTitle: 'Updated',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(updateRemindersItem).not.toHaveBeenCalled();
    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
  });

  it('writes error when itemTitle is missing', async () => {
    await handleRemindersIpc(
      {
        type: 'reminders_update_item',
        requestId: 'req-upd-3',
        listName: 'Shopping',
        newTitle: 'Updated',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(updateRemindersItem).not.toHaveBeenCalled();
    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reminders_complete_item
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - reminders_complete_item', () => {
  it('dispatches with correct params', async () => {
    vi.mocked(completeRemindersItem).mockResolvedValue(
      okResult({ name: 'Buy eggs', completed: true }),
    );

    await handleRemindersIpc(
      {
        type: 'reminders_complete_item',
        requestId: 'req-comp-1',
        listName: 'Shopping',
        itemTitle: 'Buy eggs',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(completeRemindersItem).toHaveBeenCalledWith('Shopping', 'Buy eggs');
  });

  it('writes error when required params are missing', async () => {
    await handleRemindersIpc(
      { type: 'reminders_complete_item', requestId: 'req-comp-2', listName: 'Shopping' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(completeRemindersItem).not.toHaveBeenCalled();
    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reminders_remove_item
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - reminders_remove_item', () => {
  it('dispatches with correct params', async () => {
    vi.mocked(removeRemindersItem).mockResolvedValue(okResult({ deleted: true }));

    await handleRemindersIpc(
      {
        type: 'reminders_remove_item',
        requestId: 'req-rem-1',
        listName: 'Shopping',
        itemTitle: 'Buy eggs',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(removeRemindersItem).toHaveBeenCalledWith('Shopping', 'Buy eggs');
  });

  it('writes error when required params are missing', async () => {
    await handleRemindersIpc(
      { type: 'reminders_remove_item', requestId: 'req-rem-2' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(removeRemindersItem).not.toHaveBeenCalled();
    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reminders_move_item
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - reminders_move_item', () => {
  it('dispatches with correct params', async () => {
    vi.mocked(moveRemindersItem).mockResolvedValue(okResult({ moved: true, name: 'Buy eggs' }));

    await handleRemindersIpc(
      {
        type: 'reminders_move_item',
        requestId: 'req-move-1',
        listName: 'Shopping',
        itemTitle: 'Buy eggs',
        targetList: 'Groceries',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(moveRemindersItem).toHaveBeenCalledWith('Shopping', 'Buy eggs', 'Groceries');
  });

  it('writes error when targetList is missing', async () => {
    await handleRemindersIpc(
      {
        type: 'reminders_move_item',
        requestId: 'req-move-2',
        listName: 'Shopping',
        itemTitle: 'Buy eggs',
      },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    expect(moveRemindersItem).not.toHaveBeenCalled();
    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Result writing path
// ---------------------------------------------------------------------------

describe('handleRemindersIpc - result writing', () => {
  it('writes result to the correct nested path', async () => {
    vi.mocked(listRemindersLists).mockResolvedValue(okResult([]));

    await handleRemindersIpc(
      { type: 'reminders_list_lists', requestId: 'my-req-42' },
      'passion',
      true,
      '/data/nanoclaw',
    );

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join('/data/nanoclaw', 'ipc', 'passion', 'reminders_results'),
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join('/data/nanoclaw', 'ipc', 'passion', 'reminders_results', 'my-req-42.json'),
      expect.any(String),
    );
  });

  it('writes error results from failed JXA calls', async () => {
    vi.mocked(listRemindersLists).mockResolvedValue(errorResult('osascript failed: timeout'));

    await handleRemindersIpc(
      { type: 'reminders_list_lists', requestId: 'req-err-1' },
      SOURCE_GROUP,
      false,
      DATA_DIR,
    );

    const writtenJson = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenJson.success).toBe(false);
    expect(writtenJson.message).toContain('osascript failed');
  });
});
