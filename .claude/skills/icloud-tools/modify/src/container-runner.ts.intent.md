# icloud-tools: container-runner.ts changes

Add `'ICLOUD_EMAIL'` and `'ICLOUD_APP_PASSWORD'` to the `readSecrets()` function's `readEnvFile([...])` array.

This allows the host process to read these values from `.env` and pass them to containers via stdin.
