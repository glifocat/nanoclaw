/**
 * Mattermost channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 *
 * Wraps `@nanoco/chat-adapter-mattermost`. Mattermost, like Slack, models
 * replies as optional threads within a channel (a thread id with no root
 * post is the channel itself; a thread id with a root post is a specific
 * reply-thread) — so this follows the Slack shape, not Telegram's
 * channel-is-the-only-conversation model.
 *
 * Platform ids are `mattermost:<channelId>`; thread ids append `:<rootPostId>`.
 * The adapter's `channelIdFromThreadId` returns the namespaced form the
 * bridge feeds back on delivery (`chat-sdk-bridge.ts` uses `platform_id` as
 * a thread id), so nothing is re-wrapped here.
 */
import { MattermostAdapter } from '@nanoco/chat-adapter-mattermost';

import { readEnvFile } from '../env.js';
import type { ChannelDefaults } from './adapter.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

/**
 * Dedicated bot account on a threaded platform. group threads:true keeps
 * mention-sticky bounded — engagement sticks per-thread, not forever.
 * dm.threads:false mirrors Slack's policy: DM sub-threads collapse into the
 * one DM session unless a wiring overrides it.
 */
export const MATTERMOST_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'request_approval' },
  group: { engageMode: 'mention-sticky', threads: true, unknownSenderPolicy: 'request_approval' },
  mentions: 'platform',
};

export interface MattermostAdapterConfig {
  baseUrl: string;
  botToken: string;
  /**
   * Shared secret every card button carries back in its (server-only)
   * integration context. Mattermost signs nothing on action callbacks; with
   * this set, a POST to the webhook route that does not present it is
   * refused with 401, so nobody who learns the URL can forge an approval.
   */
  callbackSecret?: string;
  /**
   * Externally reachable URL Mattermost POSTs button clicks to — either the
   * host's base URL (the adapter appends `/webhook/mattermost`) or the full
   * route. Omit it and cards degrade to markdown, because a button with
   * nowhere to call back to cannot do anything.
   */
  callbackUrl?: string;
}

/**
 * Build the Mattermost adapter exactly as the factory ships it. Exported so
 * mattermost-live.test.ts drives the real construction rather than a copy.
 */
export function buildMattermostAdapter(config: MattermostAdapterConfig): MattermostAdapter {
  return new MattermostAdapter({
    url: config.baseUrl,
    token: config.botToken,
    ...(config.callbackUrl ? { callbackUrl: config.callbackUrl } : {}),
    ...(config.callbackSecret ? { callbackSecret: config.callbackSecret } : {}),
  });
}

registerChannelAdapter('mattermost', {
  factory: () => {
    const env = readEnvFile([
      'MATTERMOST_BASE_URL',
      'MATTERMOST_BOT_TOKEN',
      'MATTERMOST_CALLBACK_URL',
      'MATTERMOST_CALLBACK_SECRET',
    ]);
    if (!env.MATTERMOST_BASE_URL || !env.MATTERMOST_BOT_TOKEN) return null;

    const mattermostAdapter = buildMattermostAdapter({
      baseUrl: env.MATTERMOST_BASE_URL,
      botToken: env.MATTERMOST_BOT_TOKEN,
      callbackUrl: env.MATTERMOST_CALLBACK_URL,
      callbackSecret: env.MATTERMOST_CALLBACK_SECRET,
    });

    const bridge = createChatSdkBridge({
      adapter: mattermostAdapter,
      concurrency: 'concurrent',
      supportsThreads: true,
      defaults: MATTERMOST_DEFAULTS,
    });
    bridge.resolveChannelName = async (platformId: string) => {
      try {
        const info = await mattermostAdapter.fetchThread(platformId);
        return info.channelName ?? null;
      } catch {
        return null;
      }
    };
    return bridge;
  },
  defaults: MATTERMOST_DEFAULTS,
});
