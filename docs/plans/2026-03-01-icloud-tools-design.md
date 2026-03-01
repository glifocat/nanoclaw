# iCloud Tools Skill — Design Document

**Date:** 2026-03-01
**Status:** Approved
**Target:** Private repo (`glifocat/nanoclaw-personal`)

## Summary

A single NanoClaw skill (`icloud-tools`) that gives agents access to Apple's productivity apps — Reminders, Calendar, Contacts, Mail, and Notes — via iCloud's standard protocols (CalDAV, CardDAV, IMAP, SMTP) using an app-specific password.

Replaces the current hardcoded Apple Reminders integration (`src/reminders.ts`, `src/reminders-ipc.ts`, and reminders MCP tools in `ipc-mcp-stdio.ts`).

## Why iCloud Protocols Instead of JXA

We evaluated three approaches:

| Approach | Pros | Cons |
|----------|------|------|
| **JXA/osascript via host IPC** | Full feature access, works offline | macOS-only, JXA abandoned since ~2016, requires IPC bridge, ~600ms latency per call |
| **CLI wrappers (remindctl, memo)** | Structured output, maintained by others | Homebrew dependencies, only covers Reminders + Notes |
| **iCloud protocols (CalDAV/CardDAV/IMAP)** | Runs inside container, no IPC needed, standard protocols, Apple-maintained servers | Needs internet, Notes is read-only, requires app-specific password setup |

**Decision:** iCloud protocols. The MCP server runs directly inside the container — no host-side code, no IPC bridge, no osascript. Authentication uses a single app-specific password generated at appleid.apple.com.

A future `apple-tools` skill using local JXA/Shortcuts could supplement this for offline usage or full Notes support (rich text, attachments).

## Architecture

```
┌──────────────────────────────────────────────────┐
│ Container (Linux VM)                             │
│                                                  │
│  agent-runner                                    │
│    └─ .mcp.json registers icloud-tools server    │
│                                                  │
│  icloud-tools MCP server (stdio)                 │
│    ├─ tsdav client (CalDAV/CardDAV)              │
│    │   ├─ Reminders (VTODO)                      │
│    │   ├─ Calendar (VEVENT)                      │
│    │   └─ Contacts (vCard)                       │
│    ├─ imapflow client (IMAP)                     │
│    │   ├─ Mail (read, organize)                  │
│    │   └─ Notes (read-only)                      │
│    └─ nodemailer (SMTP)                          │
│        └─ Mail (send, reply, forward)            │
│                                                  │
│  Auth: ICLOUD_EMAIL + ICLOUD_APP_PASSWORD        │
│  Modules: ICLOUD_MODULES env var                 │
└──────────────────────────────────────────────────┘
          │
          │ CalDAV / CardDAV / IMAP / SMTP
          │ (standard protocols over TLS)
          ▼
┌──────────────────────────────────────────────────┐
│ iCloud servers                                   │
│  caldav.icloud.com     (Calendar + Reminders)    │
│  contacts.icloud.com   (Contacts)                │
│  imap.mail.me.com:993  (Mail read + Notes)       │
│  smtp.mail.me.com:587  (Mail send)               │
└──────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Single MCP server process** — shares one `tsdav` connection (CalDAV + CardDAV) and one `imapflow` connection (IMAP + Notes). 2 connections instead of 5.
2. **Module selector via `ICLOUD_MODULES` env var** — controls which tools register. Each group's `.mcp.json` can enable a different subset.
3. **Skill install prompts which modules to enable** — the SKILL.md asks during installation.
4. **Replaces hardcoded Reminders** — removes `src/reminders.ts`, `src/reminders-ipc.ts`, and reminders tool definitions from `ipc-mcp-stdio.ts`.

## Skill Package Structure

```
.claude/skills/icloud-tools/
  SKILL.md                          # Install instructions + module selector
  manifest.yaml                     # Skill metadata, dependencies
  add/
    container/icloud-tools/
      package.json                  # tsdav, imapflow, nodemailer, @modelcontextprotocol/sdk
      src/
        server.ts                   # MCP server entry point, module loader
        auth.ts                     # Shared iCloud authentication
        modules/
          reminders.ts              # CalDAV VTODO operations
          calendar.ts               # CalDAV VEVENT operations
          contacts.ts               # CardDAV vCard operations
          mail.ts                   # IMAP + SMTP operations
          notes.ts                  # IMAP Notes folder (read-only)
      tsconfig.json
  modify/
    container/agent-runner/src/
      index.ts                      # Add icloud tool wildcards to allowedTools
      index.ts.intent.md
  remove/
    src/reminders.ts                # Remove hardcoded Reminders
    src/reminders-ipc.ts            # Remove hardcoded IPC handler
  tests/
    icloud-tools.test.ts            # Skill package validation tests
