---
name: add-mattermost
description: Add Mattermost channel integration via Chat SDK.
---

# Add Mattermost Channel

Adds Mattermost support via the Chat SDK bridge, wrapping
[`@nanoco/chat-adapter-mattermost`](https://github.com/nanocoai/chat-adapter-mattermost).
Events arrive over an outbound WebSocket (`/api/v4/websocket`) — no public URL
or webhook is needed for basic messaging. Interactive cards (approvals,
`ask_question` buttons and selects) work too, once Mattermost can reach
NanoClaw's webhook server (see **Interactive cards** below).

> Not the unscoped `chat-adapter-mattermost` package on npm. That is an
> unrelated codebase with a different thread-id encoding; it cannot deliver
> replies through the bridge and its card buttons are dead. If a previous
> install pinned it, see **Migrating from `chat-adapter-mattermost@1.1.3`**.

## Install

NanoClaw doesn't ship channels in trunk. This skill copies the Mattermost
adapter in from the `channels` branch.

### Pre-flight (idempotent)

Skip to **Credentials** if all of these are already in place:

- `src/channels/mattermost.ts` exists
- `src/channels/index.ts` contains `import './mattermost.js';`
- `@nanoco/chat-adapter-mattermost` is listed in `package.json` dependencies

Otherwise continue. Every step below is safe to re-run.

### 1. Fetch the channels branch

```bash
git fetch origin channels
```

### 2. Copy the adapter and registration test

```bash
git show origin/channels:src/channels/mattermost.ts > src/channels/mattermost.ts
git show origin/channels:src/channels/mattermost-registration.test.ts > src/channels/mattermost-registration.test.ts
git show origin/channels:src/channels/mattermost-live.test.ts > src/channels/mattermost-live.test.ts
```

`mattermost-live.test.ts` is a round-trip suite against a real server. It
skips when no `MATTERMOST_LAB_*` env is present, so it costs nothing in a
normal `vitest run`; VERIFY.md explains how to point it at a server.

### 3. Append the self-registration import

Append to `src/channels/index.ts` (skip if the line is already present):

```typescript
import './mattermost.js';
```

### 4. Install the adapter package (pinned)

```bash
pnpm install @nanoco/chat-adapter-mattermost@0.1.0
```

### 5. Build and validate

```bash
pnpm run build
pnpm exec vitest run src/channels/mattermost-registration.test.ts
```

`mattermost-registration.test.ts` imports the real channel barrel and asserts
the registry contains `mattermost`. It goes red if the import line is deleted
or drifts, or if `@nanoco/chat-adapter-mattermost` isn't installed (the import
throws). End-to-end delivery is covered by `pnpm run test:mattermost-live`
against a server you control (VERIFY.md), or manually once the service runs.

## Credentials

Mattermost has no interactive OAuth app flow like Slack — auth is a single
bot account token.

### Create the bot account

1. Enable bot account creation if it isn't already: **System Console →
   Integrations → Bot Accounts → "Enable Bot Account Creation"** (requires a
   System Admin).
2. Still in **System Console → Integrations → Bot Accounts**, click **Add Bot
   Account**. Give it a username (e.g. `nanoclaw`) and display name, then
   create it.
3. Copy the **Access Token** shown immediately after creation — it is only
   ever displayed at creation time.
4. Invite the bot to any team/channel it should participate in (add it like a
   regular member, or an admin can add it via the API). Bot accounts don't
   auto-join channels.

If the token is lost, generate a new one from the same Bot Accounts screen
(**select the bot → "Create New Token"**) — this does **not** revoke the old
token; both remain valid simultaneously. Explicitly deactivate the old token
from the same screen if you want it revoked.

### Configure environment

```bash
MATTERMOST_BASE_URL=https://mattermost.example.com
MATTERMOST_BOT_TOKEN=your-bot-access-token
# optional — needed for clickable cards (buttons, selects, approvals):
MATTERMOST_CALLBACK_URL=https://nanoclaw.example.com
MATTERMOST_CALLBACK_SECRET=$(openssl rand -hex 24)
```

`MATTERMOST_BASE_URL` must include the scheme and no trailing slash.

### Interactive cards

Mattermost delivers button clicks by POSTing to a URL the bot supplies with
the card. Set `MATTERMOST_CALLBACK_URL` to an address **the Mattermost server
can reach** for NanoClaw's webhook server (port 3000 by default) — either the
base URL (the adapter appends `/webhook/mattermost`) or the full route. Without
it, cards still render, but as plain markdown with no buttons.

Set `MATTERMOST_CALLBACK_SECRET` as well. Mattermost does not sign action
callbacks; the adapter embeds this secret in every button's server-only context
and the webhook refuses with `401` any click that does not present it, so
learning the URL is not enough to forge an approval. Cards posted before the
secret was set stop being clickable — re-issue them.

If the server runs in Docker on the same host, `MATTERMOST_CALLBACK_URL` is
typically `http://host.docker.internal:3000`, and the server must list that
host under **System Console → Environment → Developer → Allow untrusted
internal connections** (`ServiceSettings.AllowedUntrustedInternalConnections`).
Private-network callback targets are refused otherwise — silently, from the
clicker's point of view. VERIFY.md walks through the diagnosis.
If the callback URL is HTTPS behind a self-signed certificate, the server also
needs `ServiceSettings.EnableInsecureOutgoingConnections` (or a trusted CA).

