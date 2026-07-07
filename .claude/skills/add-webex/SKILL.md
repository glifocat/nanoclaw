---
name: add-webex
description: Add Webex channel integration via Chat SDK.
---

# Add Webex Channel

Adds Cisco Webex support via the Chat SDK bridge.

## Install

NanoClaw doesn't ship channels in trunk. This skill copies the Webex adapter in from the `channels` branch.

### Pre-flight (diagnostics)

These markers indicate a prior install. They are diagnostic only, not a skip gate — the install steps below always run, and each is individually idempotent.

- `src/channels/webex.ts` exists
- `src/channels/webex-registration.test.ts` exists
- `src/channels/index.ts` contains `import './webex.js';`
- `@bitbasti/chat-adapter-webex` is listed in `package.json` dependencies

> These steps run unconditionally on every invocation; all are individually idempotent. If you carry local patches to `src/channels/webex.ts`, note that step 2 overwrites the file from `origin/channels`.

### 1. Fetch the channels branch

```bash
git fetch origin channels
```

### 2. Copy the adapter and its registration test

```bash
git show origin/channels:src/channels/webex.ts                 > src/channels/webex.ts
git show origin/channels:src/channels/webex-registration.test.ts > src/channels/webex-registration.test.ts
```

### 3. Append the self-registration import

Append to `src/channels/index.ts` (skip if the line is already present):

```typescript
import './webex.js';
```

### 4. Install the adapter package (pinned)

```bash
pnpm install @bitbasti/chat-adapter-webex@0.1.0
```

### 5. Build and validate

```bash
pnpm run build
pnpm exec vitest run src/channels/webex-registration.test.ts
```

Both must be clean before proceeding. `webex-registration.test.ts` is the one integration test: it imports the real channel barrel and asserts the registry contains `webex`. It goes red if the `import './webex.js';` line is deleted or drifts, if the barrel fails to evaluate, or if `@bitbasti/chat-adapter-webex` isn't installed (the import throws) — so it also implicitly verifies the dependency from step 4. The adapter also calls core's `createChatSdkBridge(...)`; that typed core-API consumption is guarded by `pnpm run build`.

End-to-end message delivery against a real Webex space is verified manually once the service is running — see Next Steps and the webhook setup above.

## Credentials

If `.env` already contains `WEBEX_BOT_TOKEN` and `WEBEX_WEBHOOK_SECRET`, the channel is already configured — skip to **Next Steps**. Otherwise, walk through the steps below.

1. Go to [developer.webex.com](https://developer.webex.com/my-apps/new/bot) and create a new bot
2. Copy the **Bot Access Token**
3. Set up a webhook:
   - Use the Webex API or Developer Portal to create a webhook pointing to `https://your-domain/webhook/webex`
   - Set a webhook secret for signature verification

### Configure environment

Add to `.env`:

```bash
WEBEX_BOT_TOKEN=your-bot-token
WEBEX_WEBHOOK_SECRET=your-webhook-secret
```

Sync to container: `mkdir -p data/env && cp .env data/env/env`

## Next Steps

If you're in the middle of `/setup`, return to the setup flow now.

Otherwise, run `/manage-channels` to wire this channel to an agent group.

## Channel Info

- **type**: `webex`
- **terminology**: Webex has "spaces." A space can be a group conversation or a 1:1 direct message with the bot.
- **how-to-find-id**: Open the space in Webex, click the space name > Settings — the Space ID is listed there. Or use the Webex API (`GET /rooms`) to list spaces and their IDs.
- **supports-threads**: yes
- **typical-use**: Interactive chat — team spaces or direct messages
- **default-isolation**: Same agent group for spaces where you're the primary user. Separate agent group for spaces with different teams or sensitive information.
