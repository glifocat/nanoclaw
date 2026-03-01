import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock IMAP client
// ---------------------------------------------------------------------------
const mockImapClient = vi.hoisted(() => ({
  connect: vi.fn(),
  getMailboxLock: vi.fn(),
  fetch: vi.fn(),
  mailbox: { exists: 5 },
}));

// ---------------------------------------------------------------------------
// Mock lock
// ---------------------------------------------------------------------------
const mockLock = vi.hoisted(() => ({
  release: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  getImapClient: vi.fn().mockResolvedValue(mockImapClient),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock IMAP note message for fetch() async iterator. */
function mockNote(opts: {
  uid: number;
  subject?: string;
  date?: Date;
  source?: string;
}) {
  return {
    uid: opts.uid,
    envelope: {
      subject: opts.subject ?? 'Untitled Note',
      date: opts.date ?? new Date('2026-03-01T10:00:00Z'),
    },
    source: opts.source ? Buffer.from(opts.source) : undefined,
  };
}

/** Create an async generator from an array of mock messages. */
function asyncIter<T>(items: T[]) {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

import { handleList, handleRead } from '../modules/notes.js';

describe('notes module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImapClient.getMailboxLock.mockResolvedValue(mockLock);
    mockImapClient.mailbox = { exists: 5 };
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------
  describe('list', () => {
    it('lists notes from Notes folder with correct fields', async () => {
      const rawMime1 =
        'Subject: Shopping List\r\n' +
        'Date: Sun, 01 Mar 2026 10:00:00 +0000\r\n' +
        '\r\n' +
        'Milk, eggs, bread, butter and some other items for the week.';
      const rawMime2 =
        'Subject: Meeting Notes\r\n' +
        'Date: Sun, 01 Mar 2026 11:00:00 +0000\r\n' +
        '\r\n' +
        'Discussed project timeline and deliverables for Q2.';

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockNote({
            uid: 1,
            subject: 'Shopping List',
            date: new Date('2026-03-01T10:00:00Z'),
            source: rawMime1,
          }),
          mockNote({
            uid: 2,
            subject: 'Meeting Notes',
            date: new Date('2026-03-01T11:00:00Z'),
            source: rawMime2,
          }),
        ]),
      );

      const result = await handleList({});
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);

      expect(data.data[0]).toEqual({
        id: '1',
        title: 'Shopping List',
        date: '2026-03-01T10:00:00.000Z',
        snippet: 'Milk, eggs, bread, butter and some other items for the week.',
      });
      expect(data.data[1]).toEqual({
        id: '2',
        title: 'Meeting Notes',
        date: '2026-03-01T11:00:00.000Z',
        snippet: 'Discussed project timeline and deliverables for Q2.',
      });

      // Should open the Notes folder
      expect(mockImapClient.getMailboxLock).toHaveBeenCalledWith('Notes');
      expect(mockLock.release).toHaveBeenCalled();
    });

    it('uses custom subfolder when provided', async () => {
      mockImapClient.fetch.mockReturnValue(asyncIter([]));
      mockImapClient.mailbox = { exists: 0 };

      await handleList({ folder: 'Notes/Work' });
      expect(mockImapClient.getMailboxLock).toHaveBeenCalledWith('Notes/Work');
    });

    it('truncates snippet to 100 characters', async () => {
      const longBody = 'A'.repeat(200);
      const rawMime =
        'Subject: Long Note\r\n' +
        '\r\n' +
        longBody;

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockNote({ uid: 3, subject: 'Long Note', source: rawMime }),
        ]),
      );

      const result = await handleList({});
      const data = JSON.parse(result.content[0].text);
      expect(data.data[0].snippet).toHaveLength(100);
      expect(data.data[0].snippet).toBe('A'.repeat(100));
    });

    it('replaces newlines with spaces in snippet', async () => {
      const rawMime =
        'Subject: Multi-line\r\n' +
        '\r\n' +
        'Line one\r\nLine two\r\nLine three';

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockNote({ uid: 4, subject: 'Multi-line', source: rawMime }),
        ]),
      );

      const result = await handleList({});
      const data = JSON.parse(result.content[0].text);
      expect(data.data[0].snippet).toBe('Line one Line two Line three');
    });

    it('returns empty array when mailbox is empty', async () => {
      mockImapClient.mailbox = { exists: 0 };

      const result = await handleList({});
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0);
    });

    it('releases lock even on error', async () => {
      mockImapClient.fetch.mockImplementation(() => {
        throw new Error('Fetch failed');
      });

      const result = await handleList({});
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/fetch failed/i);
      expect(mockLock.release).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // read
  // ---------------------------------------------------------------------------
  describe('read', () => {
    it('reads single note by UID and returns full body', async () => {
      const rawMime =
        'Subject: My Important Note\r\n' +
        'Date: Sun, 01 Mar 2026 10:00:00 +0000\r\n' +
        '\r\n' +
        'This is the full body of my important note.\r\n' +
        'It has multiple lines.\r\n' +
        'And even a third one.';

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockNote({
            uid: 42,
            subject: 'My Important Note',
            date: new Date('2026-03-01T10:00:00Z'),
            source: rawMime,
          }),
        ]),
      );

      const result = await handleRead({ id: '42' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe('My Important Note');
      expect(data.data.date).toBe('2026-03-01T10:00:00.000Z');
      expect(data.data.body).toContain('This is the full body of my important note.');
      expect(data.data.body).toContain('And even a third one.');

      // Should open Notes folder and fetch with UID
      expect(mockImapClient.getMailboxLock).toHaveBeenCalledWith('Notes');
      expect(mockLock.release).toHaveBeenCalled();
    });

    it('returns error when note not found', async () => {
      mockImapClient.fetch.mockReturnValue(asyncIter([]));

      const result = await handleRead({ id: '999' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
      expect(result.isError).toBe(true);
    });

    it('releases lock on error', async () => {
      mockImapClient.fetch.mockImplementation(() => {
        throw new Error('Connection lost');
      });

      const result = await handleRead({ id: '1' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/connection lost/i);
      expect(mockLock.release).toHaveBeenCalled();
    });
  });
});
