import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs before importing the module under test
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import {
  generateRequestId,
  writeIpcTask,
  waitForResult,
  TASKS_DIR,
  RESULTS_DIR,
} from '../ipc.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// generateRequestId
// ---------------------------------------------------------------------------

describe('generateRequestId', () => {
  it('produces correct format: rem-{action}-{timestamp}-{random6}', () => {
    const id = generateRequestId('list_lists');
    expect(id).toMatch(/^rem-list_lists-\d+-[a-z0-9]{1,6}$/);
  });

  it('produces unique IDs on successive calls', () => {
    const a = generateRequestId('add_item');
    const b = generateRequestId('add_item');
    expect(a).not.toBe(b);
  });

  it('includes the action name in the ID', () => {
    const id = generateRequestId('complete_item');
    expect(id).toContain('complete_item');
  });
});

// ---------------------------------------------------------------------------
// writeIpcTask
// ---------------------------------------------------------------------------

describe('writeIpcTask', () => {
  it('writes JSON to the correct path with atomic rename', () => {
    writeIpcTask('rem-test-123-abc', { type: 'reminders_list_lists', requestId: 'rem-test-123-abc' });

    expect(fs.mkdirSync).toHaveBeenCalledWith(TASKS_DIR, { recursive: true });

    const expectedPath = path.join(TASKS_DIR, 'rem-test-123-abc.json');
    const expectedTmpPath = `${expectedPath}.tmp`;

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expectedTmpPath,
      expect.stringContaining('"reminders_list_lists"'),
    );
    expect(fs.renameSync).toHaveBeenCalledWith(expectedTmpPath, expectedPath);
  });

  it('writes valid JSON', () => {
    writeIpcTask('rem-add-456-def', {
      type: 'reminders_add_item',
      requestId: 'rem-add-456-def',
      listName: 'Shopping',
      title: 'Buy milk',
    });

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.type).toBe('reminders_add_item');
    expect(parsed.listName).toBe('Shopping');
    expect(parsed.title).toBe('Buy milk');
  });
});

// ---------------------------------------------------------------------------
// waitForResult
// ---------------------------------------------------------------------------

describe('waitForResult', () => {
  it('returns result when file exists immediately', async () => {
    const resultData = { success: true, message: 'OK', data: [{ name: 'Shopping' }] };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(resultData));

    const promise = waitForResult('rem-test-1', 50, 500);

    // Advance past the first check
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result).toEqual(resultData);
  });

  it('polls and returns result when file appears later', async () => {
    const resultData = { success: true, message: 'OK', data: [] };

    // File doesn't exist for first 2 checks, then appears
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(resultData));

    const promise = waitForResult('rem-test-2', 50, 5000);

    // First check — no file
    await vi.advanceTimersByTimeAsync(0);
    // Second poll — no file
    await vi.advanceTimersByTimeAsync(50);
    // Third poll — file exists
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toEqual(resultData);
  });

  it('cleans up the result file after reading', async () => {
    const resultData = { success: true, message: 'OK' };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(resultData));

    const promise = waitForResult('rem-cleanup-1', 50, 500);
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(fs.unlinkSync).toHaveBeenCalledWith(
      path.join(RESULTS_DIR, 'rem-cleanup-1.json'),
    );
  });

  it('times out when file never appears', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const promise = waitForResult('rem-timeout-1', 50, 200);

    // Attach the rejection handler BEFORE advancing timers to avoid
    // vitest's unhandled rejection detection.
    const assertion = expect(promise).rejects.toThrow(
      /Timed out.*rem-timeout-1.*200ms/,
    );

    // Advance enough time to exceed the timeout
    await vi.advanceTimersByTimeAsync(300);

    await assertion;
  });

  it('still resolves if unlinkSync fails (best-effort cleanup)', async () => {
    const resultData = { success: true, message: 'OK', data: null };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(resultData));
    vi.mocked(fs.unlinkSync).mockImplementation(() => {
      throw new Error('EACCES');
    });

    const promise = waitForResult('rem-nocleanup-1', 50, 500);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result).toEqual(resultData);
  });
});
