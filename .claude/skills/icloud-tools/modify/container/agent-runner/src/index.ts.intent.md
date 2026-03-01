# icloud-tools: agent-runner index.ts changes

Two additions:

1. Add `'ICLOUD_APP_PASSWORD'` to the `SECRET_ENV_VARS` array (strips iCloud password from Bash subprocess environments)
2. Add `'mcp__icloud-tools__*'` to the `allowedTools` array (enables agents to call all icloud-tools MCP tools)

Do NOT add `ICLOUD_EMAIL` to SECRET_ENV_VARS (not sensitive enough, same pattern as PASSION_GOOGLE_EMAIL).
