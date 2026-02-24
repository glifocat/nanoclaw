# Vanta MCP Integration — Design

> **Correction (2026-02-24):** This design originally specified `settings.json` for MCP server config. The Claude Agent SDK's `query()` function does NOT load MCP servers from `settings.json` — it loads them from `.mcp.json` at the project root. The actual implementation uses `groups/passion/.mcp.json`. See also: `groups/main/nanoclaw-mcp-best-practices.md`.

## Goal

Enable the "passion" group to query Vanta compliance data (tests, frameworks, documents, integrations) via the official `@vantasdk/vanta-mcp-server` MCP server running inside the agent container.

## Scope

- **Group:** passion only
- **MCP server:** `@vantasdk/vanta-mcp-server` (official, public preview)
- **Capabilities:** Read-only compliance queries (6 tools)
- **Auth:** Vanta API token (placeholder for now)

## Architecture

Follows the established NanoClaw MCP pattern (same as Google Workspace integration):

```
Host (.env)                    Container (passion)
+-----------------------+      +----------------------------------+
| VANTA_API_TOKEN       |      | sdkEnv (from stdin secrets)      |
|                       | ---> | Claude Code SDK reads settings   |
|                       |stdin | .json, interpolates ${...} vars  |
|                       |      | Launches: npx @vantasdk/vanta-   |
|                       |      |   mcp-server                     |
+-----------------------+      +----------------------------------+
```

Flow:
1. Host reads `.env` via `readSecrets()` (expanded allowlist)
2. Secrets passed to container via stdin JSON (never on disk/env)
3. Agent-runner loads secrets into `sdkEnv`
4. Claude Code SDK reads `~/.claude/settings.json` (mounted from `data/sessions/passion/.claude/`)
5. SDK interpolates `${VANTA_API_TOKEN}` from `sdkEnv`
6. SDK spawns `npx -y @vantasdk/vanta-mcp-server` as MCP stdio server

## Changes

### 1. .env

Add placeholder:

```bash
VANTA_API_TOKEN=PLACEHOLDER
```

### 2. src/container-runner.ts — readSecrets()

Add `VANTA_API_TOKEN` to the allowlist:

```typescript
return readEnvFile([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'PASSION_GOOGLE_EMAIL',
  'VANTA_API_TOKEN',
]);
```

### 3. container/agent-runner/src/index.ts — SECRET_ENV_VARS

Add `VANTA_API_TOKEN` to the sanitization list:

```typescript
const SECRET_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'VANTA_API_TOKEN',
];
```

### 4. data/sessions/passion/.claude/settings.json

Add `vanta` MCP server alongside existing `google-workspace`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD": "1",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "0",
    "MCP_TIMEOUT": "30000",
    "MAX_MCP_OUTPUT_TOKENS": "50000"
  },
  "mcpServers": {
    "google-workspace": {
      "...": "existing config unchanged"
    },
    "vanta": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@vantasdk/vanta-mcp-server"],
      "env": {
        "VANTA_API_TOKEN": "${VANTA_API_TOKEN}"
      }
    }
  }
}
```

### 5. Dockerfile (optional optimization)

Pre-install the package to avoid npx download latency on first use:

```dockerfile
RUN npm install -g @vantasdk/vanta-mcp-server
```

If skipped, `npx -y` will download on first container run (adds ~10-15s latency once).

## Tools Available to Agent

| Tool | Description |
|------|-------------|
| `mcp__vanta__list_tests` | Query 1,200+ automated security tests, filter by status/integration |
| `mcp__vanta__get_test` | Get test details including failing resources for remediation |
| `mcp__vanta__list_frameworks` | List compliance frameworks (SOC 2, ISO 27001, etc.) with progress |
| `mcp__vanta__get_framework_controls` | Retrieve controls with implementation guidance and status |
| `mcp__vanta__list_documents` | List compliance documents and evidence |
| `mcp__vanta__list_integrations` | List connected integrations and their status |

## Security

- Secret flow: `.env` → `readSecrets()` → stdin JSON → `sdkEnv` (never on disk inside container)
- `VANTA_API_TOKEN` sanitized from Bash subprocess env via `SECRET_ENV_VARS`
- Only passion group has `vanta` in its `settings.json`; other groups unaffected
- Vanta MCP server is read-only (no write operations)

## What's NOT Changed

- No modifications to agent-runner query logic or `ContainerInput` interface
- No changes to the nanoclaw MCP server (IPC)
- No changes to IPC, routing, or message handling
- No impact on other groups

## Future Extension

If more Vanta capabilities are needed (vulnerabilities, evidence upload), options:
- Wait for Vanta to expand their official MCP server
- Use `WebFetch` for ad-hoc API calls as a fallback
- Build custom tools in a separate MCP server (Opcion C from brainstorming)

## Rejected Alternatives

- **Custom MCP server with full API coverage:** Over-engineering for initial integration; official MCP covers 80% of use cases
- **Hardcoded mcpServers in agent-runner code:** Violates NanoClaw pattern of per-group settings.json config
- **Community MCP (securityfortech/vanta-mcp):** Official server is more maintained and authoritative
