/**
 * Second Mattermost bot instance ("Rocky") on the same server.
 *
 * Same platform — channelType stays 'mattermost', so user identities,
 * roles, and formatting are shared with the primary bot — but its own
 * bot account, token, webhook route (/webhook/mattermost-rocky) and
 * messaging-group rows, all keyed by the instance name. The callback URL
 * must carry the full instance route: the adapter only appends its
 * default '/webhook/mattermost' segment when the URL has no path.
 */
import { createMattermostAdapter } from 'chat-adapter-mattermost';

import { readEnvFile } from '../env.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';
import { MATTERMOST_DEFAULTS } from './mattermost.js';

const INSTANCE = 'mattermost-rocky';

registerChannelAdapter(INSTANCE, {
  factory: () => {
    const env = readEnvFile([
      'MATTERMOST_URL',
      'ROCKY_MATTERMOST_BOT_TOKEN',
      'ROCKY_MATTERMOST_CALLBACK_URL',
      'MATTERMOST_TEAM',
    ]);
    if (!env.MATTERMOST_URL || !env.ROCKY_MATTERMOST_BOT_TOKEN) return null;
    const mattermostAdapter = createMattermostAdapter({
      url: env.MATTERMOST_URL,
      botToken: env.ROCKY_MATTERMOST_BOT_TOKEN,
      callbackUrl: env.ROCKY_MATTERMOST_CALLBACK_URL,
      team: env.MATTERMOST_TEAM,
    });
    if (!mattermostAdapter) return null;
    const bridge = createChatSdkBridge({
      adapter: mattermostAdapter,
      concurrency: 'concurrent',
      supportsThreads: true,
      defaults: MATTERMOST_DEFAULTS,
      instance: INSTANCE,
    });
    bridge.resolveChannelName = async (platformId: string) => {
      try {
        const info = await mattermostAdapter.fetchThread(platformId);
        return (info as { channelName?: string }).channelName ?? null;
      } catch {
        return null;
      }
    };
    return bridge;
  },
});
