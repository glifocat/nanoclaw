# Google Workspace MCP Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the passion group to access Google Calendar and Gmail via `workspace-mcp` running inside agent containers.

**Architecture:** Host reads Google OAuth secrets from `.env`, passes them to the container via stdin. Claude Code SDK inside the container interpolates `${...}` vars in `settings.json` and spawns `uvx workspace-mcp` as a stdio MCP server. Only the passion group's `settings.json` has the MCP config.

**Tech Stack:** Python 3 + uv (in container), workspace-mcp (PyPI), Claude Code Agent SDK

**Design doc:** `docs/plans/2026-02-23-google-workspace-mcp-design.md`

---

### Task 1: Add Python + uv to the Dockerfile

**Files:**
- Modify: `container/Dockerfile:6-26` (apt-get block)
- Modify: `container/Dockerfile:30` (after ENV lines)

**Step 1: Add python3 packages to apt-get install**

In `container/Dockerfile`, change the apt-get block to include python3:

```dockerfile
# Install system dependencies for Chromium and Python-based MCP servers
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*
```

**Step 2: Add uv install after ENV lines**

After line 30 (`ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`), add:

```dockerfile
# Install uv (Python package manager for MCP servers)
RUN pip3 install --no-cache-dir uv --break-system-packages
```

**Step 3: Commit**

```bash
git add container/Dockerfile
git commit -m "feat(container): add Python 3 + uv for Python-based MCP servers"
```

---

### Task 2: Expand secrets allowlist

**Files:**
- Modify: `src/container-runner.ts:186`

**Step 1: Add Google OAuth keys to readSecrets()**

In `src/container-runner.ts`, change line 186 from:

```typescript
  return readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
```

to:

```typescript
  return readEnvFile([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'PASSION_GOOGLE_EMAIL',
  ]);
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: no errors

**Step 3: Commit**

```bash
git add src/container-runner.ts
git commit -m "feat(secrets): add Google OAuth keys to container secrets allowlist"
```

---

### Task 3: Sanitize Google secrets from Bash subprocesses

**Files:**
- Modify: `container/agent-runner/src/index.ts:191`

**Step 1: Add Google secrets to SECRET_ENV_VARS**

In `container/agent-runner/src/index.ts`, change line 191 from:

```typescript
const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];
```

to:

```typescript
const SECRET_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
];
```

Note: `PASSION_GOOGLE_EMAIL` is not secret — it's just an email address, no need to sanitize.

**Step 2: Commit**

```bash
git add container/agent-runner/src/index.ts
git commit -m "feat(security): sanitize Google OAuth secrets from Bash subprocess env"
```

---

### Task 4: Configure passion group settings.json

**Files:**
- Modify: `data/sessions/passion/.claude/settings.json`

**Step 1: Add MCP server config**

Replace the entire contents of `data/sessions/passion/.claude/settings.json` with:

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

Note: `data/sessions/` is gitignored (session data is per-machine), so no commit needed.

---

### Task 5: Add .env placeholders

**Files:**
- Modify: `.env`

**Step 1: Append Google OAuth placeholders**

Add to the end of `.env`:

```bash
# Google Workspace MCP (passion group)
GOOGLE_OAUTH_CLIENT_ID=PLACEHOLDER
GOOGLE_OAUTH_CLIENT_SECRET=PLACEHOLDER
PASSION_GOOGLE_EMAIL=ethan@passion.io
```

Note: `.env` is gitignored, so no commit needed. User replaces PLACEHOLDERs with real values from Google Cloud Console.

---

### Task 6: Rebuild container image

**Step 1: Prune stale build cache**

Per CLAUDE.md: buildkit caches aggressively — COPY steps may retain stale files. Prune first:

```bash
container system prune --build-cache
```

If that command isn't supported by Apple Container, skip and proceed.

**Step 2: Rebuild the image**

```bash
./container/build.sh
```

Expected: Build completes successfully. Look for `Build complete!` in output.

**Step 3: Verify Python and uv are installed**

```bash
container run --rm nanoclaw-agent:latest python3 --version
container run --rm nanoclaw-agent:latest uvx --version
```

Expected: Python 3.x and uv version numbers printed.

---

### Task 7: Smoke test (manual)

**Step 1: Restart NanoClaw**

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

**Step 2: Send test message from passion group WhatsApp**

```
Gambi, what tools do you have available from Google Workspace?
```

Expected: Gambi should respond mentioning calendar and gmail tools. If MCP failed to start, check logs:

```bash
ls -t groups/passion/logs/container-*.log | head -1 | xargs tail -100
```

Look for errors mentioning `uvx`, `workspace-mcp`, or `MCP`.

---

## Post-Implementation Notes

- **OAuth flow:** First real Calendar/Gmail query will trigger OAuth. User must open the URL in browser, authenticate, and send the code back to Gambi.
- **Token persistence:** `workspace-mcp` stores OAuth tokens in `~/.config/` inside the container. Since containers are ephemeral, tokens may not persist between runs. If re-authentication is needed every time, a persistent mount for `~/.config/workspace-mcp/` should be added to `container-runner.ts` (tracked as follow-up).
- **Adding more services:** Change `--tools gmail calendar` to include `drive`, `docs`, `sheets`, etc.
