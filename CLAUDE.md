# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `src/env.ts` | Environment variable loading |
| `src/image.ts` | Image processing for WhatsApp attachments |
| `src/mount-security.ts` | Mount path validation and security |
| `src/reminders-ipc.ts` | Apple Reminders IPC bridge (host↔container) |
| `src/reminders-jxa.ts` | Apple Reminders JXA backend (legacy, slow) |
| `src/whatsapp-auth.ts` | WhatsApp QR auth flow |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `src/container-runtime.ts` | Apple Container / Docker runtime abstraction |
| `src/group-queue.ts` | Per-group message queue with concurrency control |
| `src/transcription.ts` | Voice message transcription (whisper-cli) |
| `container/skills/agent-browser/SKILL.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update` | **Do not use on this fork** — overwrites local customizations. Use `git fetch origin && git merge origin/main` instead |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload (tsx)
npm run build        # Compile TypeScript
npm start            # Run compiled dist/index.js
npm test             # Run tests (vitest)
npm run typecheck    # Type-check without emitting
npm run format       # Format with Prettier
npm run auth         # WhatsApp QR authentication
npm run setup        # Interactive first-time setup
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild:

```bash
docker builder prune -af   # or: container system prune (Apple Container)
./container/build.sh
```

## Key Gotchas

### Host & Build
- **Always `npm run build` after modifying `src/`**: The host process runs from `dist/`, not `src/`. Applying skills or editing TypeScript source has no effect until compiled. Container rebuild (`build.sh`) only affects what's inside containers, not the host.
- **Don't switch branches when dist/ has deployed code**: `dist/` is gitignored, so `git checkout` won't update it — but tracked files in other dirs (like `tools/`) will be removed, causing ENOENT. Always merge the feature branch before switching away, or rebuild + restart after switching.
- **`rootDir` boundary**: `tsconfig.json` has `rootDir: "./src"`. Don't import files from outside `src/` (e.g. `.claude/skills/`) in host-side TypeScript — move handler logic into `src/` instead.
- **launchd PATH**: Service runs with restricted PATH. `/opt/homebrew/bin` must be added to the plist for Homebrew binaries (ffmpeg, whisper-cli, etc.)
- **Dockerfile `npm install --omit=dev` breaks `npx tsc`**: TypeScript is a devDependency. Must `npm install` (full), then `npx tsc`, then `npm prune --omit=dev` to reduce image size. Applies to all MCP server builds in the Dockerfile.
- **Real database is `store/messages.db`**: Not `data/nanoclaw.db` or `data/messages.db` — those are empty 0-byte stubs. The `STORE_DIR` config points to `store/`.
- **DB schema**: If skipping sync-groups step (e.g. self-chat setup), the database tables don't exist yet. Must create schema manually before registering channels.

### Containers & MCP
- **Container mounts are not hot-reloaded**: Mounts (including `additionalMounts`, `settings.json`, and the mount allowlist) are assigned at container spawn time. If you change mounts/config, you MUST kill the running container (`container stop nanoclaw-{group}-*`) — otherwise the old container keeps serving via IPC and new mounts never take effect. The mount allowlist itself is cached in memory by the host process, so a service restart is also needed after editing `~/.config/nanoclaw/mount-allowlist.json`.
- **Agent-runner source caching**: Per-group copies of `container/agent-runner/src/` are cached in `data/sessions/{group}/agent-runner-src/` on first run. Updating the container source and rebuilding is NOT enough — must also sync files to all group caches: `cp container/agent-runner/src/*.ts data/sessions/*/agent-runner-src/`. Then restart service to kill running containers (30min idle timeout).
- **SDK MCP config goes in `.mcp.json`, not `settings.json`**: The Claude Agent SDK `query()` function reads MCP servers from `.mcp.json` at the project root (cwd), NOT from `settings.json` `mcpServers`. The `settingSources` parameter only loads env vars, permissions, and hooks. This differs from the `claude` CLI which reads MCP from settings.json.
- **Avoid `npx -y` for MCP stdio servers**: `npx` prints npm notices to stdout, corrupting the MCP JSON-RPC protocol. Always pre-install packages globally in the Dockerfile and use the binary name directly. Python's `uvx` is stdout-clean and safe to use.
- **`nonMainReadOnly` overrides per-root `allowReadWrite`**: The `nonMainReadOnly: true` flag in `mount-allowlist.json` unconditionally forces ALL additional mounts to read-only for non-main groups, ignoring per-root `allowReadWrite` settings. Set to `false` if any non-main group needs write access. Currently set to `false`.
- **Google Workspace MCP needs writable credentials dir**: The `workspace-mcp` Python package performs an eager write permission check (`.permission_test`) on its credentials directory at startup. If the mount is read-only, the MCP server crashes before registering tools — the agent silently loses all `mcp__google-workspace__*` tools with no error in the agent-runner logs.
- **`groups/{name}/.mcp.json` is gitignored runtime config**: Changes made in a git worktree are lost when the worktree is removed. Must manually recreate/edit these files on the main worktree after merging.