```

## Tool Definitions (31 total)

### Reminders — 7 tools (CalDAV VTODO)

| Tool | Parameters | Returns |
|------|-----------|---------|
| `icloud_reminders_list_lists` | — | `{name, itemCount}[]` |
| `icloud_reminders_list_items` | `list_name`, `include_completed?` | `{id, title, completed, dueDate, notes}[]` |
| `icloud_reminders_add_item` | `list_name`, `title`, `notes?`, `due_date?` | `{success, id}` |
| `icloud_reminders_update_item` | `id`, `title?`, `notes?`, `due_date?` | `{success}` |
| `icloud_reminders_complete_item` | `id` | `{success}` |
| `icloud_reminders_remove_item` | `id` | `{success}` |
| `icloud_reminders_move_item` | `id`, `target_list` | `{success}` |

### Calendar — 6 tools (CalDAV VEVENT)

| Tool | Parameters | Returns |
|------|-----------|---------|
| `icloud_calendar_list_calendars` | — | `{name, color, editable}[]` |
| `icloud_calendar_list_events` | `calendar?`, `start_date`, `end_date` | `{id, title, start, end, location, allDay}[]` |
| `icloud_calendar_list_upcoming` | `count?` (default 10) | `{id, title, start, end, location, calendar}[]` |
| `icloud_calendar_create_event` | `calendar`, `title`, `start`, `end`, `location?`, `description?` | `{success, id}` |
| `icloud_calendar_update_event` | `id`, `title?`, `start?`, `end?`, `location?`, `description?` | `{success}` |
| `icloud_calendar_delete_event` | `id` | `{success}` |

### Contacts — 4 tools (CardDAV vCard)

| Tool | Parameters | Returns |
|------|-----------|---------|
| `icloud_contacts_search` | `query` | `{id, name, phones, emails, organization}[]` |
| `icloud_contacts_list_groups` | — | `{name, memberCount}[]` |
| `icloud_contacts_create` | `first_name`, `last_name?`, `phone?`, `email?`, `organization?` | `{success, id}` |
| `icloud_contacts_update` | `id`, `phone?`, `email?`, `organization?`, `notes?` | `{success}` |

### Mail — 12 tools (IMAP + SMTP)

| Tool | Parameters | Returns |
|------|-----------|---------|
| `icloud_mail_list_folders` | — | `{name, path, messageCount, unread}[]` |
| `icloud_mail_list_messages` | `folder?`, `limit?` | `{id, subject, sender, date, read, flagged}[]` |
| `icloud_mail_read_message` | `id` | `{subject, sender, to, cc, date, body}` |
| `icloud_mail_send` | `to`, `subject`, `body`, `cc?`, `bcc?` | `{success, messageId}` |
| `icloud_mail_reply` | `id`, `body`, `reply_all?` | `{success, messageId}` |
| `icloud_mail_forward` | `id`, `to`, `body?` | `{success, messageId}` |
| `icloud_mail_search` | `query`, `folder?` | `{id, subject, sender, date}[]` |
| `icloud_mail_create_draft` | `to`, `subject`, `body`, `cc?`, `bcc?` | `{success, id}` |
| `icloud_mail_update_draft` | `id`, `to?`, `subject?`, `body?` | `{success, id}` |
| `icloud_mail_flag` | `id`, `flagged` (bool) | `{success}` |
| `icloud_mail_mark_read` | `id`, `read` (bool) | `{success}` |
| `icloud_mail_move` | `id`, `target_folder` | `{success}` |

### Notes — 2 tools (IMAP Notes folder)

| Tool | Parameters | Returns |
|------|-----------|---------|
| `icloud_notes_list` | `folder?` | `{id, title, date, snippet}[]` |
| `icloud_notes_read` | `id` | `{title, date, body}` |

Notes is intentionally read-only. IMAP Notes access is plain text only — no rich text, no attachments. Full Notes support would require a local `apple-tools` skill using JXA/Shortcuts.

## Authentication Flow

1. User generates an app-specific password at appleid.apple.com → Sign-In & Security → App-Specific Passwords
2. Add to `.env`:
   ```
   ICLOUD_EMAIL=user@icloud.com
   ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```
3. `src/container-runner.ts` → `readSecrets()` — add both keys to allowlist
4. `container/agent-runner/src/index.ts` → `SECRET_ENV_VARS` — strip from Bash subprocesses
5. `groups/{name}/.mcp.json` — MCP server entry with `${ICLOUD_EMAIL}` and `${ICLOUD_APP_PASSWORD}` interpolation

This follows **Pattern A** (secrets via env var interpolation) from the existing MCP integration patterns.

## Per-Group Configuration

Each group's `.mcp.json`:

```json
{
  "mcpServers": {
    "icloud-tools": {
      "command": "node",
      "args": ["/workspace/icloud-tools/dist/server.js"],
      "env": {
        "ICLOUD_EMAIL": "${ICLOUD_EMAIL}",
        "ICLOUD_APP_PASSWORD": "${ICLOUD_APP_PASSWORD}",
        "ICLOUD_MODULES": "reminders,calendar,contacts,mail,notes"
      }
    }
  }
}
```

Customize `ICLOUD_MODULES` per group:
- Family group: `"reminders,calendar"`
- Work group: `"mail,contacts,calendar"`
- Main group: `"reminders,calendar,contacts,mail,notes"` (all)

## Dependencies

### npm packages (installed in container via Dockerfile)

| Package | Version | Purpose |
|---------|---------|---------|
| `tsdav` | latest | CalDAV/CardDAV client (Reminders, Calendar, Contacts) |
| `imapflow` | latest | IMAP client (Mail read, Notes) |
| `nodemailer` | latest | SMTP client (Mail send, reply, forward) |
| `@modelcontextprotocol/sdk` | latest | MCP server framework |
| `ical.js` | latest | iCalendar parsing (VTODO, VEVENT) |
| `vcard4` or similar | latest | vCard parsing (contacts) |

### iCloud Endpoints

| Service | Protocol | Host | Port |
|---------|----------|------|------|
| Calendar + Reminders | CalDAV | caldav.icloud.com | 443 |
| Contacts | CardDAV | contacts.icloud.com | 443 |
| Mail (read) | IMAP | imap.mail.me.com | 993 |
| Mail (send) | SMTP | smtp.mail.me.com | 587 |

## Migration: Removing Hardcoded Reminders

### Files to remove
- `src/reminders.ts` — JXA functions
- `src/reminders-ipc.ts` — IPC handler

### Files to modify
- `src/ipc.ts` — remove `handleRemindersIpc` import and routing
- `container/agent-runner/src/ipc-mcp-stdio.ts` — remove reminders MCP tool definitions (lines ~283-441)
- `container/agent-runner/src/index.ts` — update `allowedTools` to replace `mcp__nanoclaw__reminders_*` with `mcp__icloud-tools__*`

### Files to remove from tests
- `src/reminders.test.ts` — JXA unit tests (replaced by icloud-tools tests)

## Limitations

1. **Notes is read-only** — IMAP Notes access is plain text only, no create/edit/rich text
2. **Requires internet** — all operations go through iCloud servers
3. **App-specific password is account-wide** — grants access to all services; cannot scope to just Calendar
4. **iCloud rate limits** — undocumented, but aggressive bulk operations may be throttled
5. **Recurring events** — CalDAV recurrence uses RRULE strings, complex to parse/generate
6. **IMAP draft updates** — IMAP doesn't support in-place edits; update = delete old + append new
7. **Contact photo sync** — vCard photos are large binary blobs; excluded from search results

## Future Extensions

- **Local `apple-tools` skill** — JXA/Shortcuts for offline access and full Notes support
- **Google Workspace parity** — existing Google Workspace MCP already covers Calendar, Gmail, Contacts via Google APIs
- **Unified productivity interface** — wrapper skill that routes to iCloud or Google based on user preference
