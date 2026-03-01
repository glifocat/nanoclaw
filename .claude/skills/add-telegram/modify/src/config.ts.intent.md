# Intent: src/config.ts modifications

## What changed
Added two new configuration exports for Telegram channel support. Updated HOME_DIR to use `os.homedir()` fallback.

## Key sections
- **Import**: Added `import os from 'os'` for homedir fallback
- **readEnvFile call**: Includes `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ONLY` in the keys array
- **HOME_DIR**: Uses `os.homedir()` fallback instead of hardcoded path
- **TELEGRAM_BOT_TOKEN**: Read from `process.env` first, then `envConfig` fallback, defaults to empty string (channel disabled when empty)
- **TELEGRAM_ONLY**: Boolean flag from `process.env` or `envConfig`, when `true` disables WhatsApp channel creation

## Invariants
- All existing config exports remain unchanged
- New Telegram keys are added to the `readEnvFile` call alongside existing keys
- New exports are appended at the end of the file
- Both `process.env` and `envConfig` are checked (same pattern as `ASSISTANT_NAME`)
- The `escapeRegex` helper and `TRIGGER_PATTERN` construction unchanged
- TIMEZONE export unchanged
