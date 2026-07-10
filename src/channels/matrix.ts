/**
 * Native Matrix adapter for NanoClaw.
 *
 * This adapter implements ChannelAdapter directly. It deliberately does not
 * pass through Chat SDK and does not depend on the Beeper adapter.
 *
 * Security invariants:
 * - `m.direct` account data is authoritative for DM classification. Member
 *   count is never used as a DM heuristic.
 * - E2EE is independent of cross-signing and server-side key backup. The
 *   persistent Rust crypto store is sufficient for live encrypted messages.
 * - Room invites are accepted only when explicitly enabled and allowlisted.
 * - Matrix payloads are sent as literal plain text, not formatted HTML.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import { normalizeOptions, type NormalizedOption } from './ask-question.js';
import type { ChannelAdapter, ChannelSetup, ConversationInfo, InboundMessage, OutboundMessage } from './adapter.js';
import { registerChannelAdapter } from './channel-registry.js';
import { verifyMatrixCryptoBinary } from './matrix-crypto-integrity.js';

const ENV_KEYS = [
  'MATRIX_BASE_URL',
  'MATRIX_ACCESS_TOKEN',
  'MATRIX_USER_ID',
  'MATRIX_USERNAME',
  'MATRIX_PASSWORD',
  'MATRIX_DEVICE_NAME',
  'MATRIX_STORE_PATH',
  'MATRIX_CRYPTO_STORE_PATH',
  'MATRIX_ACTION_STORE_PATH',
  'MATRIX_E2EE',
  'MATRIX_INVITE_AUTOJOIN',
  'MATRIX_INVITE_AUTOJOIN_ALLOWLIST',
  'MATRIX_THREADED_ROOMS',
] as const;

const TOKEN_STORAGE_KEY = 'nanoclaw.matrix.accessToken';
const DEFAULT_STORE_PATH = 'data/v2-matrix-store.json';
const DEFAULT_CRYPTO_STORE_PATH = 'data/v2-matrix-crypto';
const DEFAULT_ACTION_STORE_PATH = 'data/v2-matrix-adapter.json';
const LEGACY_STORE_PATH = 'store/matrix/bot.json';
const LEGACY_CRYPTO_STORE_PATH = 'store/matrix/crypto';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const APPROVAL_REACTIONS = ['✅', '❌', '📝'] as const;
const NUMBER_REACTIONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'] as const;

export interface MatrixConfig {
  baseUrl: string;
  accessToken?: string;
  userId?: string;
  username?: string;
  password?: string;
  deviceName: string;
  storePath: string;
  cryptoStorePath: string;
  actionStorePath: string;
  e2ee: boolean;
  autojoin: boolean;
  inviteAllowlist: ReadonlySet<string>;
  threadedRooms: ReadonlySet<string>;
}

function splitList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

export function parseMatrixConfig(env: Record<string, string | undefined>): MatrixConfig | null {
  const baseUrl = env.MATRIX_BASE_URL?.trim();
  if (!baseUrl) return null;

  const accessToken = env.MATRIX_ACCESS_TOKEN?.trim() || undefined;
  const userId = env.MATRIX_USER_ID?.trim() || undefined;
  const username = env.MATRIX_USERNAME?.trim() || undefined;
  const password = env.MATRIX_PASSWORD?.trim() || undefined;
  if (!(accessToken && userId) && !(username && password)) return null;

  const storeDefault = existsSync(path.resolve(LEGACY_STORE_PATH)) ? LEGACY_STORE_PATH : DEFAULT_STORE_PATH;
  const legacyCryptoPath = path.resolve(LEGACY_CRYPTO_STORE_PATH);
  const cryptoDefault =
    existsSync(path.join(legacyCryptoPath, 'bot-sdk.json')) &&
    existsSync(path.join(legacyCryptoPath, 'matrix-sdk-crypto.sqlite3'))
      ? LEGACY_CRYPTO_STORE_PATH
      : DEFAULT_CRYPTO_STORE_PATH;

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    accessToken,
    userId,
    username,
    password,
    deviceName: env.MATRIX_DEVICE_NAME?.trim() || 'NanoClaw',
    storePath: path.resolve(env.MATRIX_STORE_PATH?.trim() || storeDefault),
    cryptoStorePath: path.resolve(env.MATRIX_CRYPTO_STORE_PATH?.trim() || cryptoDefault),
    actionStorePath: path.resolve(env.MATRIX_ACTION_STORE_PATH?.trim() || DEFAULT_ACTION_STORE_PATH),
    e2ee: envBoolean(env.MATRIX_E2EE, true),
    autojoin: envBoolean(env.MATRIX_INVITE_AUTOJOIN, false),
    inviteAllowlist: splitList(env.MATRIX_INVITE_AUTOJOIN_ALLOWLIST),
    // The desired Matrix policy is one conversation per top-level room
    // message. Operators can opt rooms out with an empty value or list only
    // selected room ids/aliases.
    threadedRooms: splitList(env.MATRIX_THREADED_ROOMS ?? '*'),
  };
}

export function stripMatrixPrefix(id: string): string {
  return id.startsWith('matrix:') ? id.slice('matrix:'.length) : id;
}

export function matrixPlatformId(id: string): string {
  return id.startsWith('matrix:') ? id : `matrix:${id}`;
}

export function isMatrixUserId(id: string): boolean {
  return stripMatrixPrefix(id).startsWith('@');
}

interface MatrixEventContent {
  msgtype?: string;
  body?: string;
  url?: string;
  file?: MatrixEncryptedFile;
  info?: { mimetype?: string; size?: number };
  membership?: string;
  is_direct?: boolean;
  'm.mentions'?: { user_ids?: string[] };
  'm.relates_to'?: {
    rel_type?: string;
    event_id?: string;
    key?: string;
    'm.in_reply_to'?: { event_id?: string };
  };
}

interface MatrixEncryptedFile {
  url: string;
  key: Record<string, unknown>;
  iv: string;
  hashes: Record<string, string>;
  v: string;
}

interface MatrixEventShape {
  type?: string;
  sender?: string;
  event_id?: string;
  origin_server_ts?: number;
  content?: MatrixEventContent;
  raw?: MatrixEventShape;
  eventId?: string;
  timestamp?: number;
}

interface MatrixDmApi {
  getOrCreateDm(userId: string): Promise<string>;
  update(): Promise<void>;
}

export interface MatrixClientLike {
  readonly dms: MatrixDmApi;
  readonly crypto?: {
    prepare(roomIds: string[]): Promise<void>;
    isRoomEncrypted(roomId: string): Promise<boolean>;
    encryptMedia(data: Buffer): Promise<{ buffer: Buffer; file: Omit<MatrixEncryptedFile, 'url'> }>;
    decryptMedia(file: MatrixEncryptedFile): Promise<Buffer>;
  };
  on(event: string, handler: (...args: never[]) => unknown): unknown;
  getUserId(): Promise<string>;
  getWhoAmI(): Promise<{ user_id: string; device_id?: string }>;
  getAccountData<T>(eventType: string): Promise<T>;
  getJoinedRooms(): Promise<string[]>;
  getJoinedRoomMembers(roomId: string): Promise<string[]>;
  getRoomStateEvent(roomId: string, type: string, stateKey: string): Promise<{ name?: string }>;
  joinRoom(roomIdOrAlias: string): Promise<string>;
  sendMessage(roomId: string, content: Record<string, unknown>): Promise<string>;
  sendEvent(roomId: string, eventType: string, content: Record<string, unknown>): Promise<string>;
  uploadContent(data: Buffer, contentType?: string, filename?: string): Promise<string>;
  downloadContent(mxcUrl: string): Promise<{ data: Buffer; contentType: string }>;
  redactEvent(roomId: string, eventId: string, reason?: string | null): Promise<string>;
  setTyping(roomId: string, typing: boolean, timeout?: number): Promise<unknown>;
  start(filter?: unknown): Promise<unknown>;
  stop(): void;
}

interface StorageLike {
  readValue(key: string): string | null | undefined;
  storeValue(key: string, value: string): void;
}

interface CryptoStorageLike {
  getDeviceId(): Promise<string | null>;
  setDeviceId(deviceId: string): Promise<void>;
}

export interface MatrixSdkDeps {
  MatrixClient: new (
    baseUrl: string,
    accessToken: string,
    storage: StorageLike,
    cryptoStorage?: CryptoStorageLike,
  ) => MatrixClientLike;
  MatrixAuth: new (baseUrl: string) => {
    passwordLogin(username: string, password: string, deviceName: string): Promise<{ accessToken: string }>;
  };
  SimpleFsStorageProvider: new (filename: string) => StorageLike;
  RustSdkCryptoStorageProvider: new (directory: string, storeType: number) => CryptoStorageLike;
}

type MatrixRequestCallback = (error: unknown, response: unknown, body: unknown) => void;
type MatrixRequestFn = (options: Record<string, unknown>, callback: MatrixRequestCallback) => unknown;

export function withoutRedirects(request: MatrixRequestFn): MatrixRequestFn {
  return (options, callback) =>
    request({ ...options, followRedirect: false, followAllRedirects: false, maxRedirects: 0 }, callback);
}

let matrixRequestHardened = false;

async function loadMatrixSdk(): Promise<MatrixSdkDeps> {
  // Lazy loading keeps channel registration side-effect-free. In particular,
  // hosts without Matrix configured do not load the native crypto binding.
  const verified = verifyMatrixCryptoBinary();
  log.info('Matrix: verified native crypto binary', {
    binary: verified.binary,
    version: verified.version,
    digest: verified.digest,
  });
  const sdk = await import('matrix-bot-sdk');
  if (!matrixRequestHardened) {
    // request@2 has an unfixed cross-origin redirect SSRF advisory. Every URL
    // we originate is already pinned to the operator-configured homeserver;
    // refusing redirects prevents that server from bouncing authenticated
    // requests to a different origin.
    const originalRequest = sdk.getRequestFn() as unknown as MatrixRequestFn;
    sdk.setRequestFn(withoutRedirects(originalRequest));
    matrixRequestHardened = true;
  }
  return sdk as unknown as MatrixSdkDeps;
}

interface PersistedAction {
  questionId: string;
  roomId: string;
  messageId: string;
  threadId: string | null;
  code: string;
  title: string;
  options: NormalizedOption[];
  reactions: Array<{ optionIndex: number; key: string; eventId: string }>;
  createdAt: string;
}

interface PersistedMatrixState {
  directRooms: Record<string, string>;
  actions: PersistedAction[];
}

class MatrixStateStore {
  private state: PersistedMatrixState = { directRooms: {}, actions: [] };

  constructor(private readonly filename: string) {
    try {
      const parsed = JSON.parse(readFileSync(filename, 'utf8')) as Partial<PersistedMatrixState>;
      this.state = {
        directRooms: parsed.directRooms ?? {},
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
      // eslint-disable-next-line no-catch-all/no-catch-all -- absent/corrupt optional cache is recoverable
    } catch {
      // First run or invalid state: start empty. Homeserver account data will
      // refresh directRooms before inbound processing begins.
    }
  }

  directRooms(): Map<string, string> {
    return new Map(Object.entries(this.state.directRooms));
  }

  replaceDirectRooms(rooms: Map<string, string>): void {
    this.state.directRooms = Object.fromEntries(rooms);
    this.flush();
  }

  actions(): PersistedAction[] {
    return [...this.state.actions];
  }

  upsertAction(action: PersistedAction): void {
    this.state.actions = this.state.actions.filter((entry) => entry.questionId !== action.questionId);
    this.state.actions.push(action);
    this.flush();
  }

  deleteAction(questionId: string): void {
    this.state.actions = this.state.actions.filter((entry) => entry.questionId !== questionId);
    this.flush();
  }

  private flush(): void {
    mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    const tmp = `${this.filename}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.filename);
    chmodSync(this.filename, 0o600);
  }
}

function rawEvent(event: MatrixEventShape): MatrixEventShape {
  return event.raw ?? event;
}

function eventId(event: MatrixEventShape): string | undefined {
  return event.event_id ?? event.eventId ?? event.raw?.event_id;
}

function eventTimestamp(event: MatrixEventShape): number | undefined {
  return event.origin_server_ts ?? event.timestamp ?? event.raw?.origin_server_ts;
}

function actionCode(questionId: string): string {
  let hash = 2166136261;
  for (const char of questionId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0)
    .toString(36)
    .slice(0, 6)
    .toUpperCase()
    .padStart(4, '0');
}

function reactionForOption(option: NormalizedOption, index: number): string {
  const value = option.value.toLowerCase();
  if (value === 'approve' || value === 'allow' || value === 'yes') return APPROVAL_REACTIONS[0];
  if (value.includes('reason')) return APPROVAL_REACTIONS[2];
  if (value === 'reject' || value === 'deny' || value === 'no') return APPROVAL_REACTIONS[1];
  return NUMBER_REACTIONS[index] ?? String(index + 1);
}

function contentTypeForFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return (
    {
      '.gif': 'image/gif',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.txt': 'text/plain',
    }[extension] ?? 'application/octet-stream'
  );
}

function messageTypeForContentType(contentType: string): string {
  if (contentType.startsWith('image/')) return 'm.image';
  if (contentType.startsWith('audio/')) return 'm.audio';
  if (contentType.startsWith('video/')) return 'm.video';
  return 'm.file';
}

function renderQuestion(
  title: string,
  question: string,
  options: NormalizedOption[],
  code: string,
  pendingCount: number,
): string {
  const choices = options
    .map((option, index) => `${reactionForOption(option, index)}  ${option.label}`)
    .join('\n');
  const numberedFallback = options.map((option, index) => `${index + 1} = ${option.label}`).join(' · ');
  const disambiguation =
    pendingCount > 1
      ? `\n\nMore than one request is pending. Prefix the number with “${code}”, for example “${code} 1”.`
      : '';
  return (
    `${title}\n\n${question}\n\nTap a reaction to respond:\n${choices}` +
    `\n\n(or reply ${numberedFallback})${disambiguation}`
  );
}

function threadRelation(threadId: string | null): Record<string, unknown> | undefined {
  if (!threadId) return undefined;
  return {
    rel_type: 'm.thread',
    event_id: threadId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: threadId },
  };
}

function parseChoice(
  text: string,
  actions: PersistedAction[],
): { action: PersistedAction; option: NormalizedOption; reason?: string } | null {
  const trimmed = text.trim();
  let action: PersistedAction | undefined;
  let choiceText: string | undefined;
  let reason: string | undefined;

  const single = trimmed.match(/^(\d{1,2})(?:\s+(.+))?$/s);
  if (actions.length === 1 && single) {
    action = actions[0];
    choiceText = single[1];
    reason = single[2]?.trim();
  } else {
    const match = trimmed.match(
      /^([A-Z0-9]{4,6})\s+(\d{1,2})(?:\s+(.+))?$|^(\d{1,2})\s+([A-Z0-9]{4,6})(?:\s+(.+))?$/is,
    );
    if (!match) return null;
    const code = (match[1] ?? match[5])!.toUpperCase();
    choiceText = match[2] ?? match[4];
    reason = (match[3] ?? match[6])?.trim();
    action = actions.find((entry) => entry.code === code);
  }

  const index = Number(choiceText) - 1;
  const option = action?.options[index];
  if (!action || !option) return null;
  const rejection = ['reject', 'deny', 'no'].some((value) => option.value.toLowerCase().includes(value));
  return { action, option, ...(rejection && reason ? { reason } : {}) };
}

export async function createMatrixClient(
  config: MatrixConfig,
  deps: MatrixSdkDeps,
): Promise<{ client: MatrixClientLike; botUserId: string }> {
  mkdirSync(path.dirname(config.storePath), { recursive: true, mode: 0o700 });
  const storage = new deps.SimpleFsStorageProvider(config.storePath);
  try {
    chmodSync(config.storePath, 0o600);
    // eslint-disable-next-line no-catch-all/no-catch-all -- custom stores need not create a local file
  } catch {
    // A custom test store or first-run provider may not have created it yet.
  }

  let accessToken = config.accessToken;
  if (!accessToken) {
    accessToken = storage.readValue(TOKEN_STORAGE_KEY) ?? undefined;
    if (!accessToken) {
      const auth = new deps.MatrixAuth(config.baseUrl);
      const login = await auth.passwordLogin(config.username!, config.password!, config.deviceName);
      accessToken = login.accessToken;
      storage.storeValue(TOKEN_STORAGE_KEY, accessToken);
    }
  }

  let cryptoStorage: CryptoStorageLike | undefined;
  if (config.e2ee) {
    mkdirSync(config.cryptoStorePath, { recursive: true, mode: 0o700 });
    chmodSync(config.cryptoStorePath, 0o700);
    cryptoStorage = new deps.RustSdkCryptoStorageProvider(config.cryptoStorePath, 0);
  }

  const client = new deps.MatrixClient(config.baseUrl, accessToken!, storage, cryptoStorage);
  const whoami = await client.getWhoAmI();
  const botUserId = whoami.user_id || (await client.getUserId());
  if (config.userId && config.userId !== botUserId) {
    throw new Error(`Matrix access token belongs to ${botUserId}, not configured user ${config.userId}`);
  }

  if (cryptoStorage) {
    const storedDeviceId = await cryptoStorage.getDeviceId();
    if (storedDeviceId && whoami.device_id && storedDeviceId !== whoami.device_id) {
      throw new Error(
        `Matrix crypto store belongs to device ${storedDeviceId}, but the access token belongs to ${whoami.device_id}. ` +
          'Use the matching token or a separate MATRIX_CRYPTO_STORE_PATH.',
      );
    }
    if (!storedDeviceId && whoami.device_id) {
      await cryptoStorage.setDeviceId(whoami.device_id);
    }
  }

  return { client, botUserId };
}

export function createMatrixAdapter(
  config: MatrixConfig,
  depsLoader: () => Promise<MatrixSdkDeps> = loadMatrixSdk,
): ChannelAdapter {
  const state = new MatrixStateStore(config.actionStorePath);
  let directRooms = state.directRooms();
  let client: MatrixClientLike | null = null;
  let setupConfig: ChannelSetup | null = null;
  let botUserId = config.userId ?? null;
  let connected = false;
  let directRefreshQueue: Promise<void> = Promise.resolve();

  function isThreadedRoom(roomId: string): boolean {
    return (
      config.threadedRooms.has('*') ||
      config.threadedRooms.has(roomId) ||
      config.threadedRooms.has(matrixPlatformId(roomId))
    );
  }

  function refreshDirectRooms(): Promise<void> {
    directRefreshQueue = directRefreshQueue.then(refreshDirectRoomsNow, refreshDirectRoomsNow);
    return directRefreshQueue;
  }

  async function refreshDirectRoomsNow(): Promise<void> {
    if (!client) return;
    try {
      const accountData = await client.getAccountData<Record<string, unknown>>('m.direct');
      const candidates = new Map<string, string[]>();
      for (const [userId, value] of Object.entries(accountData ?? {})) {
        if (!userId.startsWith('@') || !Array.isArray(value)) continue;
        for (const roomId of value) {
          if (typeof roomId !== 'string' || !roomId.startsWith('!')) continue;
          const users = candidates.get(roomId) ?? [];
          users.push(userId);
          candidates.set(roomId, users);
        }
      }
      const fresh = new Map<string, string>();
      for (const [roomId, users] of candidates) {
        if (users.length === 1) fresh.set(roomId, users[0]!);
      }
      directRooms = fresh;
      state.replaceDirectRooms(fresh);
      // eslint-disable-next-line no-catch-all/no-catch-all -- any homeserver failure uses the persisted safe fallback
    } catch (err) {
      const status = (err as { statusCode?: number; body?: { errcode?: string } }) ?? {};
      if (status.statusCode === 404 || status.body?.errcode === 'M_NOT_FOUND') {
        directRooms = new Map();
        state.replaceDirectRooms(directRooms);
        return;
      }
      log.warn('Matrix: fresh m.direct fetch failed; retaining the last persisted mapping', { err });
      return;
    }
    try {
      // Keep matrix-bot-sdk's DM creation cache aligned, but never let its
      // secondary refresh invalidate the authoritative snapshot above.
      await client.dms.update();
      // eslint-disable-next-line no-catch-all/no-catch-all -- secondary SDK cache failure must not discard m.direct
    } catch (err) {
      log.warn('Matrix: SDK DM cache refresh failed after m.direct was loaded', { err });
    }
  }

  function roomPlatformId(roomId: string): { platformId: string; isGroup: boolean } {
    const directUser = directRooms.get(roomId);
    return directUser
      ? { platformId: matrixPlatformId(directUser), isGroup: false }
      : { platformId: matrixPlatformId(roomId), isGroup: true };
  }

  function actionsForRoom(roomId: string): PersistedAction[] {
    return state.actions().filter((entry) => entry.roomId === roomId);
  }

  async function resolveAction(
    action: PersistedAction,
    option: NormalizedOption,
    sender: string,
    reason?: string,
  ): Promise<void> {
    if (!client || !setupConfig) return;
    state.deleteAction(action.questionId);
    if (reason) {
      setupConfig.onAction(action.questionId, option.value, matrixPlatformId(sender), reason);
    } else {
      setupConfig.onAction(action.questionId, option.value, matrixPlatformId(sender));
    }

    const resolvedBody = `${option.selectedLabel} — ${sender}${reason ? `\nReason: ${reason}` : ''}`;
    const relation = threadRelation(action.threadId);
    await client.sendMessage(action.roomId, {
      msgtype: 'm.text',
      body: resolvedBody,
      'm.new_content': { msgtype: 'm.text', body: resolvedBody, ...(relation ? { 'm.relates_to': relation } : {}) },
      'm.relates_to': { rel_type: 'm.replace', event_id: action.messageId },
    });

    await Promise.allSettled(
      action.reactions.map((reaction) => client!.redactEvent(action.roomId, reaction.eventId, 'Approval resolved')),
    );
  }

  async function handleReaction(roomId: string, event: MatrixEventShape): Promise<boolean> {
    const raw = rawEvent(event);
    if (raw.type !== 'm.reaction' || raw.sender === botUserId) return false;
    const relation = raw.content?.['m.relates_to'];
    if (relation?.rel_type !== 'm.annotation' || !relation.event_id || !relation.key || !raw.sender) return false;

    const action = state.actions().find((entry) => entry.messageId === relation.event_id && entry.roomId === roomId);
    if (!action) return false;
    const reaction = action.reactions.find((entry) => entry.key === relation.key);
    const option = reaction ? action.options[reaction.optionIndex] : undefined;
    if (!option) return false;
    await resolveAction(action, option, raw.sender);
    return true;
  }

  async function handleMessage(roomId: string, event: MatrixEventShape): Promise<void> {
    if (!client || !setupConfig) return;
    const raw = rawEvent(event);
    if (raw.type && raw.type !== 'm.room.message') return;
    if (!raw.sender || raw.sender === botUserId) return;
    const supportedTypes = ['m.text', 'm.notice', 'm.emote', 'm.file', 'm.image', 'm.audio', 'm.video'];
    if (raw.content?.msgtype && !supportedTypes.includes(raw.content.msgtype)) return;
    if (raw.content?.['m.relates_to']?.rel_type === 'm.replace') return;

    let text = raw.content?.body?.trim() ?? '';
    const attachments: Array<{ type: string; name: string; contentType: string; size: number; data: string }> = [];
    if (raw.content?.msgtype && ['m.file', 'm.image', 'm.audio', 'm.video'].includes(raw.content.msgtype)) {
      const declaredSize = raw.content.info?.size;
      if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES) {
        text = `${text}\n[Attachment omitted: larger than 25 MiB]`.trim();
      } else {
        try {
          let data: Buffer;
          if (raw.content.file) {
            if (!client.crypto) throw new Error('encrypted attachment received without crypto enabled');
            data = await client.crypto.decryptMedia(raw.content.file);
          } else if (raw.content.url) {
            data = (await client.downloadContent(raw.content.url)).data;
          } else {
            throw new Error('attachment has no Matrix content URI');
          }
          if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('attachment exceeds 25 MiB limit');
          const name = path.basename(raw.content.body || `matrix-${eventId(raw) ?? Date.now()}`);
          const contentType = raw.content.info?.mimetype || contentTypeForFilename(name);
          attachments.push({
            type: raw.content.msgtype.slice('m.'.length),
            name,
            contentType,
            size: data.byteLength,
            data: data.toString('base64'),
          });
          // eslint-disable-next-line no-catch-all/no-catch-all -- surface an attachment placeholder instead of dropping chat
        } catch (err) {
          log.warn('Matrix: failed to receive attachment', { roomId, eventId: eventId(raw), err });
          text = `${text}\n[Attachment could not be downloaded or decrypted]`.trim();
        }
      }
    }
    if (!text && attachments.length === 0) return;

    const choice = parseChoice(text, actionsForRoom(roomId));
    if (choice) {
      await resolveAction(choice.action, choice.option, raw.sender, choice.reason);
      return;
    }

    const { platformId, isGroup } = roomPlatformId(roomId);
    const relation = raw.content?.['m.relates_to'];
    const threadId =
      isGroup && isThreadedRoom(roomId) && relation?.rel_type === 'm.thread' ? (relation.event_id ?? null) : null;
    const timestamp = eventTimestamp(raw);
    const mentionIds = raw.content?.['m.mentions']?.user_ids ?? [];
    const message: InboundMessage = {
      id: eventId(raw) ?? `matrix-${Date.now()}`,
      kind: 'chat',
      content: {
        text,
        sender: raw.sender,
        senderId: matrixPlatformId(raw.sender),
        senderName: raw.sender,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
      isMention: !isGroup || (botUserId ? mentionIds.includes(botUserId) || text.includes(botUserId) : false),
      isGroup,
    };

    setupConfig.onMetadata(platformId, isGroup ? roomId : raw.sender, isGroup);
    await setupConfig.onInbound(platformId, threadId, message);
  }

  async function resolveRoom(platformId: string): Promise<string> {
    if (!client) throw new Error('Matrix client is not connected');
    const target = stripMatrixPrefix(platformId);
    if (isMatrixUserId(target)) {
      const roomId = await client.dms.getOrCreateDm(target);
      directRooms.set(roomId, target);
      state.replaceDirectRooms(directRooms);
      return roomId;
    }
    return target;
  }

  async function deliverQuestion(
    roomId: string,
    threadId: string | null,
    content: Record<string, unknown>,
  ): Promise<string> {
    if (!client) throw new Error('Matrix client is not connected');
    const questionId = String(content.questionId);
    const title = typeof content.title === 'string' ? content.title : '';
    const question = typeof content.question === 'string' ? content.question : '';
    if (!title || !Array.isArray(content.options)) throw new Error('Matrix ask_question requires title and options');
    const options = normalizeOptions(content.options as never);
    if (options.length === 0) throw new Error('Matrix ask_question requires at least one option');

    const code = actionCode(questionId);
    const relation = threadRelation(threadId);
    const pendingCount = actionsForRoom(roomId).length + 1;
    const messageId = await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: renderQuestion(title, question, options, code, pendingCount),
      ...(relation ? { 'm.relates_to': relation } : {}),
    });

    const action: PersistedAction = {
      questionId,
      roomId,
      messageId,
      threadId,
      code,
      title,
      options,
      reactions: [],
      createdAt: new Date().toISOString(),
    };
    state.upsertAction(action);

    for (let index = 0; index < options.length; index++) {
      const key = reactionForOption(options[index]!, index);
      try {
        const reactionEventId = await client.sendEvent(roomId, 'm.reaction', {
          'm.relates_to': { rel_type: 'm.annotation', event_id: messageId, key },
        });
        action.reactions.push({ optionIndex: index, key, eventId: reactionEventId });
        state.upsertAction(action);
        // eslint-disable-next-line no-catch-all/no-catch-all -- numeric fallback remains usable for every reaction failure
      } catch (err) {
        log.warn('Matrix: failed to pre-apply approval reaction; numeric fallback remains available', {
          questionId,
          key,
          err,
        });
      }
    }
    return messageId;
  }

  const adapter: ChannelAdapter = {
    name: 'matrix',
    channelType: 'matrix',
    supportsThreads: true,

    async setup(configForHost): Promise<void> {
      setupConfig = configForHost;
      const deps = await depsLoader();
      const created = await createMatrixClient(config, deps);
      client = created.client;
      botUserId = created.botUserId;

      client.on('account_data', (event: MatrixEventShape) => {
        if (rawEvent(event).type === 'm.direct') void refreshDirectRooms();
      });
      client.on('room.join', () => {
        void refreshDirectRooms();
      });
      client.on('room.invite', (roomId: string, event: MatrixEventShape) => {
        const inviter = rawEvent(event).sender;
        if (!config.autojoin || !inviter) return;
        if (!config.inviteAllowlist.has('*') && !config.inviteAllowlist.has(inviter)) {
          log.warn('Matrix: declined automatic room join from non-allowlisted inviter', { roomId, inviter });
          return;
        }
        void client!
          .joinRoom(roomId)
          .then(() => refreshDirectRooms())
          .catch((err) => log.warn('Matrix: failed to join allowlisted room invite', { roomId, inviter, err }));
      });
      client.on('room.event', (roomId: string, event: MatrixEventShape) => {
        void (async () => {
          if (!(await handleReaction(roomId, event))) await handleMessage(roomId, event);
        })().catch((err) => log.error('Matrix: inbound event handling failed', { roomId, err }));
      });

      // Force a homeserver fetch before sync starts. A non-empty persisted
      // snapshot is only a fallback if this fresh request fails.
      await refreshDirectRooms();
      connected = true;
      try {
        await client.start();
      } catch (err) {
        connected = false;
        throw err;
      }
    },

    async teardown(): Promise<void> {
      connected = false;
      client?.stop();
      client = null;
      setupConfig = null;
    },

    isConnected(): boolean {
      return connected;
    },

    async deliver(platformId: string, threadId: string | null, message: OutboundMessage): Promise<string | undefined> {
      if (!client) throw new Error('Matrix client is not connected');
      const roomId = await resolveRoom(platformId);
      const content = (message.content ?? {}) as Record<string, unknown>;
      if (content.type === 'ask_question' && content.questionId) {
        return deliverQuestion(roomId, threadId, content);
      }

      if (content.operation === 'reaction' && content.messageId && content.emoji) {
        return client.sendEvent(roomId, 'm.reaction', {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: String(content.messageId),
            key: String(content.emoji),
          },
        });
      }

      const text =
        typeof content.markdown === 'string' ? content.markdown : typeof content.text === 'string' ? content.text : '';
      const relation = threadRelation(threadId);
      let firstEventId: string | undefined;
      if (text) {
        firstEventId = await client.sendMessage(roomId, {
          msgtype: 'm.text',
          body: text,
          ...(relation ? { 'm.relates_to': relation } : {}),
        });
      }

      for (const outboundFile of message.files ?? []) {
        if (outboundFile.data.byteLength > MAX_ATTACHMENT_BYTES) {
          throw new Error(`Matrix attachment ${outboundFile.filename} exceeds the 25 MiB limit`);
        }
        const filename = path.basename(outboundFile.filename);
        const contentType = contentTypeForFilename(filename);
        const encrypted = (await client.crypto?.isRoomEncrypted(roomId)) === true;
        let mediaContent: Record<string, unknown>;
        if (encrypted) {
          const encryptedMedia = await client.crypto!.encryptMedia(outboundFile.data);
          // The encrypted room event carries the filename. Do not also expose
          // it as media-repository upload metadata.
          const url = await client.uploadContent(encryptedMedia.buffer, 'application/octet-stream');
          mediaContent = { file: { ...encryptedMedia.file, url } };
        } else {
          const url = await client.uploadContent(outboundFile.data, contentType, filename);
          mediaContent = { url };
        }
        const attachmentEventId = await client.sendMessage(roomId, {
          msgtype: messageTypeForContentType(contentType),
          body: filename,
          info: { mimetype: contentType, size: outboundFile.data.byteLength },
          ...mediaContent,
          ...(relation ? { 'm.relates_to': relation } : {}),
        });
        firstEventId ??= attachmentEventId;
      }
      return firstEventId;
    },

    async setTyping(platformId: string): Promise<void> {
      if (!client) return;
      await client.setTyping(await resolveRoom(platformId), true, 30_000);
    },

    async syncConversations(): Promise<ConversationInfo[]> {
      if (!client) return [];
      await refreshDirectRooms();
      const rooms = await client.getJoinedRooms();
      return Promise.all(
        rooms.map(async (roomId) => {
          const { platformId, isGroup } = roomPlatformId(roomId);
          let name = directRooms.get(roomId) ?? roomId;
          if (isGroup) {
            try {
              const content = await client!.getRoomStateEvent(roomId, 'm.room.name', '');
              if (typeof content?.name === 'string' && content.name.trim()) name = content.name.trim();
              // eslint-disable-next-line no-catch-all/no-catch-all -- every missing/forbidden room name has the room-id fallback
            } catch {
              // Nameless rooms are valid; use the stable room id.
            }
          }
          return { platformId, name, isGroup };
        }),
      );
    },

    async openDM(userHandle: string): Promise<string> {
      await resolveRoom(userHandle);
      return matrixPlatformId(stripMatrixPrefix(userHandle));
    },

    async resolveChannelName(platformId: string): Promise<string | null> {
      if (isMatrixUserId(platformId)) return stripMatrixPrefix(platformId);
      if (!client) return null;
      try {
        const content = await client.getRoomStateEvent(stripMatrixPrefix(platformId), 'm.room.name', '');
        return typeof content?.name === 'string' ? content.name : null;
        // eslint-disable-next-line no-catch-all/no-catch-all -- name resolution is explicitly best-effort
      } catch {
        return null;
      }
    },

    threadIdForReplyToMessage(platformId: string, currentThreadId: string | null, messageId: string): string | null {
      if (currentThreadId) return currentThreadId;
      const roomId = stripMatrixPrefix(platformId);
      return isThreadedRoom(roomId) ? messageId : null;
    },
  };

  return adapter;
}

registerChannelAdapter('matrix', {
  factory: () => {
    const config = parseMatrixConfig(readEnvFile([...ENV_KEYS]));
    return config ? createMatrixAdapter(config) : null;
  },
});
