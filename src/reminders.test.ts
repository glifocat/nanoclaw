import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process.execFile before importing the module
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';
import {
  listRemindersLists,
  listRemindersItems,
  addRemindersItem,
  completeRemindersItem,
  removeRemindersItem,
} from './reminders.js';

const mockExecFile = vi.mocked(execFile);

// Helper: make execFile resolve with stdout
function mockJxaSuccess(stdout: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    (cb as Function)(null, stdout, '');
    return undefined as any;
  });
}

// Helper: make execFile reject with stderr
function mockJxaError(stderr: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    const err = new Error('osascript failed');
    (cb as Function)(err, '', stderr);
    return undefined as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Input sanitization
// ---------------------------------------------------------------------------
describe('input sanitization', () => {
  it('handles list names with parentheses like "Compra (Súper)"', async () => {
    mockJxaSuccess(JSON.stringify([{ name: 'leche', completed: false, dueDate: null, body: null }]));

    const result = await listRemindersItems('Compra (Súper)');
    expect(result.success).toBe(true);

    // Verify the script includes the properly JSON-stringified name
    // JSON.stringify keeps ú as literal UTF-8 (not escaped), and wraps in quotes
    const args = mockExecFile.mock.calls[0][1] as string[];
    const script = args[args.length - 1];
    expect(script).toContain('"Compra (Súper)"');
  });

  it('handles item titles with quotes and backslashes', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'test"item\\here', completed: true }));

    const result = await completeRemindersItem('My List', 'test"item\\here');
    expect(result.success).toBe(true);

    const args = mockExecFile.mock.calls[0][1] as string[];
    const script = args[args.length - 1];
    // JSON.stringify escapes quotes and backslashes
    expect(script).toContain('test\\"item\\\\here');
  });

  it('handles empty string inputs gracefully', async () => {
    mockJxaError('List not found: ');

    const result = await listRemindersItems('');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to list items');
  });

  it('handles unicode characters in list names', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'café', dueDate: null }));

    const result = await addRemindersItem('Lista café ☕', 'café');
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error handling — functions never throw
// ---------------------------------------------------------------------------
describe('error handling', () => {
  it('listRemindersLists returns error result on TCC denial', async () => {
    mockJxaError('Not authorized to send Apple events to Reminders');

    const result = await listRemindersLists();
    expect(result.success).toBe(false);
    expect(result.message).toContain('Not authorized');
  });

  it('listRemindersItems returns error for non-existent list', async () => {
    mockJxaError('List not found: Nonexistent');

    const result = await listRemindersItems('Nonexistent');
    expect(result.success).toBe(false);
    expect(result.message).toContain('List not found');
  });

  it('completeRemindersItem returns error for non-existent item', async () => {
    mockJxaError('Item not found: Ghost Item');

    const result = await completeRemindersItem('My List', 'Ghost Item');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Item not found');
  });

  it('removeRemindersItem returns error for non-existent item', async () => {
    mockJxaError('Item not found: Ghost Item');

    const result = await removeRemindersItem('My List', 'Ghost Item');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Item not found');
  });

  it('addRemindersItem returns error for non-existent list', async () => {
    mockJxaError('List not found: Nope');

    const result = await addRemindersItem('Nope', 'item');
    expect(result.success).toBe(false);
    expect(result.message).toContain('List not found');
  });
});

// ---------------------------------------------------------------------------
// Success paths
// ---------------------------------------------------------------------------
describe('success paths', () => {
  it('listRemindersLists returns lists with counts', async () => {
    const lists = [
      { name: 'Compra (Súper)', count: 5 },
      { name: 'Personal', count: 2 },
    ];
    mockJxaSuccess(JSON.stringify(lists));

    const result = await listRemindersLists();
    expect(result.success).toBe(true);
    expect(result.data).toEqual(lists);
    expect(result.message).toBe('Found 2 list(s)');
  });

  it('listRemindersItems returns items', async () => {
    const items = [
      { name: 'Leche', completed: false, dueDate: null, body: null },
      { name: 'Pan', completed: false, dueDate: '2026-02-23T00:00:00.000Z', body: 'integral' },
    ];
    mockJxaSuccess(JSON.stringify(items));

    const result = await listRemindersItems('Compra (Súper)');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(items);
    expect(result.message).toContain('2 item(s)');
  });

  it('addRemindersItem with optional notes and dueDate', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Leche', dueDate: '2026-02-23T09:00:00.000Z' }));

    const result = await addRemindersItem('Compra (Súper)', 'Leche', 'deslactosada', '2026-02-23T09:00:00');
    expect(result.success).toBe(true);
    expect(result.message).toContain('Added "Leche"');
  });

  it('addRemindersItem without optional params', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Leche', dueDate: null }));

    const result = await addRemindersItem('Compra (Súper)', 'Leche');
    expect(result.success).toBe(true);

    // Verify no dueDate line in script
    const args = mockExecFile.mock.calls[0][1] as string[];
    const script = args[args.length - 1];
    expect(script).not.toContain('props.dueDate');
  });

  it('completeRemindersItem marks item as done', async () => {
    mockJxaSuccess(JSON.stringify({ name: 'Leche', completed: true }));

    const result = await completeRemindersItem('Compra (Súper)', 'Leche');
    expect(result.success).toBe(true);
    expect(result.message).toContain('Completed "Leche"');
  });

  it('removeRemindersItem deletes item', async () => {
    mockJxaSuccess(JSON.stringify({ deleted: 'Leche' }));

    const result = await removeRemindersItem('Compra (Súper)', 'Leche');
    expect(result.success).toBe(true);
    expect(result.message).toContain('Removed "Leche"');
  });
});
