import Database from 'better-sqlite3';
import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelAdapter, ChannelSetup } from './channels/adapter.js';

vi.mock('./container-runner.js', () => ({
  wakeContainer: vi.fn().mockResolvedValue(false),
  isContainerRunning: vi.fn().mockReturnValue(false),
  getActiveContainerCount: vi.fn().mockReturnValue(0),
  killContainer: vi.fn(),
}));

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-router-threading' };
});

const TEST_DIR = '/tmp/nanoclaw-test-router-threading';
const ROOM = 'matrix-test:!room:example.test';

const now = (): string => new Date().toISOString();

describe('adapter-selected reply threads', () => {
  let setupConfig: ChannelSetup | null = null;
  const adapter: ChannelAdapter = {
    name: 'matrix-test',
    channelType: 'matrix-test',
    supportsThreads: true,
    async setup(config) {
      setupConfig = config;
    },
    async teardown() {
      setupConfig = null;
    },
    isConnected: () => setupConfig !== null,
    async deliver() {
      return undefined;
    },
    threadIdForReplyToMessage(_platformId, currentThreadId, messageId) {
      return currentThreadId ?? messageId;
    },
  };

  beforeEach(async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });

    const { initTestDb, runMigrations, createAgentGroup, createMessagingGroup, createMessagingGroupAgent } =
      await import('./db/index.js');
    runMigrations(initTestDb());
    createAgentGroup({ id: 'ag', name: 'Agent', folder: 'ag', agent_provider: null, created_at: now() });
    createMessagingGroup({
      id: 'mg',
      channel_type: 'matrix-test',
      platform_id: ROOM,
      name: 'Matrix Room',
      is_group: 1,
      unknown_sender_policy: 'public',
      created_at: now(),
    });
    createMessagingGroupAgent({
      id: 'mga',
      messaging_group_id: 'mg',
      agent_group_id: 'ag',
      engage_mode: 'pattern',
      engage_pattern: '.',
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'shared',
      priority: 0,
      created_at: now(),
    });

    const { registerChannelAdapter, initChannelAdapters } = await import('./channels/channel-registry.js');
    registerChannelAdapter('matrix-test', { factory: () => adapter });
    await initChannelAdapters(() => ({
      conversations: [],
      onInbound: () => {},
      onInboundEvent: () => {},
      onMetadata: () => {},
      onAction: () => {},
    }));
  });

  afterEach(async () => {
    const { teardownChannelAdapters } = await import('./channels/channel-registry.js');
    await teardownChannelAdapters();
    const { closeDb } = await import('./db/index.js');
    closeDb();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('roots each always-on top-level message at its Matrix event id', async () => {
    const { routeInbound } = await import('./router.js');
    const { findSessionForAgent } = await import('./db/sessions.js');
    const { inboundDbPath } = await import('./session-manager.js');

    for (const id of ['$one', '$two']) {
      await routeInbound({
        channelType: 'matrix-test',
        platformId: ROOM,
        threadId: null,
        message: {
          id,
          kind: 'chat',
          content: JSON.stringify({ text: 'new message', senderId: 'matrix:@user:example.test' }),
          timestamp: now(),
          isGroup: true,
        },
      });
    }

    const first = findSessionForAgent('ag', 'mg', '$one');
    const second = findSessionForAgent('ag', 'mg', '$two');
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();
    expect(second?.id).not.toBe(first?.id);

    const inbound = new Database(inboundDbPath('ag', first!.id), { readonly: true });
    const row = inbound.prepare('SELECT thread_id FROM messages_in').get() as { thread_id: string };
    inbound.close();
    expect(row.thread_id).toBe('$one');
  });
});
