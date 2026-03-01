---
name: icloud-tools
description: iCloud productivity tools (Reminders, Calendar, Contacts, Mail, Notes) via CalDAV/CardDAV/IMAP/SMTP protocols.
---

# iCloud Tools Skill

Gives NanoClaw agents access to Apple's productivity apps via iCloud's standard protocols using an app-specific password. Replaces the old JXA-based Apple Reminders integration.

## Phase 1: Pre-flight

1. Generate an app-specific password at [appleid.apple.com](https://appleid.apple.com) -> Sign-In & Security -> App-Specific Passwords
2. Add credentials to `.env`:
   ```
   ICLOUD_EMAIL=user@icloud.com
   ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```

## Phase 2: Choose Modules

Available modules (set via `ICLOUD_MODULES` env var):

| Module | Protocol | Tools | Description |
|--------|----------|-------|-------------|
| `reminders` | CalDAV | 7 | Lists, items, CRUD, move between lists |
| `calendar` | CalDAV | 6 | Calendars, events, upcoming, CRUD |
| `contacts` | CardDAV | 4 | Search, groups, create, update |
| `mail` | IMAP/SMTP | 12 | Folders, read, send, reply, forward, drafts, flag, move |
| `notes` | IMAP | 2 | List and read notes (read-only) |

Examples:
- Family group: `reminders,calendar`
- Work group: `mail,contacts,calendar`
- All modules: `reminders,calendar,contacts,mail,notes`

## Phase 3: Configure Group

Add to the target group's `.mcp.json` (merge with existing entries):

```json
{
  "mcpServers": {
    "icloud-tools": {
      "command": "node",
      "args": ["/opt/icloud-tools/dist/server.js"],
      "env": {
        "ICLOUD_EMAIL": "${ICLOUD_EMAIL}",
        "ICLOUD_APP_PASSWORD": "${ICLOUD_APP_PASSWORD}",
        "ICLOUD_MODULES": "reminders,calendar,contacts,mail,notes"
      }
    }
  }
}
```

Customize `ICLOUD_MODULES` per group as needed.

## Phase 4: Rebuild + Restart

1. Rebuild container: `cd container && ./build.sh`
2. Kill running containers: `container stop nanoclaw-{group}-*`
3. Restart service: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

## Phase 5: Verify

Send a test message to the group, e.g., "List my reminder lists" or "What's on my calendar this week?"
