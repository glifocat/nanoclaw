import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelSetup } from './adapter.js';
import {
  createMatrixAdapter,
  matrixPlatformId,
  parseMatrixConfig,
  withoutRedirects,
  type MatrixClientLike,
  type MatrixConfig,
  type MatrixSdkDeps,
} from './matrix.js';

class FakeStorage {
  private readonly values = new Map<string, string>();

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, '{}', { mode: 0o600 });
  }

  readValue(key: string): string | undefined {
    return this.values.get(key);
  }

  storeValue(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class FakeCryptoStorage {
  static initialDeviceId: string | null = null;
  private deviceId: string | null = FakeCryptoStorage.initialDeviceId;

  constructor(_directory: string, _storeType: number) {}

  async getDeviceId(): Promise<string | null> {
    return this.deviceId;
  }

  async setDeviceId(deviceId: string): Promise<void> {
    this.deviceId = deviceId;
  }
}

class FakeAuth {
  static passwordLogin = vi.fn(async () => ({ accessToken: 'logged-in-token' }));
  constructor(_baseUrl: string) {}
  passwordLogin = FakeAuth.passwordLogin;
}

class FakeClient implements MatrixClientLike {
  static latest: FakeClient;
  static directData: Record<string, string[]> = {};
  static accountDataError: unknown = null;

  readonly handlers = new Map<string, Array<(...args: never[]) => unknown>>();
  readonly sentMessages: Array<{ roomId: string; content: Record<string, unknown>; eventId: string }> = [];
  readonly sentEvents: Array<{
    roomId: string;
    eventType: string;
    content: Record<string, unknown>;
    eventId: string;
  }> = [];
  readonly redactions: Array<{ roomId: string; eventId: string }> = [];
  readonly joins: string[] = [];
  readonly typing: string[] = [];
  readonly uploads: Array<{ data: Buffer; contentType: string; filename: string; url: string }> = [];
  readonly accountDataCalls: string[] = [];
  readonly dmUpdates: number[] = [];
  readonly dmRooms = new Map<string, string>();
  joinedRooms = ['!dm:example.test', '!room:example.test', '!two:example.test'];
  roomNames = new Map([['!room:example.test', 'General']]);
  private sequence = 0;

  readonly dms = {
    getOrCreateDm: async (userId: string): Promise<string> => {
      const existing = this.dmRooms.get(userId);
      if (existing) return existing;
      const roomId = `!created-${this.dmRooms.size}:example.test`;
      this.dmRooms.set(userId, roomId);
      return roomId;
    },
    update: async (): Promise<void> => {
      this.dmUpdates.push(Date.now());
    },
  };

  roomEncrypted = false;
  readonly crypto = {
    prepare: async (_roomIds: string[]): Promise<void> => {},
    isRoomEncrypted: async (_roomId: string): Promise<boolean> => this.roomEncrypted,
    encryptMedia: async (data: Buffer) => ({
      buffer: Buffer.concat([Buffer.from('encrypted:'), data]),
      file: {
        key: { k: 'key' },
        iv: 'iv',
        hashes: { sha256: 'hash' },
        v: 'v2',
      },
    }),
    decryptMedia: async (_file: unknown): Promise<Buffer> => Buffer.from('decrypted attachment'),
  };

  constructor(_baseUrl: string, _accessToken: string, _storage: FakeStorage, _cryptoStorage?: FakeCryptoStorage) {
    FakeClient.latest = this;
    for (const [userId, rooms] of Object.entries(FakeClient.directData)) {
      if (rooms[0]) this.dmRooms.set(userId, rooms[0]);
    }
  }

  on(event: string, handler: (...args: never[]) => unknown): unknown {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...(args as never[]));
  }

  async getUserId(): Promise<string> {
    return '@bot:example.test';
  }

  async getWhoAmI(): Promise<{ user_id: string; device_id: string }> {
    return { user_id: '@bot:example.test', device_id: 'BOTDEVICE' };
  }

  async getAccountData<T>(eventType: string): Promise<T> {
    this.accountDataCalls.push(eventType);
    if (FakeClient.accountDataError) throw FakeClient.accountDataError;
    return FakeClient.directData as T;
  }

  async getJoinedRooms(): Promise<string[]> {
    return this.joinedRooms;
  }

  async getJoinedRoomMembers(_roomId: string): Promise<string[]> {
    return ['@bot:example.test', '@alice:example.test'];
  }

  async getRoomStateEvent(roomId: string): Promise<{ name: string }> {
    const name = this.roomNames.get(roomId);
    if (!name) throw new Error('M_NOT_FOUND');
    return { name };
  }

  async joinRoom(roomId: string): Promise<string> {
    this.joins.push(roomId);
    return roomId;
  }

  async sendMessage(roomId: string, content: Record<string, unknown>): Promise<string> {
    const id = `$message-${++this.sequence}`;
    this.sentMessages.push({ roomId, content, eventId: id });
    return id;
  }

  async sendEvent(roomId: string, eventType: string, content: Record<string, unknown>): Promise<string> {
    const id = `$event-${++this.sequence}`;
    this.sentEvents.push({ roomId, eventType, content, eventId: id });
    return id;
  }

  async uploadContent(data: Buffer, contentType = 'application/octet-stream', filename = ''): Promise<string> {
    const url = `mxc://example.test/${this.uploads.length + 1}`;
    this.uploads.push({ data, contentType, filename, url });
    return url;
  }

  async downloadContent(_mxcUrl: string): Promise<{ data: Buffer; contentType: string }> {
    return { data: Buffer.from('downloaded attachment'), contentType: 'application/octet-stream' };
  }

  async redactEvent(roomId: string, eventId: string): Promise<string> {
    this.redactions.push({ roomId, eventId });
    return `$redaction-${++this.sequence}`;
  }

  async setTyping(roomId: string): Promise<unknown> {
    this.typing.push(roomId);
    return undefined;
  }

  async start(): Promise<unknown> {
    return undefined;
  }

  stop(): void {}
}

