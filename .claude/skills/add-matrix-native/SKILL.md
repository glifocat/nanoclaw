---
name: add-matrix-native
description: Add Matrix as a channel using a direct matrix-bot-sdk adapter with persistent end-to-end encryption, per-message threads, encrypted attachments, and approval reactions. Use for Matrix homeservers when a native E2EE client is preferred over the mutually exclusive Beeper /add-matrix adapter.
---

# Add Matrix Channel (native E2EE)

Connect NanoClaw directly to any Matrix homeserver with `matrix-bot-sdk` and
the Rust `@matrix-org/matrix-sdk-crypto-nodejs` binding. Persist the device
identity and room keys on disk so encrypted rooms and DMs survive restarts.

This skill is mutually exclusive with `/add-matrix`: both register the
`matrix` channel type. Replace one with the other; never enable both.

## Install

### Pre-flight diagnostics

Inspect these markers, but continue through every install section. Each section
has its own idempotent gate:

- `node --version` reports Node.js 24 or newer
- `src/channels/matrix.ts` imports `matrix-bot-sdk`
- `src/channels/matrix-crypto-integrity.ts` exists
- `src/channels/index.ts` imports `./matrix.js`
- `package.json` pins `matrix-bot-sdk` and `better-sqlite3`
- `pnpm-workspace.yaml` pins Matrix crypto 0.6.1

### 1. Require Node.js 24

Run:

```bash
node -e 'const major=Number(process.versions.node.split(".")[0]); if(major<24){console.error("Native Matrix requires Node.js 24+"); process.exit(1)}'
```

Stop if it fails. `@matrix-org/matrix-sdk-crypto-nodejs@0.6.1` declares
Node.js 24 as its minimum runtime. Do not install the adapter under Node 20 or
22.

### 2. Resolve an existing Matrix adapter

Check whether `package.json` contains `@beeper/chat-adapter-matrix`. If absent,
continue. If present, stop and ask the operator to confirm replacing the
Beeper adapter and its current Matrix connection. After explicit approval:

```bash
pnpm remove @beeper/chat-adapter-matrix
```

Do not delete `store/matrix/` or any Matrix crypto directory.

### 3. Fetch and copy the native adapter

Always refresh the registry branch, then copy its canonical files:

```bash
git fetch origin channels
git show origin/channels:src/channels/matrix.ts                       > src/channels/matrix.ts
git show origin/channels:src/channels/matrix-crypto-integrity.ts      > src/channels/matrix-crypto-integrity.ts
git show origin/channels:src/channels/matrix-crypto-integrity.test.ts > src/channels/matrix-crypto-integrity.test.ts
git show origin/channels:src/channels/matrix.test.ts                  > src/channels/matrix.test.ts
git show origin/channels:src/channels/matrix-registration.test.ts     > src/channels/matrix-registration.test.ts
git show origin/channels:scripts/verify-matrix-crypto.ts              > scripts/verify-matrix-crypto.ts
```

### 4. Register the channel

Append this import to `src/channels/index.ts` only when absent:

```typescript
import './matrix.js';
```

### 5. Approve and pin the native build

Check whether `onlyBuiltDependencies` already contains
`@matrix-org/matrix-sdk-crypto-nodejs`. If it does, continue. Otherwise stop
and use `AskUserQuestion` to obtain explicit operator approval before editing
the list. Explain that install scripts execute downloaded native code. Do not
continue without an explicit yes.

After approval, add the exact entry while preserving every existing item:

```yaml
onlyBuiltDependencies:
  - '@matrix-org/matrix-sdk-crypto-nodejs'
```

Add these exact overrides under the existing top-level `overrides` map, or
create that map when absent:

```yaml
overrides:
  '@matrix-org/matrix-sdk-crypto-nodejs': 0.6.1
  'request@2.88.2>form-data': 2.5.6
  'request@2.88.2>qs': 6.15.3
  'request@2.88.2>tough-cookie': 4.1.4
  'request-promise@4.2.6>tough-cookie': 4.1.4
```

Install exact versions. `better-sqlite3` 12.10.0 supplies the Node 24 binding
used by NanoClaw's core database layer:

