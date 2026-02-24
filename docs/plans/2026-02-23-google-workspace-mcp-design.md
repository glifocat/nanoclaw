# Google Workspace MCP Integration — Design

> **Correction (2026-02-24):** This design originally specified `settings.json` for MCP server config. The Claude Agent SDK's `query()` function does NOT load MCP servers from `settings.json` — it loads them from `.mcp.json` at the project root. The actual implementation uses `groups/passion/.mcp.json`. See also: `groups/main/nanoclaw-mcp-best-practices.md`.

## Goal

Enable the "passion" group to access Google Calendar and Gmail via the `workspace-mcp` MCP server running inside the agent container.

## Scope

- **Group:** passion only
- **Services:** Calendar + Gmail (expandable later via `--tools` flag)
- **OAuth credentials:** Placeholder values; user will fill in real credentials from Google Cloud Console

## Architecture

```
Host (.env)                    Container (passion)
+-----------------------+      +----------------------------------+
| GOOGLE_OAUTH_CLIENT_ID|      | sdkEnv (from stdin secrets)      |
| GOOGLE_OAUTH_CLIENT_  | ---> | Claude Code SDK reads settings   |
|   SECRET              |stdin | .json, interpolates ${...} vars  |
| PASSION_GOOGLE_EMAIL  |      | Launches: uvx workspace-mcp     |
+-----------------------+      +----------------------------------+
```

Flow:
1. Host reads `.env` via `readSecrets()` (expanded allowlist)
2. Secrets passed to container via stdin JSON (never on disk/env)
3. Agent-runner loads secrets into `sdkEnv`
4. Claude Code SDK reads `~/.claude/settings.json` (mounted from `data/sessions/passion/.claude/`)
5. SDK interpolates `${GOOGLE_OAUTH_CLIENT_ID}` etc. from `sdkEnv`
6. SDK spawns `uvx workspace-mcp --tools gmail calendar` as MCP stdio server

## Changes

### 1. container/Dockerfile

Add Python 3 + uv to the container image.

```dockerfile
# In apt-get install block, add:
    python3 \
    python3-pip \
    python3-venv \

# After ENV lines, add:
RUN pip3 install --no-cache-dir uv --break-system-packages
```

### 2. src/container-runner.ts — readSecrets()

Expand the allowlist from 2 to 5 keys:

```typescript
return readEnvFile([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'PASSION_GOOGLE_EMAIL',
]);
```

### 3. container/agent-runner/src/index.ts — SECRET_ENV_VARS

Add Google secrets to the sanitization list so they don't leak to Bash subprocesses:

```typescript
const SECRET_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
];
```

Note: `PASSION_GOOGLE_EMAIL` is not secret (it's just an email address), so it doesn't need sanitization.

### 4. data/sessions/passion/.claude/settings.json

Add MCP server configuration:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD": "1",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "0",
    "MCP_TIMEOUT": "30000"
  },
  "mcpServers": {
    "google-workspace": {
      "type": "stdio",
      "command": "uvx",
      "args": ["workspace-mcp", "--tools", "gmail", "calendar"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_ID": "${GOOGLE_OAUTH_CLIENT_ID}",
        "GOOGLE_OAUTH_CLIENT_SECRET": "${GOOGLE_OAUTH_CLIENT_SECRET}",
        "USER_GOOGLE_EMAIL": "${PASSION_GOOGLE_EMAIL}"
      }
    }
  }
}
```

### 5. .env

Add placeholder values:

```bash
GOOGLE_OAUTH_CLIENT_ID=PLACEHOLDER
GOOGLE_OAUTH_CLIENT_SECRET=PLACEHOLDER
PASSION_GOOGLE_EMAIL=ethan@passion.io
```

## Security

- Secrets flow: `.env` -> `readSecrets()` -> stdin JSON -> `sdkEnv` (never on disk inside container)
- Google OAuth secrets sanitized from Bash subprocess env via `SECRET_ENV_VARS`
- Only passion group has `google-workspace` in its `settings.json`; other groups unaffected
- OAuth tokens stored by `workspace-mcp` in container filesystem (ephemeral per container run)

## OAuth Authentication Flow

On first use, `workspace-mcp` will:
1. Detect no cached OAuth tokens
2. Output an authorization URL
3. Gambi relays the URL to the user via WhatsApp
4. User opens URL, authenticates with Google, gets a code
5. User sends code back to Gambi
6. `workspace-mcp` exchanges code for tokens and caches them

Note: Token persistence across container runs depends on where `workspace-mcp` stores them. May need a persistent mount — to be validated during implementation.

## Rejected Alternatives

- **npx approach:** `@taylorwilsdon/google-workspace-mcp` doesn't exist as npm package; it's Python-only
- **HTTP remote server:** Running workspace-mcp on host adds operational complexity (extra service to manage)
- **Per-group secrets:** Over-engineering for single group use case
- **Hardcoded secrets:** Violates NanoClaw security patterns
