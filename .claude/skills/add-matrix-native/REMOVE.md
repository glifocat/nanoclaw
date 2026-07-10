# Remove Native Matrix Channel

Every step is idempotent. Preserve the Matrix crypto store unless the operator
explicitly requests permanent key deletion.

## 1. Remove channel registration and copied files

Delete this import from `src/channels/index.ts` when present:

```typescript
import './matrix.js';
```

Delete every file copied by the skill:

```bash
rm -f \
  src/channels/matrix.ts \
  src/channels/matrix-crypto-integrity.ts \
  src/channels/matrix-crypto-integrity.test.ts \
  src/channels/matrix.test.ts \
  src/channels/matrix-registration.test.ts \
  scripts/verify-matrix-crypto.ts
```

Keep the generic `ChannelAdapter.threadIdForReplyToMessage` hook and its router
test. They are core integration seams and may be used by other adapters.

## 2. Remove the Matrix dependency and integrity script

```bash
pnpm remove matrix-bot-sdk
pnpm pkg delete scripts.verify:matrix-crypto
```

Keep `better-sqlite3@12.10.0` while the checkout runs on Node 24; the older
11.x native binding cannot load under that runtime.

## 3. Remove Matrix-only workspace entries

Remove `@matrix-org/matrix-sdk-crypto-nodejs` from `onlyBuiltDependencies` only
when no other installed integration uses it. Remove these exact override keys
under the same condition:

```yaml
'@matrix-org/matrix-sdk-crypto-nodejs'
'request@2.88.2>form-data'
'request@2.88.2>qs'
'request@2.88.2>tough-cookie'
'request-promise@4.2.6>tough-cookie'
```

Run `pnpm install` to refresh `pnpm-lock.yaml`.

## 4. Remove credentials and configuration

Remove these entries from `.env` when present:

```text
MATRIX_BASE_URL
MATRIX_ACCESS_TOKEN
MATRIX_USER_ID
MATRIX_USERNAME
MATRIX_PASSWORD
MATRIX_DEVICE_NAME
MATRIX_E2EE
MATRIX_STORE_PATH
MATRIX_CRYPTO_STORE_PATH
MATRIX_ACTION_STORE_PATH
MATRIX_THREADED_ROOMS
MATRIX_INVITE_AUTOJOIN
MATRIX_INVITE_AUTOJOIN_ALLOWLIST
```

## 5. Rebuild and restart

```bash
pnpm run build
source setup/lib/install-slug.sh

# Linux
systemctl --user restart "$(systemd_unit)"

# macOS
launchctl kickstart -k "gui/$(id -u)/$(launchd_label)"
```

Confirm no new `Channel adapter started` log entry names `matrix`.

## 6. Delete local Matrix state only on explicit request

The configured crypto directory contains the bot's device identity and room
keys. Deleting it can make historical encrypted messages unrecoverable and
forces a new Matrix device identity.

If the operator explicitly confirms permanent deletion, remove the configured
`MATRIX_STORE_PATH`, `MATRIX_CRYPTO_STORE_PATH`, and
`MATRIX_ACTION_STORE_PATH`. Otherwise leave them intact for rollback or later
reinstallation.
