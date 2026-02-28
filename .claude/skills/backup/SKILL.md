---
name: backup
description: Backup NanoClaw state to a local or NAS destination. Backs up WhatsApp session, databases, group memory, secrets, and external credentials. Stops service briefly for database consistency. Triggers on "backup", "back up nanoclaw", "save state".
---

# NanoClaw Backup

Back up all NanoClaw state to a local filesystem path (NAS, external drive, mounted share).

## Phase 1: Determine Destination

If the user provided a destination path as an argument (e.g., `/backup /Volumes/NAS/backups/nanoclaw`), use that.

Otherwise, ask:

```
AskUserQuestion: "Where should the backup be saved?"
Options:
  - /Volumes/ path (NAS or external drive)
  - Other (custom path)
```

### Validate the destination

```bash
# Check path exists and is writable
test -d "<DEST>" && test -w "<DEST>" && echo "OK" || echo "FAIL"
```

If the path doesn't exist, ask the user if they want to create it:
```bash
mkdir -p "<DEST>"
```

## Phase 2: Stop Service

Stop NanoClaw for a consistent database snapshot:

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```

Wait briefly and confirm it's stopped:
```bash
launchctl print gui/$(id -u)/com.nanoclaw 2>&1 | grep -q "state = not running" && echo "Stopped" || echo "Still running"
```

**IMPORTANT:** Always restart the service in Phase 4, even if rsync fails. Do not leave the service down.

## Phase 3: Copy State

**macOS note:** The system `rsync` (`openrsync`) has bugs with extended attributes that cause I/O errors (exit status 11). Use `cp -a` instead, which handles macOS attributes natively. For subsequent backups, remove the destination subdirectory first to mirror deletions, then copy fresh.

If GNU rsync is available (`brew install rsync`), you can use `rsync -av --delete` instead of the `rm + cp` pattern below.

Set `NC_DIR` to the NanoClaw project root and `DEST` to the backup destination.

```bash
NC_DIR="$HOME/personal-projects/nanoclaw"
DEST="<DESTINATION_PATH>"
```

### Critical state (cannot be recreated)

```bash
# WhatsApp session and auth keys
rm -rf "$DEST/store" && cp -a "$NC_DIR/store" "$DEST/store"

# Databases, agent sessions, IPC
rm -rf "$DEST/data" && cp -a "$NC_DIR/data" "$DEST/data"

# Group memory, CLAUDE.md files, MCP configs
rm -rf "$DEST/groups" && cp -a "$NC_DIR/groups" "$DEST/groups"

# Secrets
cp -a "$NC_DIR/.env" "$DEST/dot-env"

# Project-level MCP config
cp -a "$NC_DIR/.mcp.json" "$DEST/dot-mcp.json"
```

### Skills and configuration state

```bash
# Skills engine state
rm -rf "$DEST/dot-nanoclaw" && cp -a "$NC_DIR/.nanoclaw" "$DEST/dot-nanoclaw"

# NanoClaw configuration (mount allowlist)
mkdir -p "$DEST/config-nanoclaw" && cp -a "$HOME/.config/nanoclaw/." "$DEST/config-nanoclaw/"

# Service definition
cp "$HOME/Library/LaunchAgents/com.nanoclaw.plist" "$DEST/com.nanoclaw.plist"
```

### External MCP credentials

Only copy these if they exist — not all installations have them:

```bash
# Google Workspace OAuth tokens
[ -d "$HOME/.google_workspace_mcp" ] && rm -rf "$DEST/google-workspace-mcp" && cp -a "$HOME/.google_workspace_mcp" "$DEST/google-workspace-mcp"

# Vanta MCP credentials
[ -d "$HOME/.vanta_mcp" ] && rm -rf "$DEST/vanta-mcp" && cp -a "$HOME/.vanta_mcp" "$DEST/vanta-mcp"
```

### Logs (nice to have)

```bash
rm -rf "$DEST/logs" && cp -a "$NC_DIR/logs" "$DEST/logs"
```

## Phase 4: Restart Service

**Always run this step**, even if Phase 3 had errors:

```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

Wait for startup and verify:
```bash
sleep 3
tail -5 "$NC_DIR/logs/nanoclaw.log"
```

Look for `NanoClaw running` in the output.

## Phase 5: Report

Show the user a summary:

```bash
du -sh "$DEST"/*
echo "---"
echo "Total:"
du -sh "$DEST"
```

Report:
- Total backup size
- Timestamp
- Any errors from Phase 3
- Confirmation that service is back up

## What Is NOT Backed Up

| Excluded | Reason |
|----------|--------|
| Source code (`src/`, `container/`, etc.) | In git — `git clone` from `private` remote |
| `node_modules/` | `npm install` regenerates |
| `dist/` | `npm run build` regenerates |
| Container images | `./container/build.sh` rebuilds |

## Restoring From Backup

To restore on the same or a new machine:

1. Clone the repo: `git clone <private-remote> nanoclaw`
2. `cd nanoclaw && npm install && npm run build`
3. Copy state back:
   ```bash
   BACKUP="/Volumes/NAS/backups/nanoclaw"
   NC_DIR="$HOME/personal-projects/nanoclaw"

   cp -a "$BACKUP/store" "$NC_DIR/store"
   cp -a "$BACKUP/data" "$NC_DIR/data"
   cp -a "$BACKUP/groups" "$NC_DIR/groups"
   cp "$BACKUP/dot-env" "$NC_DIR/.env"
   cp "$BACKUP/dot-mcp.json" "$NC_DIR/.mcp.json"
   cp -a "$BACKUP/dot-nanoclaw" "$NC_DIR/.nanoclaw"
   mkdir -p "$HOME/.config/nanoclaw" && cp -a "$BACKUP/config-nanoclaw/." "$HOME/.config/nanoclaw/"
   cp "$BACKUP/com.nanoclaw.plist" "$HOME/Library/LaunchAgents/"

   # External credentials (if they exist in backup)
   [ -d "$BACKUP/google-workspace-mcp" ] && cp -a "$BACKUP/google-workspace-mcp" "$HOME/.google_workspace_mcp"
   [ -d "$BACKUP/vanta-mcp" ] && cp -a "$BACKUP/vanta-mcp" "$HOME/.vanta_mcp"
   ```
4. Rebuild container: `./container/build.sh`
5. Start: `launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist`

## Troubleshooting

### "Permission denied" on NAS path
- Check the NAS share is mounted: `mount | grep Volumes`
- Check write permissions: `touch <DEST>/test && rm <DEST>/test`
- Some NAS shares require SMB credentials — mount via Finder first

### Service didn't restart
- Check manually: `launchctl print gui/$(id -u)/com.nanoclaw`
- Force start: `launchctl kickstart gui/$(id -u)/com.nanoclaw`
- Check error log: `tail -20 logs/nanoclaw.error.log`

### macOS rsync errors (exit status 11)
- macOS ships `openrsync` which has bugs with extended attributes. The skill uses `cp -a` instead.
- If you prefer rsync (e.g., for NAS destinations where `cp` is slow), install GNU rsync: `brew install rsync`
- After installing, `/opt/homebrew/bin/rsync` is the GNU version. The skill can then use `rsync -av --delete` directly.

### Backup is very large
- `data/sessions/` contains per-group agent-runner caches (~50MB each). These are regenerable but included for convenience.
- `store/auth/` grows over time with WhatsApp pre-keys. This is normal.
- `logs/` can be excluded if space is tight — they're not critical for restoration.
