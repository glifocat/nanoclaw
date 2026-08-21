# Verify Mattermost

`.env` keys: `MATTERMOST_BASE_URL`, `MATTERMOST_BOT_TOKEN`, and — for clickable
cards — `MATTERMOST_CALLBACK_URL` (base URL or full `/webhook/mattermost` route)
plus `MATTERMOST_CALLBACK_SECRET` (any random string; every button carries it
back in its server-only context and the webhook refuses clicks without it).

## Live suite (recommended)

`src/channels/mattermost-live.test.ts` drives the real adapter and bridge
against a Mattermost server you control: connect, @-mention → inbound, reply
→ delivered, DM round trip, threaded reply, file both ways, card click and
select via the server's own DoPostAction path, forged click refused with 401.
It needs a throwaway server (a local `mattermost/mattermost-preview` container
is enough), a bot account, a channel the bot is in, and a human test user whose
password the suite can log in with:

```bash
# .env.mattermost-lab — keep it out of git (.env* is ignored), chmod 600
MATTERMOST_LAB_URL=http://localhost:8065
MATTERMOST_LAB_BOT_TOKEN=...
MATTERMOST_LAB_BOT_ID=...            # GET /api/v4/users/me .id with the bot token
MATTERMOST_LAB_BOT_USERNAME=nanoclaw
MATTERMOST_LAB_CHANNEL_ID=...        # a channel both the bot and the test user are in
MATTERMOST_LAB_TESTUSER_USERNAME=...
MATTERMOST_LAB_TESTUSER_PASSWORD=...
```

```bash
set -a; . ./.env.mattermost-lab; set +a
pnpm run test:mattermost-live
```

The suite starts its own webhook server on a free port and hands Mattermost
`http://host.docker.internal:<port>` as the callback URL, so a Docker-hosted
server must allow that host (`AllowedUntrustedInternalConnections`, see
SKILL.md). A partially set `MATTERMOST_LAB_*` environment is an error, not a
skip, and the npm script sets `MATTERMOST_LAB_REQUIRED=1` so "no lab" fails
rather than silently passing.


## Plain text

Add the bot to a channel and send a message (or @-mention it, depending on engage mode), then send it a direct message. The bot should respond to both within a few seconds.

## Button callbacks (only if you set `MATTERMOST_CALLBACK_URL`)

This is the one failure mode that's otherwise silent: **a card whose buttons do nothing when clicked** is the expected symptom when Mattermost can't reach `MATTERMOST_CALLBACK_URL` — no error surfaces in NanoClaw or in the Mattermost UI, because the click never arrives.

Trigger an approval card (any flow that calls `ask_question`), then click a button. If nothing happens:

1. From a shell **on the Mattermost server itself** (not your laptop), confirm it can actually reach NanoClaw:

   ```bash
   curl -i -X POST http://<nanoclaw-host>:3000/webhook/mattermost \
     -H 'content-type: application/json' \
     -d '{}'
   ```

   A `400 Bad request` or similar response from NanoClaw means the network path is fine — the adapter received the probe and rejected it for lacking a real payload, which is expected. A connection error, timeout, or no response at all means the Mattermost server cannot reach that host/port; fix the network path (firewall, port, DNS) before going further.

2. If the curl above works but real clicks still don't, check the Mattermost server log for `address forbidden` — that's `AllowedUntrustedInternalConnections` blocking the callback URL server-side (see SKILL.md). Add the callback host to that setting and restart Mattermost.

3. If the callback URL is HTTPS with a self-signed cert, also check the log for a TLS/certificate verification error — that's `EnableInsecureOutgoingConnections` (see SKILL.md).

A successful click resolves the card in place (the buttons disappear, replaced by the chosen answer) within a couple seconds.