const deps = {
  MatrixClient: FakeClient,
  MatrixAuth: FakeAuth,
  SimpleFsStorageProvider: FakeStorage,
  RustSdkCryptoStorageProvider: FakeCryptoStorage,
} as unknown as MatrixSdkDeps;

let tempDir: string;

function config(overrides: Partial<MatrixConfig> = {}): MatrixConfig {
  return {
    baseUrl: 'https://matrix.example.test',
    accessToken: 'token',
    userId: '@bot:example.test',
    deviceName: 'NanoClaw',
    storePath: path.join(tempDir, 'store.json'),
    cryptoStorePath: path.join(tempDir, 'crypto'),
    actionStorePath: path.join(tempDir, 'adapter.json'),
    e2ee: true,
    autojoin: false,
    inviteAllowlist: new Set(),
    threadedRooms: new Set(['*']),
    ...overrides,
  };
}

function hostSetup() {
  return {
    onInbound: vi.fn<ChannelSetup['onInbound']>(),
    onInboundEvent: vi.fn<ChannelSetup['onInboundEvent']>(),
    onMetadata: vi.fn<ChannelSetup['onMetadata']>(),
    onAction: vi.fn<ChannelSetup['onAction']>(),
  } satisfies ChannelSetup;
}

async function flushEvents(): Promise<void> {
  await vi.waitFor(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
}

describe('native Matrix adapter', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-matrix-'));
    FakeClient.directData = {};
    FakeClient.accountDataError = null;
    FakeCryptoStorage.initialDeviceId = null;
    FakeAuth.passwordLogin.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('defaults E2EE on while keeping invite joins opt-in', () => {
    const parsed = parseMatrixConfig({
      MATRIX_BASE_URL: 'https://matrix.example.test/',
      MATRIX_ACCESS_TOKEN: 'token',
      MATRIX_USER_ID: '@bot:example.test',
    });
    expect(parsed).toMatchObject({
      baseUrl: 'https://matrix.example.test',
      e2ee: true,
      autojoin: false,
    });
    expect(parsed?.threadedRooms.has('*')).toBe(true);
  });

  it('reuses a complete legacy matrix-bot-sdk store by default', () => {
    const originalCwd = process.cwd();
    const legacyCrypto = path.join(tempDir, 'store/matrix/crypto');
    fs.mkdirSync(legacyCrypto, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'store/matrix/bot.json'), '{}');
    fs.writeFileSync(path.join(legacyCrypto, 'bot-sdk.json'), '{}');
    fs.writeFileSync(path.join(legacyCrypto, 'matrix-sdk-crypto.sqlite3'), 'sqlite');
    try {
      process.chdir(tempDir);
      const parsed = parseMatrixConfig({
        MATRIX_BASE_URL: 'https://matrix.example.test',
        MATRIX_ACCESS_TOKEN: 'token',
        MATRIX_USER_ID: '@bot:example.test',
      });
      expect(parsed?.storePath).toBe(path.join(tempDir, 'store/matrix/bot.json'));
      expect(parsed?.cryptoStorePath).toBe(legacyCrypto);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('hardens the legacy SDK HTTP transport against redirect SSRF', () => {
    const request = vi.fn();
    const callback = vi.fn();
    withoutRedirects(request)({ uri: 'https://matrix.example.test/_matrix/client/versions' }, callback);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ followRedirect: false, followAllRedirects: false, maxRedirects: 0 }),
      callback,
    );
  });

  it('forces a fresh m.direct fetch and never classifies a two-member unmarked room as a DM', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'adapter.json'),
      JSON.stringify({ directRooms: { '!stale:example.test': '@stale:example.test' }, actions: [] }),
    );
    FakeClient.directData = { '@alice:example.test': ['!dm:example.test'] };
    const adapter = createMatrixAdapter(config(), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);

    expect(FakeClient.latest.accountDataCalls).toEqual(['m.direct']);
    FakeClient.latest.emit('room.event', '!dm:example.test', {
      type: 'm.room.message',
      sender: '@alice:example.test',
      event_id: '$dm',
      content: { msgtype: 'm.text', body: 'hello' },
    });
    FakeClient.latest.emit('room.event', '!two:example.test', {
      type: 'm.room.message',
      sender: '@alice:example.test',
      event_id: '$room',
      content: { msgtype: 'm.text', body: 'still a room' },
    });
    await flushEvents();

    expect(host.onInbound).toHaveBeenNthCalledWith(
      1,
      'matrix:@alice:example.test',
      null,
      expect.objectContaining({ isGroup: false }),
    );
    expect(host.onInbound).toHaveBeenNthCalledWith(
      2,
      'matrix:!two:example.test',
      null,
      expect.objectContaining({ isGroup: true }),
    );
  });

  it('retains persisted m.direct only when the fresh homeserver request fails', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'adapter.json'),
      JSON.stringify({ directRooms: { '!cached:example.test': '@cached:example.test' }, actions: [] }),
    );
    FakeClient.accountDataError = new Error('homeserver unavailable');
    const adapter = createMatrixAdapter(config(), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);
    FakeClient.latest.emit('room.event', '!cached:example.test', {
      type: 'm.room.message',
      sender: '@cached:example.test',
      event_id: '$cached',
      content: { msgtype: 'm.text', body: 'fallback' },
    });
    await flushEvents();
    expect(host.onInbound).toHaveBeenCalledWith(
      'matrix:@cached:example.test',
      null,
      expect.objectContaining({ isGroup: false }),
    );
  });

  it('treats a homeserver m.direct 404 as an authoritative empty mapping', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'adapter.json'),
      JSON.stringify({ directRooms: { '!stale:example.test': '@stale:example.test' }, actions: [] }),
    );
    FakeClient.accountDataError = { statusCode: 404, body: { errcode: 'M_NOT_FOUND' } };
    const adapter = createMatrixAdapter(config(), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);
    FakeClient.latest.emit('room.event', '!stale:example.test', {
      type: 'm.room.message',
      sender: '@stale:example.test',
      event_id: '$not-a-dm',
      content: { msgtype: 'm.text', body: 'room message' },
    });
    await flushEvents();
    expect(host.onInbound).toHaveBeenCalledWith(
      'matrix:!stale:example.test',
      null,
      expect.objectContaining({ isGroup: true }),
    );
  });

  it('rejects reuse of a crypto store belonging to another Matrix device', async () => {
    FakeCryptoStorage.initialDeviceId = 'OTHERDEVICE';
    const adapter = createMatrixAdapter(config(), async () => deps);
    await expect(adapter.setup(hostSetup())).rejects.toThrow(/crypto store belongs to device OTHERDEVICE/);
  });

  it('preserves Matrix thread roots and creates a thread for enabled top-level room messages', async () => {
    const adapter = createMatrixAdapter(config(), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);

    FakeClient.latest.emit('room.event', '!room:example.test', {
      type: 'm.room.message',
      sender: '@alice:example.test',
      event_id: '$reply',
      content: {
        msgtype: 'm.text',
        body: 'inside thread',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    });
    await flushEvents();
    expect(host.onInbound).toHaveBeenCalledWith(
      'matrix:!room:example.test',
      '$root',
      expect.objectContaining({ isGroup: true }),
    );
    expect(adapter.threadIdForReplyToMessage?.('matrix:!room:example.test', null, '$new')).toBe('$new');

    await adapter.deliver('matrix:!room:example.test', '$root', {
      kind: 'chat',
      content: { text: 'agent reply' },
    });
    expect(FakeClient.latest.sentMessages.at(-1)?.content['m.relates_to']).toEqual({
      rel_type: 'm.thread',
      event_id: '$root',
      is_falling_back: true,
      'm.in_reply_to': { event_id: '$root' },
    });
  });

  it('renders card content as a formatted message instead of dropping it', async () => {
    const adapter = createMatrixAdapter(config(), async () => deps);
    await adapter.setup(hostSetup());

    const before = FakeClient.latest.sentMessages.length;
    const eventId = await adapter.deliver('matrix:!room:example.test', null, {
      kind: 'chat',
      content: {
        type: 'card',
        card: {
          title: 'Prueba de card #2',
          description: 'Segunda prueba de renderizado.',
          children: [{ text: 'Si ves esto, funciona.' }, 'línea suelta'],
          actions: [
            { label: 'Abrir', url: 'https://example.test/x' },
            { label: 'callback', value: 'nope' },
          ],
        },
      },
    });
    expect(eventId).toBeDefined();
    const sent = FakeClient.latest.sentMessages.at(-1)?.content;
    expect(FakeClient.latest.sentMessages.length).toBe(before + 1);
    expect(sent?.['body']).toContain('Prueba de card #2');
    expect(sent?.['formatted_body']).toContain('<h3>Prueba de card #2</h3>');
    expect(sent?.['formatted_body']).toContain('Si ves esto, funciona.');
    expect(sent?.['formatted_body']).toContain('<a href="https://example.test/x">Abrir</a>');
    expect(sent?.['formatted_body']).not.toContain('callback');
  });

  it('warns and sends nothing for content with no renderable text', async () => {
    const adapter = createMatrixAdapter(config(), async () => deps);
    await adapter.setup(hostSetup());
    const before = FakeClient.latest.sentMessages.length;
    const eventId = await adapter.deliver('matrix:!room:example.test', null, {
      kind: 'chat',
      content: { type: 'mystery', payload: 42 },
    });
    expect(eventId).toBeUndefined();
    expect(FakeClient.latest.sentMessages.length).toBe(before);
  });

  it('sends formatted_body HTML for markdown replies and omits it for plain text', async () => {
    const adapter = createMatrixAdapter(config(), async () => deps);
    await adapter.setup(hostSetup());

    await adapter.deliver('matrix:!room:example.test', null, {
      kind: 'chat',
      content: { text: '**Necesito que entres tú** a la Sede:\n\n- opción A\n- opción B' },
    });
    const formatted = FakeClient.latest.sentMessages.at(-1)?.content;
    expect(formatted?.['format']).toBe('org.matrix.custom.html');
    expect(formatted?.['formatted_body']).toContain('<strong>Necesito que entres tú</strong>');
    expect(formatted?.['formatted_body']).toContain('<ul><li>opción A</li><li>opción B</li></ul>');
    expect(formatted?.['body']).toContain('**Necesito que entres tú**');

    await adapter.deliver('matrix:!room:example.test', null, {
      kind: 'chat',
      content: { text: 'sin formato' },
    });
    const plain = FakeClient.latest.sentMessages.at(-1)?.content;
    expect(plain?.['format']).toBeUndefined();
    expect(plain?.['formatted_body']).toBeUndefined();
  });

  it('collapses existing and new Matrix threads in rooms not configured for threading', async () => {
    const adapter = createMatrixAdapter(config({ threadedRooms: new Set() }), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);
    FakeClient.latest.emit('room.event', '!room:example.test', {
      type: 'm.room.message',
      sender: '@alice:example.test',
      event_id: '$reply',
      content: {
        msgtype: 'm.text',
        body: 'inside an ignored Matrix thread',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    });
    await flushEvents();
    expect(host.onInbound).toHaveBeenCalledWith(
      'matrix:!room:example.test',
      null,
      expect.objectContaining({ isGroup: true }),
    );
    expect(adapter.threadIdForReplyToMessage?.('matrix:!room:example.test', null, '$new')).toBeNull();
  });

  it('encrypts outbound media before uploading it to an encrypted room', async () => {
    const adapter = createMatrixAdapter(config(), async () => deps);
    await adapter.setup(hostSetup());
    FakeClient.latest.roomEncrypted = true;
    await adapter.deliver('matrix:!room:example.test', '$root', {
      kind: 'chat',
      content: {},
      files: [{ filename: 'diagram.png', data: Buffer.from('image bytes') }],
    });
    expect(FakeClient.latest.uploads[0]).toMatchObject({
      contentType: 'application/octet-stream',
      filename: '',
    });
    expect(FakeClient.latest.uploads[0]?.data.toString()).toBe('encrypted:image bytes');
    expect(FakeClient.latest.sentMessages.at(-1)?.content).toMatchObject({
      msgtype: 'm.image',
      body: 'diagram.png',
      file: { url: 'mxc://example.test/1' },
    });
  });

  it('decrypts encrypted inbound media into the standard attachment payload', async () => {
    const adapter = createMatrixAdapter(config(), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);
    FakeClient.latest.emit('room.event', '!room:example.test', {
      type: 'm.room.message',
      sender: '@alice:example.test',
      event_id: '$image',
      content: {
        msgtype: 'm.image',
        body: 'photo.png',
        info: { mimetype: 'image/png', size: 20 },
        file: { url: 'mxc://example.test/image', key: {}, iv: 'iv', hashes: {}, v: 'v2' },
      },
    });
    await flushEvents();
    expect(host.onInbound).toHaveBeenCalledWith(
      'matrix:!room:example.test',
      null,
      expect.objectContaining({
        content: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              type: 'image',
              name: 'photo.png',
              contentType: 'image/png',
              data: Buffer.from('decrypted attachment').toString('base64'),
            }),
          ],
        }),
      }),
    );
  });

  it('renders approval explanations, pre-applies reactions, and resolves a reaction', async () => {
    FakeClient.directData = { '@admin:example.test': ['!dm:example.test'] };
    const adapter = createMatrixAdapter(config(), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);

    const messageId = await adapter.deliver('matrix:@admin:example.test', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-123',
        title: 'Allow package installation?',
        question: 'The agent needs ripgrep to search the repository efficiently.',
        options: [
          { label: 'Approve', selectedLabel: 'Approved', value: 'approve' },
          { label: 'Reject', selectedLabel: 'Rejected', value: 'reject' },
        ],
      },
    });

    const body = String(FakeClient.latest.sentMessages[0]?.content.body);
    expect(body).toContain('needs ripgrep');
    expect(body).toContain('Tap a reaction to respond:');
    expect(body).toContain('✅  Approve');
    expect(body).toContain('❌  Reject');
    expect(body).toContain('(or reply 1 = Approve · 2 = Reject)');
    expect(body).not.toContain('More than one request is pending');
    expect(FakeClient.latest.sentEvents.map((entry) => entry.content['m.relates_to'])).toEqual([
      { rel_type: 'm.annotation', event_id: messageId, key: '✅' },
      { rel_type: 'm.annotation', event_id: messageId, key: '❌' },
    ]);

    FakeClient.latest.emit('room.event', '!dm:example.test', {
      type: 'm.reaction',
      sender: '@admin:example.test',
      event_id: '$admin-reaction',
      content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: messageId, key: '✅' } },
    });
    await flushEvents();

    expect(host.onAction).toHaveBeenCalledWith('approval-123', 'approve', 'matrix:@admin:example.test');
    expect(FakeClient.latest.redactions).toHaveLength(2);
    expect(FakeClient.latest.sentMessages.at(-1)?.content['m.relates_to']).toEqual({
      rel_type: 'm.replace',
      event_id: messageId,
    });
  });

  it('shows a disambiguation code only when another approval is pending in the room', async () => {
    FakeClient.directData = { '@admin:example.test': ['!dm:example.test'] };
    const adapter = createMatrixAdapter(config(), async () => deps);
    await adapter.setup(hostSetup());

    const question = (questionId: string) => ({
      kind: 'chat-sdk' as const,
      content: {
        type: 'ask_question',
        questionId,
        title: 'Run command?',
        question: 'The agent needs to modify host state.',
        options: [
          { label: 'Approve', value: 'approve' },
          { label: 'Reject', value: 'reject' },
          { label: 'Reject with reason', value: 'reject_with_reason' },
        ],
      },
    });

    await adapter.deliver('matrix:@admin:example.test', null, question('approval-one'));
    await adapter.deliver('matrix:@admin:example.test', null, question('approval-two'));

    const firstBody = String(FakeClient.latest.sentMessages[0]?.content.body);
    const secondBody = String(FakeClient.latest.sentMessages[1]?.content.body);
    expect(firstBody).not.toContain('More than one request is pending');
    expect(secondBody).toContain('📝  Reject with reason');
    expect(secondBody).toContain('(or reply 1 = Approve · 2 = Reject · 3 = Reject with reason)');
    expect(secondBody).toMatch(/More than one request is pending\. Prefix the number with “[A-Z0-9]{4,6}”/);
  });

  it('accepts a one-number fallback when exactly one question is pending', async () => {
    FakeClient.directData = { '@admin:example.test': ['!dm:example.test'] };
    const adapter = createMatrixAdapter(config(), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);
    await adapter.deliver('matrix:@admin:example.test', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'question-1',
        title: 'Continue?',
        question: 'This explains why the action is needed.',
        options: ['Yes', 'No'],
      },
    });
    FakeClient.latest.emit('room.event', '!dm:example.test', {
      type: 'm.room.message',
      sender: '@admin:example.test',
      event_id: '$answer',
      content: { msgtype: 'm.text', body: '2' },
    });
    await flushEvents();
    expect(host.onAction).toHaveBeenCalledWith('question-1', 'No', 'matrix:@admin:example.test');
    expect(host.onInbound).not.toHaveBeenCalled();
  });

  it('passes an optional rejection reason through the channel action contract', async () => {
    FakeClient.directData = { '@admin:example.test': ['!dm:example.test'] };
    const adapter = createMatrixAdapter(config(), async () => deps);
    const host = hostSetup();
    await adapter.setup(host);
    await adapter.deliver('matrix:@admin:example.test', null, {
      kind: 'chat-sdk',
      content: {
        type: 'ask_question',
        questionId: 'approval-with-reason',
        title: 'Run command?',
        question: 'The agent needs to modify host state.',
        options: [
          { label: 'Approve', value: 'approve' },
          { label: 'Reject', value: 'reject' },
        ],
      },
    });
    FakeClient.latest.emit('room.event', '!dm:example.test', {
      type: 'm.room.message',
      sender: '@admin:example.test',
      event_id: '$answer-with-reason',
      content: { msgtype: 'm.text', body: '2 Please use the read-only API instead' },
    });
    await flushEvents();
    expect(host.onAction).toHaveBeenCalledWith(
      'approval-with-reason',
      'reject',
      'matrix:@admin:example.test',
      'Please use the read-only API instead',
    );
  });

  it('joins invites only when autojoin is enabled and the inviter is allowlisted', async () => {
    const adapter = createMatrixAdapter(
      config({ autojoin: true, inviteAllowlist: new Set(['@owner:example.test']) }),
      async () => deps,
    );
    await adapter.setup(hostSetup());
    FakeClient.latest.emit('room.invite', '!allowed:example.test', { sender: '@owner:example.test' });
    FakeClient.latest.emit('room.invite', '!blocked:example.test', { sender: '@stranger:example.test' });
    await flushEvents();
    expect(FakeClient.latest.joins).toEqual(['!allowed:example.test']);
  });

  it('keeps stable user addressing when opening a DM', async () => {
    const adapter = createMatrixAdapter(config(), async () => deps);
    await adapter.setup(hostSetup());
    expect(await adapter.openDM?.('@alice:example.test')).toBe(matrixPlatformId('@alice:example.test'));
  });
});
