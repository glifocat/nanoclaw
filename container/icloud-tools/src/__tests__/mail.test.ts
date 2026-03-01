import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock IMAP client
// ---------------------------------------------------------------------------
const mockImapClient = vi.hoisted(() => ({
  connect: vi.fn(),
  getMailboxLock: vi.fn(),
  fetch: vi.fn(),
  search: vi.fn(),
  messageFlagsAdd: vi.fn(),
  messageFlagsRemove: vi.fn(),
  messageMove: vi.fn(),
  messageDelete: vi.fn(),
  append: vi.fn(),
  list: vi.fn(),
  mailbox: { exists: 10 },
}));

// ---------------------------------------------------------------------------
// Mock SMTP transport
// ---------------------------------------------------------------------------
const mockSmtpTransport = vi.hoisted(() => ({
  sendMail: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock lock
// ---------------------------------------------------------------------------
const mockLock = vi.hoisted(() => ({
  release: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  getImapClient: vi.fn().mockResolvedValue(mockImapClient),
  getSmtpTransport: vi.fn().mockReturnValue(mockSmtpTransport),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock IMAP message for fetch() async iterator. */
function mockMessage(opts: {
  uid: number;
  subject?: string;
  from?: string;
  to?: string;
  date?: Date;
  flags?: string[];
  source?: string;
}) {
  return {
    uid: opts.uid,
    envelope: {
      subject: opts.subject ?? 'Test Subject',
      from: [{ name: opts.from ?? 'Sender', address: opts.from ?? 'sender@test.com' }],
      to: [{ name: opts.to ?? 'Me', address: opts.to ?? 'me@icloud.com' }],
      cc: [],
      date: opts.date ?? new Date('2026-03-01T10:00:00Z'),
      messageId: `<msg-${opts.uid}@test.com>`,
      inReplyTo: null,
    },
    flags: new Set(opts.flags ?? []),
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

import {
  handleListFolders,
  handleListMessages,
  handleReadMessage,
  handleSend,
  handleReply,
  handleForward,
  handleSearch,
  handleCreateDraft,
  handleUpdateDraft,
  handleFlag,
  handleMarkRead,
  handleMove,
} from '../modules/mail.js';

describe('mail module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImapClient.getMailboxLock.mockResolvedValue(mockLock);
    mockImapClient.mailbox = { exists: 10 };
  });

  // ---------------------------------------------------------------------------
  // list_folders
  // ---------------------------------------------------------------------------
  describe('list_folders', () => {
    it('returns folder list with message counts', async () => {
      mockImapClient.list.mockResolvedValue([
        { path: 'INBOX', name: 'INBOX', status: { messages: 42, unseen: 5 } },
        { path: 'Sent Messages', name: 'Sent Messages', status: { messages: 100, unseen: 0 } },
        { path: 'Drafts', name: 'Drafts', status: { messages: 3, unseen: 0 } },
      ]);

      const result = await handleListFolders();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);
      expect(data.data[0]).toEqual({
        name: 'INBOX',
        path: 'INBOX',
        messageCount: 42,
        unread: 5,
      });
      expect(data.data[1]).toEqual({
        name: 'Sent Messages',
        path: 'Sent Messages',
        messageCount: 100,
        unread: 0,
      });
    });

    it('handles empty folder list', async () => {
      mockImapClient.list.mockResolvedValue([]);

      const result = await handleListFolders();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0);
    });

    it('returns error on failure', async () => {
      mockImapClient.list.mockRejectedValue(new Error('Connection lost'));

      const result = await handleListFolders();
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/connection lost/i);
      expect(result.isError).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // list_messages
  // ---------------------------------------------------------------------------
  describe('list_messages', () => {
    it('returns message summaries from INBOX by default', async () => {
      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({ uid: 1, subject: 'Hello', from: 'alice@test.com', flags: ['\\Seen'] }),
          mockMessage({ uid: 2, subject: 'Urgent', from: 'bob@test.com', flags: ['\\Flagged'] }),
        ]),
      );

      const result = await handleListMessages({});
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0].subject).toBe('Hello');
      expect(data.data[0].read).toBe(true);
      expect(data.data[0].flagged).toBe(false);
      expect(data.data[1].subject).toBe('Urgent');
      expect(data.data[1].read).toBe(false);
      expect(data.data[1].flagged).toBe(true);

      // Should acquire and release lock
      expect(mockImapClient.getMailboxLock).toHaveBeenCalledWith('INBOX');
      expect(mockLock.release).toHaveBeenCalled();
    });

    it('uses custom folder when specified', async () => {
      mockImapClient.fetch.mockReturnValue(asyncIter([]));

      await handleListMessages({ folder: 'Sent Messages' });
      expect(mockImapClient.getMailboxLock).toHaveBeenCalledWith('Sent Messages');
    });

    it('returns empty array when mailbox is empty', async () => {
      mockImapClient.mailbox = { exists: 0 };
      // When mailbox is empty, no fetch should happen
      const result = await handleListMessages({});
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0);
    });

    it('releases lock even on error', async () => {
      mockImapClient.fetch.mockImplementation(() => {
        throw new Error('Fetch failed');
      });

      const result = await handleListMessages({});
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/fetch failed/i);
      expect(mockLock.release).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // read_message
  // ---------------------------------------------------------------------------
  describe('read_message', () => {
    it('reads full message by UID', async () => {
      const rawMime =
        'From: alice@test.com\r\n' +
        'To: me@icloud.com\r\n' +
        'Cc: bob@test.com\r\n' +
        'Subject: Hello World\r\n' +
        'Date: Sun, 01 Mar 2026 10:00:00 +0000\r\n' +
        '\r\n' +
        'This is the body of the email.';

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({
            uid: 42,
            subject: 'Hello World',
            from: 'alice@test.com',
            to: 'me@icloud.com',
            source: rawMime,
          }),
        ]),
      );

      const result = await handleReadMessage({ id: 42 });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.subject).toBe('Hello World');
      expect(data.data.body).toContain('This is the body of the email.');

      // Fetched with uid: true
      expect(mockImapClient.getMailboxLock).toHaveBeenCalledWith('INBOX');
      expect(mockLock.release).toHaveBeenCalled();
    });

    it('returns error when message not found', async () => {
      mockImapClient.fetch.mockReturnValue(asyncIter([]));

      const result = await handleReadMessage({ id: 999 });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------------------
  // send
  // ---------------------------------------------------------------------------
  describe('send', () => {
    it('sends email via SMTP with correct args', async () => {
      mockSmtpTransport.sendMail.mockResolvedValue({ messageId: '<sent-1@test.com>' });

      const result = await handleSend({
        to: 'alice@test.com',
        subject: 'Test Email',
        body: 'Hello Alice!',
        cc: 'bob@test.com',
        bcc: 'eve@test.com',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.messageId).toBe('<sent-1@test.com>');

      const sendArg = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendArg.to).toBe('alice@test.com');
      expect(sendArg.subject).toBe('Test Email');
      expect(sendArg.text).toBe('Hello Alice!');
      expect(sendArg.cc).toBe('bob@test.com');
      expect(sendArg.bcc).toBe('eve@test.com');
    });

    it('sends email without optional cc/bcc', async () => {
      mockSmtpTransport.sendMail.mockResolvedValue({ messageId: '<sent-2@test.com>' });

      const result = await handleSend({
        to: 'alice@test.com',
        subject: 'Minimal',
        body: 'Hi',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const sendArg = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendArg.cc).toBeUndefined();
      expect(sendArg.bcc).toBeUndefined();
    });

    it('returns error on SMTP failure', async () => {
      mockSmtpTransport.sendMail.mockRejectedValue(new Error('SMTP auth failed'));

      const result = await handleSend({
        to: 'alice@test.com',
        subject: 'Test',
        body: 'Hi',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/smtp auth failed/i);
      expect(result.isError).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // reply
  // ---------------------------------------------------------------------------
  describe('reply', () => {
    it('replies to original sender with Re: prefix', async () => {
      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({
            uid: 10,
            subject: 'Question',
            from: 'alice@test.com',
          }),
        ]),
      );
      mockSmtpTransport.sendMail.mockResolvedValue({ messageId: '<reply-1@test.com>' });

      const result = await handleReply({ id: 10, body: 'The answer is 42.' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const sendArg = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendArg.to).toBe('alice@test.com');
      expect(sendArg.subject).toBe('Re: Question');
      expect(sendArg.text).toBe('The answer is 42.');
      expect(sendArg.inReplyTo).toBe('<msg-10@test.com>');
    });

    it('does not double Re: prefix', async () => {
      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({
            uid: 11,
            subject: 'Re: Question',
            from: 'alice@test.com',
          }),
        ]),
      );
      mockSmtpTransport.sendMail.mockResolvedValue({ messageId: '<reply-2@test.com>' });

      const result = await handleReply({ id: 11, body: 'Follow up' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const sendArg = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendArg.subject).toBe('Re: Question');
    });

    it('reply_all includes cc recipients', async () => {
      const msg = mockMessage({
        uid: 12,
        subject: 'Team Discussion',
        from: 'alice@test.com',
        to: 'me@icloud.com',
      });
      msg.envelope.cc = [{ name: 'Bob', address: 'bob@test.com' }];
      mockImapClient.fetch.mockReturnValue(asyncIter([msg]));
      mockSmtpTransport.sendMail.mockResolvedValue({ messageId: '<reply-3@test.com>' });

      const result = await handleReply({ id: 12, body: 'Agreed', reply_all: true });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const sendArg = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendArg.to).toBe('alice@test.com');
      expect(sendArg.cc).toContain('bob@test.com');
    });

    it('returns error when original message not found', async () => {
      mockImapClient.fetch.mockReturnValue(asyncIter([]));

      const result = await handleReply({ id: 999, body: 'Reply' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------------------
  // forward
  // ---------------------------------------------------------------------------
  describe('forward', () => {
    it('forwards message to new recipient', async () => {
      const rawMime =
        'From: alice@test.com\r\n' +
        'Subject: Important\r\n' +
        '\r\n' +
        'Original body content.';

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({
            uid: 20,
            subject: 'Important',
            from: 'alice@test.com',
            source: rawMime,
          }),
        ]),
      );
      mockSmtpTransport.sendMail.mockResolvedValue({ messageId: '<fwd-1@test.com>' });

      const result = await handleForward({
        id: 20,
        to: 'charlie@test.com',
        body: 'FYI see below',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const sendArg = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendArg.to).toBe('charlie@test.com');
      expect(sendArg.subject).toBe('Fwd: Important');
      expect(sendArg.text).toContain('FYI see below');
      expect(sendArg.text).toContain('Original body content.');
    });

    it('forwards without additional body', async () => {
      const rawMime =
        'From: alice@test.com\r\n' +
        'Subject: FYI\r\n' +
        '\r\n' +
        'Check this out.';

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({
            uid: 21,
            subject: 'FYI',
            from: 'alice@test.com',
            source: rawMime,
          }),
        ]),
      );
      mockSmtpTransport.sendMail.mockResolvedValue({ messageId: '<fwd-2@test.com>' });

      const result = await handleForward({ id: 21, to: 'charlie@test.com' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const sendArg = mockSmtpTransport.sendMail.mock.calls[0][0];
      expect(sendArg.text).toContain('Check this out.');
    });

    it('returns error when original message not found', async () => {
      mockImapClient.fetch.mockReturnValue(asyncIter([]));

      const result = await handleForward({ id: 999, to: 'charlie@test.com' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------
  describe('search', () => {
    it('searches inbox by default and returns results', async () => {
      // search returns UIDs
      mockImapClient.search.mockResolvedValue([1, 5, 10]);
      // then fetches those UIDs for details
      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({ uid: 1, subject: 'Match 1', from: 'alice@test.com' }),
          mockMessage({ uid: 5, subject: 'Match 2', from: 'bob@test.com' }),
          mockMessage({ uid: 10, subject: 'Match 3', from: 'charlie@test.com' }),
        ]),
      );

      const result = await handleSearch({ query: 'test query' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);
      expect(data.data[0].subject).toBe('Match 1');
      expect(data.data[0].id).toBe(1);

      // Search called with correct query structure
      expect(mockImapClient.search).toHaveBeenCalled();
    });

    it('searches in specified folder', async () => {
      mockImapClient.search.mockResolvedValue([]);

      const result = await handleSearch({ query: 'test', folder: 'Sent Messages' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0);

      expect(mockImapClient.getMailboxLock).toHaveBeenCalledWith('Sent Messages');
    });

    it('returns empty array when no matches', async () => {
      mockImapClient.search.mockResolvedValue([]);

      const result = await handleSearch({ query: 'nonexistent' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0);
    });

    it('returns error on failure', async () => {
      mockImapClient.search.mockRejectedValue(new Error('Search failed'));

      const result = await handleSearch({ query: 'test' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/search failed/i);
      expect(result.isError).toBe(true);
      expect(mockLock.release).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // create_draft
  // ---------------------------------------------------------------------------
  describe('create_draft', () => {
    it('creates a draft message in Drafts folder', async () => {
      mockImapClient.append.mockResolvedValue({ uid: 100 });

      const result = await handleCreateDraft({
        to: 'alice@test.com',
        subject: 'Draft Subject',
        body: 'Draft body text',
        cc: 'bob@test.com',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();

      // Should append to Drafts with \\Draft flag
      const appendArgs = mockImapClient.append.mock.calls[0];
      expect(appendArgs[0]).toBe('Drafts');
      expect(appendArgs[1]).toContain('To: alice@test.com');
      expect(appendArgs[1]).toContain('Subject: Draft Subject');
      expect(appendArgs[1]).toContain('Cc: bob@test.com');
      expect(appendArgs[1]).toContain('Draft body text');
      expect(appendArgs[2]).toEqual(['\\Draft']);
    });

    it('creates draft without optional fields', async () => {
      mockImapClient.append.mockResolvedValue({ uid: 101 });

      const result = await handleCreateDraft({
        to: 'alice@test.com',
        subject: 'Simple Draft',
        body: 'Content',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const appendArgs = mockImapClient.append.mock.calls[0];
      expect(appendArgs[1]).not.toContain('Cc:');
      expect(appendArgs[1]).not.toContain('Bcc:');
    });

    it('returns error on failure', async () => {
      mockImapClient.append.mockRejectedValue(new Error('Append failed'));

      const result = await handleCreateDraft({
        to: 'alice@test.com',
        subject: 'Draft',
        body: 'Body',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/append failed/i);
      expect(result.isError).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // update_draft
  // ---------------------------------------------------------------------------
  describe('update_draft', () => {
    it('deletes old draft and creates new one', async () => {
      // Fetch the existing draft
      const rawMime =
        'To: alice@test.com\r\n' +
        'Subject: Old Subject\r\n' +
        '\r\n' +
        'Old body.';

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({
            uid: 50,
            subject: 'Old Subject',
            to: 'alice@test.com',
            source: rawMime,
          }),
        ]),
      );
      mockImapClient.messageDelete.mockResolvedValue(true);
      mockImapClient.append.mockResolvedValue({ uid: 51 });

      const result = await handleUpdateDraft({
        id: 50,
        subject: 'Updated Subject',
        body: 'Updated body',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      // Should delete old draft
      expect(mockImapClient.messageDelete).toHaveBeenCalledWith(50, { uid: true });

      // Should append new draft
      const appendArgs = mockImapClient.append.mock.calls[0];
      expect(appendArgs[0]).toBe('Drafts');
      expect(appendArgs[1]).toContain('Subject: Updated Subject');
      expect(appendArgs[1]).toContain('Updated body');
      expect(appendArgs[2]).toEqual(['\\Draft']);
    });

    it('preserves unchanged fields', async () => {
      const rawMime =
        'To: alice@test.com\r\n' +
        'Subject: Keep This\r\n' +
        '\r\n' +
        'Keep this body.';

      mockImapClient.fetch.mockReturnValue(
        asyncIter([
          mockMessage({
            uid: 52,
            subject: 'Keep This',
            to: 'alice@test.com',
            source: rawMime,
          }),
        ]),
      );
      mockImapClient.messageDelete.mockResolvedValue(true);
      mockImapClient.append.mockResolvedValue({ uid: 53 });

      // Only update the body, keep subject and to
      const result = await handleUpdateDraft({
        id: 52,
        body: 'New body only',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const appendArgs = mockImapClient.append.mock.calls[0];
      expect(appendArgs[1]).toContain('Subject: Keep This');
      expect(appendArgs[1]).toContain('To: alice@test.com');
      expect(appendArgs[1]).toContain('New body only');
    });

    it('returns error when draft not found', async () => {
      mockImapClient.fetch.mockReturnValue(asyncIter([]));

      const result = await handleUpdateDraft({ id: 999, subject: 'New' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------------------
  // flag
  // ---------------------------------------------------------------------------
  describe('flag', () => {
    it('adds \\Flagged flag when flagged=true', async () => {
      mockImapClient.messageFlagsAdd.mockResolvedValue(true);

      const result = await handleFlag({ id: 1, flagged: true });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.success).toBe(true);

      expect(mockImapClient.messageFlagsAdd).toHaveBeenCalledWith(1, ['\\Flagged'], { uid: true });
    });

    it('removes \\Flagged flag when flagged=false', async () => {
      mockImapClient.messageFlagsRemove.mockResolvedValue(true);

      const result = await handleFlag({ id: 1, flagged: false });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.success).toBe(true);

      expect(mockImapClient.messageFlagsRemove).toHaveBeenCalledWith(1, ['\\Flagged'], { uid: true });
    });

    it('releases lock on error', async () => {
      mockImapClient.messageFlagsAdd.mockRejectedValue(new Error('Flag error'));

      const result = await handleFlag({ id: 1, flagged: true });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/flag error/i);
      expect(mockLock.release).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // mark_read
  // ---------------------------------------------------------------------------
  describe('mark_read', () => {
    it('adds \\Seen flag when read=true', async () => {
      mockImapClient.messageFlagsAdd.mockResolvedValue(true);

      const result = await handleMarkRead({ id: 5, read: true });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.success).toBe(true);

      expect(mockImapClient.messageFlagsAdd).toHaveBeenCalledWith(5, ['\\Seen'], { uid: true });
    });

    it('removes \\Seen flag when read=false', async () => {
      mockImapClient.messageFlagsRemove.mockResolvedValue(true);

      const result = await handleMarkRead({ id: 5, read: false });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.success).toBe(true);

      expect(mockImapClient.messageFlagsRemove).toHaveBeenCalledWith(5, ['\\Seen'], { uid: true });
    });

    it('releases lock on error', async () => {
      mockImapClient.messageFlagsRemove.mockRejectedValue(new Error('Seen error'));

      const result = await handleMarkRead({ id: 5, read: false });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/seen error/i);
      expect(mockLock.release).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // move
  // ---------------------------------------------------------------------------
  describe('move', () => {
    it('moves message to target folder', async () => {
      mockImapClient.messageMove.mockResolvedValue(true);

      const result = await handleMove({ id: 7, target_folder: 'Archive' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.success).toBe(true);

      expect(mockImapClient.messageMove).toHaveBeenCalledWith(7, 'Archive', { uid: true });
    });

    it('releases lock on error', async () => {
      mockImapClient.messageMove.mockRejectedValue(new Error('Move failed'));

      const result = await handleMove({ id: 7, target_folder: 'Trash' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/move failed/i);
      expect(mockLock.release).toHaveBeenCalled();
    });
  });
});
