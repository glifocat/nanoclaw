---
name: add-resend
description: Add Resend (email) channel integration via Chat SDK.
---

# Add Resend Email Channel

Connect NanoClaw to email via Resend for async email conversations.

## Install

NanoClaw doesn't ship channels in trunk. This skill copies the Resend adapter in from the `channels` branch.

### Pre-flight (diagnostics)

These markers indicate a prior install. They are diagnostic only, not a skip gate — the install steps below always run, and each is individually idempotent.

- `src/channels/resend.ts` exists
- `src/channels/resend-registration.test.ts` exists
- `src/channels/index.ts` contains `import './resend.js';`
- `@resend/chat-sdk-adapter` is listed in `package.json` dependencies

> These steps run unconditionally on every invocation; all are individually idempotent. If you carry local patches to `src/channels/resend.ts`, note that step 2 overwrites the file from `origin/channels`.

### 1. Fetch the channels branch

```bash
git fetch origin channels
```

### 2. Copy the adapter and its registration test

```bash
git show origin/channels:src/channels/resend.ts                 > src/channels/resend.ts
git show origin/channels:src/channels/resend-registration.test.ts > src/channels/resend-registration.test.ts
```

### 3. Append the self-registration import

Append to `src/channels/index.ts` (skip if the line is already present):

```typescript
import './resend.js';
```

### 4. Install the adapter package (pinned)

```bash
pnpm install @resend/chat-sdk-adapter@0.1.1
```

### 5. Build and validate

```bash
pnpm run build
pnpm exec vitest run src/channels/resend-registration.test.ts
```

Both must be clean before proceeding. `resend-registration.test.ts` is the one integration test: it imports the real channel barrel and asserts the registry contains `resend`. It goes red if the `import './resend.js';` line is deleted or drifts, if the barrel fails to evaluate, or if `@resend/chat-sdk-adapter` isn't installed (the import throws) — so it also implicitly verifies the dependency from step 4. The adapter also calls core's `createChatSdkBridge(...)`; that typed core-API consumption is guarded by `pnpm run build`.

## Credentials

If `.env` already contains `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`, the channel is already configured — skip to **Next Steps**. Otherwise, walk through the steps below.

1. Go to [resend.com](https://resend.com) and create an account.
2. Add and verify your sending domain.
3. Go to **API Keys** and create a new key.
4. Set up a webhook:
   - Go to **Webhooks** > **Add webhook**.
   - URL: `https://your-domain/webhook/resend`.
   - Events: select **email.received**.
   - Copy the signing secret.

### Configure environment

Add to `.env`:

```bash
RESEND_API_KEY=re_...
RESEND_FROM_ADDRESS=bot@yourdomain.com
RESEND_FROM_NAME=NanoClaw
RESEND_WEBHOOK_SECRET=your-webhook-secret
```

Sync to container: `mkdir -p data/env && cp .env data/env/env`

## Next Steps

If you're in the middle of `/setup`, return to the setup flow now.

Otherwise, run `/manage-channels` to wire this channel to an agent group.

## Channel Info

- **type**: `resend`
- **terminology**: Resend handles email. Each email thread (identified by subject/In-Reply-To headers) is a separate conversation. The "from address" is the bot's identity.
- **how-to-find-id**: The platform ID is the from email address (e.g. `bot@yourdomain.com`). Each sender's email thread becomes its own conversation.
- **supports-threads**: yes (via email threading headers -- replies to the same thread stay together)
- **typical-use**: Async communication -- email conversations with longer response expectations
- **default-isolation**: Same agent group if you want your agent to handle email alongside other channels. Separate agent group if email contains sensitive correspondence that shouldn't be accessible from other channels.