### WhatsApp & Messages
- **Message timestamps must be local time (no Z suffix)**: `whatsapp.ts` must format timestamps as local time (`YYYY-MM-DDTHH:MM:SS`) not UTC (`toISOString()` with Z). The message loop uses string comparison for its cursor, and UTC timestamps appear "older" than local ones, causing all messages to be silently skipped. The skill engine's three-way merge can revert this if the upstream base uses `toISOString()`.
- **Must `normalizeMessageContent()` before reading message fields**: WhatsApp wraps voice (listen-once), images (view-once), ephemeral, and edited messages in container types (`viewOnceMessageV2`, `ephemeralMessage`, `editedMessage`, etc.). Always call Baileys' `normalizeMessageContent(msg.message)` before checking `audioMessage`, `imageMessage`, `documentMessage`, or text fields — otherwise wrapped messages are silently dropped with zero errors.
- **Date/time context must be injected for ALL agent prompts**: `index.ts` `datePrefix()` prepends `[Current date and time: ...]` with day-of-week to every prompt. LLMs cannot reliably calculate day-of-week from ISO timestamps.

### Voice Transcription
- **whisper-cpp binary name**: Homebrew package is `whisper-cpp`, but the CLI binary is `whisper-cli`
- **Whisper `-l auto` for multilingual users**: whisper-cli defaults to `-l en` (English). Spanish voice notes get transcribed as "(speaking in foreign language)". Use `-l auto` for auto-detection.
- **Agent cannot diagnose host-side issues**: The container agent can't see host binaries (whisper-cli, ffmpeg). Transcription runs on the HOST in `whatsapp.ts`, not in the container.

### Apple Reminders
- **JXA/osascript is extremely slow**: Apple Event IPC overhead makes batch property access take 23-50s for 255 items. The `tools/reminders-cli/` Swift EventKit CLI bypasses Apple Events entirely (~0.6s). Rebuild with `tools/reminders-cli/build.sh` (requires macOS + Xcode CLT).

### Skills Engine
- **Skills engine init**: `apply-skill.ts` doesn't support `--init` flag. Initialize with: `npx tsx -e "import { initNanoclawDir } from './skills-engine/init.ts'; initNanoclawDir();"`
- **Modify templates must match live files**: When multiple skills modify the same file, ALL modify templates should be identical copies of the live file. This prevents three-way merge conflicts in CI combination tests. See PR #23.

## Git Remotes & Workflow

Three remotes, each with a specific purpose:

| Remote | Repo | Visibility | Purpose |
|--------|------|------------|---------|
| `origin` | `qwibitai/nanoclaw` | Public | Upstream — fetch updates |
| `private` | `glifocat/nanoclaw-personal` | **Private** | Daily work, backup, PRs to self |
| `fork` | `glifocat/nanoclaw` | Public | Contribution PRs to upstream only |

- `main` tracks `private/main` — `git push` without args goes to the private repo
- **Always use feature branches + PRs**, even on private repo (user preference)
- Sync upstream: `git fetch origin && git merge origin/main` (on a feature branch, then PR)
- Sync public fork: `git push --no-verify fork origin/main:main` (only upstream code, never personal)
- **Default remote is always `private`** unless user explicitly says otherwise

## Update Strategy

**Do NOT use the `/update` skill (skills engine update-core.ts).** It does file-level replacement, which overwrites local customizations.

**Instead, use git merge:**
1. Create a feature branch: `git checkout -b update/upstream-sync`
2. `git fetch origin && git merge origin/main`
3. Resolve any conflicts (usually few — git's 3-way merge preserves additions)
4. PR to private repo as usual

## Security

**Pre-push hook** (`.git/hooks/pre-push`) — three layers, local-only (not tracked in git):
1. **Blocks direct push to main** — forces feature branch + PR workflow
2. **Confirms before push to public fork** — interactive y/N prompt
3. **Scans for secrets/credentials/PII** — API keys, private keys, connection strings, blocked files

Bypass with `--no-verify` only for: syncing upstream → public fork.

## Adding MCP Servers to a Group

Never modify agent-runner code to add MCP servers. Two patterns depending on auth type:

### Pattern A: Secrets via env var interpolation (e.g. API keys)
1. **`.env`** — add secret as `KEY=PLACEHOLDER`
2. **`src/container-runner.ts` → `readSecrets()`** — add key to allowlist array
3. **`container/agent-runner/src/index.ts` → `SECRET_ENV_VARS`** — add key so it's stripped from Bash subprocesses (+ sync to group caches)
4. **`groups/{group}/.mcp.json`** — add MCP server with `${VAR}` interpolation

### Pattern B: Credentials file via mount (e.g. OAuth)
1. **Create credentials dir** on host (e.g. `~/.vanta_mcp/credentials.json`)
2. **`~/.config/nanoclaw/mount-allowlist.json`** — add path to `allowedRoots`
3. **DB `registered_groups`** — add entry to group's `containerConfig.additionalMounts`
4. **`groups/{group}/.mcp.json`** — add MCP server with env pointing to `/workspace/extra/{name}/file`

### Common steps (both patterns)
5. **`allowedTools`** in `container/agent-runner/src/index.ts` — add `'mcp__{server-name}__*'` wildcard
6. **(Optional) Dockerfile** — pre-install npm/python package to avoid first-run latency
7. **Sync agent-runner caches**: `for dir in data/sessions/*/agent-runner-src/; do cp container/agent-runner/src/*.ts "$dir"; done`
8. **Kill running container** — mounts are assigned at spawn time, not hot-reloaded
9. **Restart service** — `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

Reference implementations: Google Workspace + Vanta in `groups/passion/.mcp.json`.

## Checking CI Status

`gh pr checks` fails with "Resource not accessible by personal access token". Use the Actions REST API:

```bash
gh api repos/glifocat/nanoclaw-personal/actions/runs \
  --jq '.workflow_runs[:6] | .[] | {name: .name, status: .status, conclusion: .conclusion, head_sha: .head_sha[:7]}'
```
