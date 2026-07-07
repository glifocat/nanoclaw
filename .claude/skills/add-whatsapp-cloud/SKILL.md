---
name: add-whatsapp-cloud
description: Add WhatsApp Business Cloud API channel via Chat SDK. Official Meta API.
---

# Add WhatsApp Cloud API Channel

Connect NanoClaw to WhatsApp via the official Meta WhatsApp Business Cloud API.

## Install

NanoClaw doesn't ship channels in trunk. This skill copies the WhatsApp Cloud adapter in from the `channels` branch.

### Pre-flight (diagnostics)

These markers indicate a prior install. They are diagnostic only, not a skip gate — the install steps below always run, and each is individually idempotent.

- `src/channels/whatsapp-cloud.ts` exists
- `src/channels/whatsapp-cloud-registration.test.ts` exists
- `src/channels/index.ts` contains `import './whatsapp-cloud.js';`
- `@chat-adapter/whatsapp` is listed in `package.json` dependencies

> These steps run unconditionally on every invocation; all are individually idempotent. If you carry local patches to `src/channels/whatsapp-cloud.ts`, note that step 2 overwrites the file from `origin/channels`.

### 1. Fetch the channels branch

```bash
git fetch origin channels
```

### 2. Copy the adapter and its registration test

```bash
git show origin/channels:src/channels/whatsapp-cloud.ts                 > src/channels/whatsapp-cloud.ts
git show origin/channels:src/channels/whatsapp-cloud-registration.test.ts > src/channels/whatsapp-cloud-registration.test.ts
```

### 3. Append the self-registration import

Append to `src/channels/index.ts` (skip if the line is already present):

```typescript
import './whatsapp-cloud.js';
```

### 4. Install the adapter package (pinned)

```bash
pnpm install @chat-adapter/whatsapp@4.29.0
```

### 5. Build and validate

```bash
pnpm run build
pnpm exec vitest run src/channels/whatsapp-cloud-registration.test.ts
```

Both must be clean before proceeding. `whatsapp-cloud-registration.test.ts` is the one integration test: it imports the real channel barrel and asserts the registry contains `whatsapp-cloud`. It goes red if the `import './whatsapp-cloud.js';` line is deleted or drifts, if the barrel fails to evaluate, or if `@chat-adapter/whatsapp` isn't installed (the import throws) — so it also implicitly verifies the dependency from step 4. The adapter also calls core's `createChatSdkBridge(...)`; that typed core-API consumption is guarded by `pnpm run build`.

End-to-end message delivery against a real WhatsApp Business number is verified manually once the service is running — see Next Steps and the webhook setup above.

## Credentials

If `.env` already contains `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_VERIFY_TOKEN`, the channel is already configured — skip to **Next Steps**. Otherwise, walk through the steps below.

1. Go to [Meta for Developers](https://developers.facebook.com/apps/) and create an app (type: Business).
2. Add the **WhatsApp** product.
3. Go to **WhatsApp** > **API Setup**:
   - Note the **Phone Number ID** (not the phone number itself).
   - Generate a **permanent System User access token** with `whatsapp_business_messaging` permission.
4. Go to **WhatsApp** > **Configuration**:
   - Set webhook URL: `https://your-domain/webhook/whatsapp`.
   - Set a **Verify Token** (any random string you choose).
   - Subscribe to webhook fields: `messages`.
5. Copy the **App Secret** from **Settings** > **Basic**.

### Configure environment

Add to `.env`:

```bash
WHATSAPP_ACCESS_TOKEN=your-system-user-access-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_APP_SECRET=your-app-secret
WHATSAPP_VERIFY_TOKEN=your-verify-token
```

Sync to container: `mkdir -p data/env && cp .env data/env/env`

## Next Steps

If you're in the middle of `/setup`, return to the setup flow now.

Otherwise, run `/manage-channels` to wire this channel to an agent group.

## Channel Info

- **type**: `whatsapp-cloud`
- **terminology**: WhatsApp Cloud API supports 1:1 conversations only (no group chats). Each conversation is with a phone number.
- **how-to-find-id**: The platform ID is the Phone Number ID from the Meta Business dashboard (not the phone number itself). Find it under WhatsApp > API Setup.
- **supports-threads**: no
- **typical-use**: Interactive 1:1 chat -- direct messages only
- **default-isolation**: Same agent group if you're the only person messaging the bot. Each additional person who messages gets their own conversation automatically, but they share the agent's workspace and memory -- use a separate agent group if you need information isolation between different contacts.