### Confirm the token works

```bash
curl -sf "$MATTERMOST_BASE_URL/api/v4/users/me" -H "Authorization: Bearer $MATTERMOST_BOT_TOKEN" | jq -er '"@" + .username'
```

A failure here means the token is wrong, expired, or the bot account was
deactivated.

### Resolve your DM channel

You'll need the bot's user id (from the same `users/me` call — `jq -er .id`)
and your own Mattermost user id. There's no self-service page that shows your
own ID; resolve it from your bot token instead:

```bash
curl -sf "$MATTERMOST_BASE_URL/api/v4/users/username/<your-username>" -H "Authorization: Bearer $MATTERMOST_BOT_TOKEN" | jq -er '.id'
```

(An admin can also look this up via **System Console → Users**.)

Then open (or fetch) the DM channel and take its id as the conversation
address `mattermost:<channelId>`:

```bash
curl -sf -X POST "$MATTERMOST_BASE_URL/api/v4/channels/direct" -H "Authorization: Bearer $MATTERMOST_BOT_TOKEN" -H "Content-Type: application/json" -d '["<your-user-id>","<bot-user-id>"]' | jq -er '"mattermost:" + .id'
```

## Next Steps

If you're in the middle of `/setup`, return to the setup flow now.

Otherwise, run `/manage-channels` to wire this channel to an agent group.

## Channel Info

- **type**: `mattermost`
- **terminology**: Mattermost has "teams" containing "channels." Channels can be public or private. The bot can also receive direct messages.
- **platform-id-format**: `mattermost:{channelId}` for channels and DMs (e.g. `mattermost:a1b2c3d4e5f6g7h8i9j0k1l2m3`)
- **how-to-find-id**: Open the channel, click its name → "View Info" — the channel ID is shown there. Copying the channel link gives the channel *slug*, not the ID the adapter needs — use "View Info" or the `/api/v4/channels/direct` lookup above for DMs.
- **supports-threads**: yes — Mattermost models replies as optional reply-threads within a channel (a post with no root is top-level; a post with a root id is a thread reply), the same shape as Slack.
- **typical-use**: Interactive chat — team channels or direct messages, self-hosted or Mattermost Cloud
- **default-isolation**: Same agent group for channels where you're the primary user. Separate agent group for channels with different teams or sensitive contexts.

## Troubleshooting

**A token or URL is rejected.** `MATTERMOST_BASE_URL` must include the scheme (`https://` or `http://`) and no trailing slash. The bot token is shown once at creation — regenerate it from System Console → Integrations → Bot Accounts → select the bot → "Create New Token" if lost (old tokens keep working until you deactivate them separately).

**The bot never connects, or connects and repeatedly drops.** Check that `MATTERMOST_BASE_URL` is reachable from the host (not just from a browser behind a VPN or reverse-proxy auth) and that nothing in front of the server (load balancer, CDN) blocks or aggressively idle-times WebSocket upgrades to `/api/v4/websocket`. The adapter retries with backoff and NanoClaw's channel-registry retries adapter setup on network errors, but a very short idle timeout in front of the server will cause repeated reconnects. Check `logs/nanoclaw.error.log` for repeated adapter setup-retry warnings.

**The bot can't see a channel or can't DM someone.** The bot account must be added as a member of any channel it should read/post in — bot accounts don't auto-join. For DMs, the target user must exist and be reachable via `/api/v4/channels/direct`.

**Card buttons do nothing when clicked.** See VERIFY.md — this is the one silent failure: `MATTERMOST_CALLBACK_URL` is unset, unreachable from the Mattermost server, or not allowed as an untrusted internal connection.

**Clicks return a red error in Mattermost after the secret was added.** The card predates `MATTERMOST_CALLBACK_SECRET`; its buttons carry no secret and are refused with 401. Trigger the card again.

**Known feature gaps** (adapter-level):
- Streaming responses fall back to post-and-edit (no native streaming transport), so long responses may appear to "jump" rather than stream in place.
- Slash commands and modals are not supported — messages, reactions, files, DMs, ephemeral posts and interactive message attachments only.
- A `429` is waited out once, for as long as the server's `Retry-After` asks; a second one in a row surfaces as a delivery error.

## Migrating from `chat-adapter-mattermost@1.1.3`

Earlier revisions of this skill installed the unscoped npm package. Its thread
ids were `mattermost:<base64url(channelId)>`; this adapter uses the raw
channel id (`mattermost:<channelId>`, 26 lowercase alphanumerics). Messaging
groups wired under the old package therefore stop matching after the swap —
the first inbound message creates a fresh, unwired group and is dropped as
`Channel registration skipped`. `ncl messaging-groups update` cannot change
`platform_id`, so:

1. `pnpm uninstall chat-adapter-mattermost` and install as in step 4 (the
   import name changes, so re-copy `src/channels/mattermost.ts` from the
   `channels` branch too).
2. `ncl messaging-groups list` — note every `mattermost:` group whose id is
   not 26 lowercase alphanumerics.
3. Re-wire each one through `/manage-channels` using the raw channel id
   (the `/api/v4/channels/direct` lookup above prints it), then delete the
   old group.