```bash
pnpm add matrix-bot-sdk@0.8.0 better-sqlite3@12.10.0 --save-exact
pnpm rebuild @matrix-org/matrix-sdk-crypto-nodejs better-sqlite3
```

### 6. Register and run the integrity gate

Add this package script only when absent:

```json
"verify:matrix-crypto": "tsx scripts/verify-matrix-crypto.ts"
```

Then run:

```bash
pnpm run verify:matrix-crypto
```

The Matrix adapter also runs this verification before importing
`matrix-bot-sdk`, so an unknown or modified Rust binary prevents only the
Matrix adapter from starting.

### 7. Build and test

```bash
pnpm run build
pnpm exec vitest run \
  src/channels/matrix.test.ts \
  src/channels/matrix-crypto-integrity.test.ts \
  src/channels/matrix-registration.test.ts \
  src/router-threading.test.ts
```

Do not configure credentials until all checks pass.

## Credentials

If `.env` already contains `MATRIX_BASE_URL` plus either
`MATRIX_ACCESS_TOKEN` and `MATRIX_USER_ID`, or `MATRIX_USERNAME` and
`MATRIX_PASSWORD`, skip to **Behavior and storage**. Otherwise configure one
authentication method for a dedicated bot account.

### Access token

```bash
MATRIX_BASE_URL=https://matrix.example.com
MATRIX_ACCESS_TOKEN=...
MATRIX_USER_ID=@nanoclaw:example.com
```

### Password

```bash
MATRIX_BASE_URL=https://matrix.example.com
MATRIX_USERNAME=nanoclaw
MATRIX_PASSWORD=...
```

The first password login caches the resulting access token in the protected
local Matrix store.

## Behavior and storage

Configure optional behavior in `.env`:

```bash
# E2EE defaults on and does not require SSSS or a recovery key.
MATRIX_E2EE=true

# Persist and back up these paths. Defaults shown.
MATRIX_STORE_PATH=data/v2-matrix-store.json
MATRIX_CRYPTO_STORE_PATH=data/v2-matrix-crypto
MATRIX_ACTION_STORE_PATH=data/v2-matrix-adapter.json

# Auto-join defaults off. Enable only with an inviter allowlist.
MATRIX_INVITE_AUTOJOIN=true
MATRIX_INVITE_AUTOJOIN_ALLOWLIST=@owner:example.com

# Every group-room top-level message starts a thread by default.
MATRIX_THREADED_ROOMS=*
# Set an empty value to disable promotion, or list selected room IDs.
```

The adapter uses `m.direct` account data as the only DM classifier. A room with
two members remains a channel unless the bot account marks it as direct.

For an existing `matrix-bot-sdk` installation, explicitly reuse its persisted
identity and sessions:

```bash
MATRIX_STORE_PATH=store/matrix/bot.json
MATRIX_CRYPTO_STORE_PATH=store/matrix/crypto
```

Do not change the crypto path or reuse one crypto directory concurrently from
two processes.

## Start and smoke test

Build before restarting, then use the install-specific service helper:

```bash
pnpm run build
source setup/lib/install-slug.sh

# Linux
systemctl --user restart "$(systemd_unit)"

# macOS
launchctl kickstart -k "gui/$(id -u)/$(launchd_label)"
```

Confirm the logs show Matrix startup and E2EE initialization. Send a new
encrypted DM to the bot and verify it decrypts and replies. Then test one
group-room message: the first agent reply should create a thread rooted at that
message.

Approval prompts pre-apply reactions and label the same choices in the body:
✅ approve, ❌ reject, and 📝 reject with reason. A numbered text reply remains
available as a fallback.

## Next steps

If setup is in progress, return to it. Otherwise run `/init-first-agent` for a
bot DM or `/manage-channels` to wire a Matrix room to an existing agent group.

To uninstall the adapter, follow [REMOVE.md](REMOVE.md).

## Channel info

- **type:** `matrix`
- **terminology:** DMs and rooms
- **supports threads:** yes
- **platform ID:** Matrix room ID (`!room:server`) or Matrix user ID for a DM
- **user ID:** `matrix:@user:server`
- **DM classification:** authoritative `m.direct` account data only
- **typical use:** encrypted personal-assistant DMs and threaded shared rooms
- **default isolation:** isolate rooms containing other people; a two-member
  room is not automatically a DM
