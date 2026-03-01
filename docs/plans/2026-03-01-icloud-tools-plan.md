# iCloud Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that gives NanoClaw agents access to iCloud Reminders, Calendar, Contacts, Mail, and Notes via standard protocols (CalDAV/CardDAV/IMAP/SMTP), replacing the hardcoded JXA-based Reminders integration.

**Architecture:** A standalone Node.js MCP server (`container/icloud-tools/`) runs inside each agent container. It connects directly to iCloud servers using an app-specific password — no host-side code or IPC bridge needed. Modules are selectable per-group via `ICLOUD_MODULES` env var.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (MCP server), `tsdav` (CalDAV/CardDAV), `imapflow` (IMAP), `nodemailer` (SMTP), `ical.js` (iCal parsing), `zod` (schema validation), `vitest` (testing)

---

## Task 1: Scaffold icloud-tools MCP Server Project

**Files:**
- Create: `container/icloud-tools/package.json`
- Create: `container/icloud-tools/tsconfig.json`
- Create: `container/icloud-tools/vitest.config.ts`
- Create: `container/icloud-tools/src/types.ts`

**Step 1: Create directory structure**

Run: `mkdir -p container/icloud-tools/src/{modules,__tests__}`

**Step 2: Create `container/icloud-tools/package.json`**

```json
{
  "name": "icloud-tools",
  "version": "1.0.0",
  "type": "module",
  "description": "iCloud MCP server for NanoClaw agents",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "tsdav": "^7.1.3",
    "imapflow": "^1.0.171",
    "nodemailer": "^6.10.1",
    "ical.js": "^2.1.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/nodemailer": "^6.4.17",
    "@types/node": "^22.10.7",
    "typescript": "^5.7.3",
    "vitest": "^4.0.18"
  }
}
```

**Step 3: Create `container/icloud-tools/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

**Step 4: Create `container/icloud-tools/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

**Step 5: Create shared types at `container/icloud-tools/src/types.ts`**

```ts
/** Helper to build MCP text content response */
export function ok<T>(data: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, data }) }],
  };
}

export function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}
```

**Step 6: Install dependencies**

Run: `cd container/icloud-tools && npm install`

**Step 7: Commit**

```bash
git add container/icloud-tools/
git commit -m "feat(icloud-tools): scaffold MCP server project"
```

---

## Task 2: Auth Module (TDD)

**Files:**
- Test: `container/icloud-tools/src/__tests__/auth.test.ts`
- Create: `container/icloud-tools/src/auth.ts`

The auth module provides lazy-initialized clients for each iCloud protocol. Connections are only created when first used, so groups with `ICLOUD_MODULES=reminders` never open IMAP.

**Step 1: Write the failing test**

Create `container/icloud-tools/src/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tsdav', () => ({
  DAVClient: vi.fn().mockImplementation(() => ({
    login: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn().mockReturnValue({ verify: vi.fn() }),
}));

describe('auth', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ICLOUD_EMAIL = 'test@icloud.com';
    process.env.ICLOUD_APP_PASSWORD = 'xxxx-xxxx-xxxx-xxxx';
  });

  it('creates CalDAV client with correct iCloud endpoint', async () => {
    const { DAVClient } = await import('tsdav');
    const { getCaldavClient } = await import('../auth.js');

    const client = await getCaldavClient();
    expect(DAVClient).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: 'https://caldav.icloud.com',
        credentials: { username: 'test@icloud.com', password: 'xxxx-xxxx-xxxx-xxxx' },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      }),
    );
    expect(client.login).toHaveBeenCalled();
  });

  it('reuses CalDAV client on second call (singleton)', async () => {
    const { DAVClient } = await import('tsdav');
    const { getCaldavClient } = await import('../auth.js');

    const client1 = await getCaldavClient();
    const client2 = await getCaldavClient();
    expect(client1).toBe(client2);
    expect(DAVClient).toHaveBeenCalledTimes(1);
  });

  it('creates CardDAV client with contacts endpoint', async () => {
    const { DAVClient } = await import('tsdav');
    const { getCarddavClient } = await import('../auth.js');

    await getCarddavClient();
    expect(DAVClient).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: 'https://contacts.icloud.com',
        defaultAccountType: 'carddav',
      }),
    );
  });

  it('creates IMAP client with iCloud mail endpoint', async () => {
    const { ImapFlow } = await import('imapflow');
    const { getImapClient } = await import('../auth.js');

    await getImapClient();
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'imap.mail.me.com',
        port: 993,
        secure: true,
      }),
    );
  });

  it('creates SMTP transport with iCloud SMTP endpoint', async () => {
    const { createTransport } = await import('nodemailer');
    const { getSmtpTransport } = await import('../auth.js');

    getSmtpTransport();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.mail.me.com',
        port: 587,
        secure: false,
      }),
    );
  });

  it('throws if ICLOUD_EMAIL is not set', async () => {
    delete process.env.ICLOUD_EMAIL;
    const { getCaldavClient } = await import('../auth.js');
    await expect(getCaldavClient()).rejects.toThrow('ICLOUD_EMAIL');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/auth.test.ts`
Expected: FAIL — `../auth.js` does not exist

**Step 3: Write implementation**

Create `container/icloud-tools/src/auth.ts`:

```ts
import { DAVClient } from 'tsdav';
import { ImapFlow } from 'imapflow';
import { createTransport, type Transporter } from 'nodemailer';

let caldavClient: DAVClient | null = null;
let carddavClient: DAVClient | null = null;
let imapClient: ImapFlow | null = null;
let smtpTransport: Transporter | null = null;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Required environment variable ${name} is not set`);
  return val;
}

function getCredentials() {
  return {
    username: requireEnv('ICLOUD_EMAIL'),
    password: requireEnv('ICLOUD_APP_PASSWORD'),
  };
}

export async function getCaldavClient(): Promise<DAVClient> {
  if (!caldavClient) {
    const creds = getCredentials();
    caldavClient = new DAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: creds,
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    await caldavClient.login();
  }
  return caldavClient;
}

export async function getCarddavClient(): Promise<DAVClient> {
  if (!carddavClient) {
    const creds = getCredentials();
    carddavClient = new DAVClient({
      serverUrl: 'https://contacts.icloud.com',
      credentials: creds,
      authMethod: 'Basic',
      defaultAccountType: 'carddav',
    });
    await carddavClient.login();
  }
  return carddavClient;
}

export async function getImapClient(): Promise<ImapFlow> {
  if (!imapClient) {
    const creds = getCredentials();
    imapClient = new ImapFlow({
      host: 'imap.mail.me.com',
      port: 993,
      secure: true,
      auth: { user: creds.username, pass: creds.password },
      logger: false,
    });
    await imapClient.connect();
  }
  return imapClient;
}

export function getSmtpTransport(): Transporter {
  if (!smtpTransport) {
    const creds = getCredentials();
    smtpTransport = createTransport({
      host: 'smtp.mail.me.com',
      port: 587,
      secure: false,
      auth: { user: creds.username, pass: creds.password },
    });
  }
  return smtpTransport;
}

/** Gracefully close all open connections */
export async function closeAll(): Promise<void> {
  if (imapClient) {
    await imapClient.logout().catch(() => {});
    imapClient = null;
  }
  if (smtpTransport) {
    smtpTransport.close();
    smtpTransport = null;
  }
  caldavClient = null;
  carddavClient = null;
}
```

**Step 4: Run test to verify it passes**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/auth.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add container/icloud-tools/src/auth.ts container/icloud-tools/src/__tests__/auth.test.ts
git commit -m "feat(icloud-tools): add auth module with lazy client initialization"
```

---

## Task 3: MCP Server Entry Point + Module Loader (TDD)

**Files:**
- Test: `container/icloud-tools/src/__tests__/server.test.ts`
- Create: `container/icloud-tools/src/server.ts`

**Step 1: Write the failing test**

Create `container/icloud-tools/src/__tests__/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('module loader', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ICLOUD_EMAIL = 'test@icloud.com';
    process.env.ICLOUD_APP_PASSWORD = 'xxxx-xxxx-xxxx-xxxx';
  });

  it('parses ICLOUD_MODULES comma-separated list', async () => {
    process.env.ICLOUD_MODULES = 'reminders,calendar';
    const { parseModules } = await import('../server.js');
    expect(parseModules()).toEqual(['reminders', 'calendar']);
  });

  it('returns empty array when ICLOUD_MODULES is unset', async () => {
    delete process.env.ICLOUD_MODULES;
    const { parseModules } = await import('../server.js');
    expect(parseModules()).toEqual([]);
  });

  it('ignores whitespace and empty segments', async () => {
    process.env.ICLOUD_MODULES = ' reminders , , calendar ';
    const { parseModules } = await import('../server.js');
    expect(parseModules()).toEqual(['reminders', 'calendar']);
  });

  it('rejects unknown module names', async () => {
    process.env.ICLOUD_MODULES = 'reminders,bogus';
    const { parseModules } = await import('../server.js');
    expect(() => parseModules()).toThrow('Unknown module: bogus');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/server.test.ts`
Expected: FAIL — `../server.js` does not exist

**Step 3: Write implementation**

Create `container/icloud-tools/src/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeAll } from './auth.js';

const VALID_MODULES = ['reminders', 'calendar', 'contacts', 'mail', 'notes'] as const;
type ModuleName = (typeof VALID_MODULES)[number];

export function parseModules(): ModuleName[] {
  const raw = process.env.ICLOUD_MODULES ?? '';
  const names = raw.split(',').map(s => s.trim()).filter(Boolean);
  for (const name of names) {
    if (!VALID_MODULES.includes(name as ModuleName)) {
      throw new Error(`Unknown module: ${name}. Valid modules: ${VALID_MODULES.join(', ')}`);
    }
  }
  return names as ModuleName[];
}

const MODULE_LOADERS: Record<ModuleName, (server: McpServer) => Promise<void>> = {
  reminders: async (server) => {
    const { registerReminders } = await import('./modules/reminders.js');
    registerReminders(server);
  },
  calendar: async (server) => {
    const { registerCalendar } = await import('./modules/calendar.js');
    registerCalendar(server);
  },
  contacts: async (server) => {
    const { registerContacts } = await import('./modules/contacts.js');
    registerContacts(server);
  },
  mail: async (server) => {
    const { registerMail } = await import('./modules/mail.js');
    registerMail(server);
  },
  notes: async (server) => {
    const { registerNotes } = await import('./modules/notes.js');
    registerNotes(server);
  },
};

async function main() {
  const modules = parseModules();
  if (modules.length === 0) {
    console.error('Warning: ICLOUD_MODULES is empty — no tools will be registered');
  }

  const server = new McpServer({
    name: 'icloud-tools',
    version: '1.0.0',
  });

  for (const mod of modules) {
    await MODULE_LOADERS[mod](server);
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await closeAll();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await closeAll();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('icloud-tools server failed to start:', err);
  process.exit(1);
});
```

**Step 4: Run test to verify it passes**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/server.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add container/icloud-tools/src/server.ts container/icloud-tools/src/__tests__/server.test.ts
git commit -m "feat(icloud-tools): add MCP server entry point with module loader"
```

---

## Task 4: Reminders Module (TDD)

**Files:**
- Test: `container/icloud-tools/src/__tests__/reminders.test.ts`
- Create: `container/icloud-tools/src/modules/reminders.ts`

This establishes the CalDAV + iCal pattern reused by calendar. 7 tools.

**Step 1: Write the failing test**

Create `container/icloud-tools/src/__tests__/reminders.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  login: vi.fn(),
  fetchCalendars: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  createCalendarObject: vi.fn(),
  updateCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
};

vi.mock('../auth.js', () => ({
  getCaldavClient: vi.fn().mockResolvedValue(mockClient),
}));

const vtodoIcal = (uid: string, summary: string, status: string, due?: string, notes?: string) => {
  let ical = `BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nSTATUS:${status}\r\n`;
  if (due) ical += `DUE:${due}\r\n`;
  if (notes) ical += `DESCRIPTION:${notes}\r\n`;
  ical += `END:VTODO\r\nEND:VCALENDAR`;
  return ical;
};

import {
  handleListLists,
  handleListItems,
  handleAddItem,
  handleCompleteItem,
  handleRemoveItem,
} from '../modules/reminders.js';

describe('reminders module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.fetchCalendars.mockResolvedValue([
      { displayName: 'Groceries', url: '/cal/1/', components: ['VTODO'] },
      { displayName: 'Work', url: '/cal/2/', components: ['VTODO'] },
      { displayName: 'Personal Calendar', url: '/cal/3/', components: ['VEVENT'] },
    ]);
  });

  describe('list_lists', () => {
    it('returns only VTODO calendars with item counts', async () => {
      mockClient.fetchCalendarObjects
        .mockResolvedValueOnce([{ data: vtodoIcal('1', 'Milk', 'NEEDS-ACTION') }])
        .mockResolvedValueOnce([]);

      const result = await handleListLists();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0]).toEqual({ name: 'Groceries', itemCount: 1 });
      expect(data.data[1]).toEqual({ name: 'Work', itemCount: 0 });
    });
  });

  describe('list_items', () => {
    it('returns incomplete items by default', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: vtodoIcal('1', 'Milk', 'NEEDS-ACTION', '20260315T120000Z', 'Whole milk'), url: '/cal/1/1.ics', etag: '"e1"' },
        { data: vtodoIcal('2', 'Eggs', 'COMPLETED'), url: '/cal/1/2.ics', etag: '"e2"' },
      ]);

      const result = await handleListItems({ list_name: 'Groceries' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe('Milk');
    });

    it('returns error for non-existent list', async () => {
      const result = await handleListItems({ list_name: 'Nonexistent' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  describe('add_item', () => {
    it('creates VTODO with title and optional fields', async () => {
      mockClient.createCalendarObject.mockResolvedValue(undefined);

      const result = await handleAddItem({
        list_name: 'Groceries',
        title: 'Bread',
        notes: 'Sourdough',
        due_date: '2026-03-15T12:00:00Z',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();

      const calArg = mockClient.createCalendarObject.mock.calls[0][0];
      expect(calArg.iCalString).toContain('SUMMARY:Bread');
      expect(calArg.iCalString).toContain('DESCRIPTION:Sourdough');
    });
  });

  describe('complete_item', () => {
    it('sets STATUS to COMPLETED', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: vtodoIcal('uid1', 'Milk', 'NEEDS-ACTION'), url: '/cal/1/uid1.ics', etag: '"e1"' },
      ]);
      mockClient.updateCalendarObject.mockResolvedValue(undefined);

      const result = await handleCompleteItem({ id: 'uid1' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateCalendarObject.mock.calls[0][0];
      expect(updateArg.calendarObject.data).toContain('STATUS:COMPLETED');
    });
  });

  describe('remove_item', () => {
    it('deletes the calendar object', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: vtodoIcal('uid1', 'Milk', 'NEEDS-ACTION'), url: '/cal/1/uid1.ics', etag: '"e1"' },
      ]);
      mockClient.deleteCalendarObject.mockResolvedValue(undefined);

      const result = await handleRemoveItem({ id: 'uid1' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(mockClient.deleteCalendarObject).toHaveBeenCalledWith({
        calendarObject: { url: '/cal/1/uid1.ics', etag: '"e1"' },
      });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/reminders.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `container/icloud-tools/src/modules/reminders.ts`.

Key patterns:
- `getReminderLists()` filters `fetchCalendars()` to only calendars with `VTODO` component
- `parseTodo()` uses `ical.js` to parse VTODO data from raw iCal strings
- `buildVtodoIcal()` generates iCal strings from fields using string templates
- `findTodoById()` scans all lists to locate a todo by UID
- Each handler wraps logic in try/catch, returns `ok(data)` or `err(message)`

The module exports 7 handler functions and `registerReminders(server)`:
- `handleListLists` — fetches all VTODO calendars, counts incomplete items
- `handleListItems` — fetches objects from a named list, parses, filters by completion
- `handleAddItem` — builds VTODO iCal string, calls `createCalendarObject`
- `handleUpdateItem` — finds todo by ID, rebuilds iCal with updated fields
- `handleCompleteItem` — finds todo by ID, sets `STATUS:COMPLETED`
- `handleRemoveItem` — finds todo by ID, calls `deleteCalendarObject`
- `handleMoveItem` — creates in target list + deletes from source (CalDAV has no native move)

`registerReminders(server)` calls `server.tool()` for each handler with zod schemas.

Note: If `ical.js` has ESM import issues, create `container/icloud-tools/src/ical-shim.ts` using `createRequire(import.meta.url)` and import from there instead.

See the design doc's tool definitions table (lines 102-113) for exact parameter names and return shapes.

**Step 4: Run test to verify it passes**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/reminders.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add container/icloud-tools/src/modules/reminders.ts container/icloud-tools/src/__tests__/reminders.test.ts
git commit -m "feat(icloud-tools): add reminders module (7 CalDAV VTODO tools)"
```

---

## Task 5: Calendar Module (TDD)

**Files:**
- Test: `container/icloud-tools/src/__tests__/calendar.test.ts`
- Create: `container/icloud-tools/src/modules/calendar.ts`

Same CalDAV pattern as reminders but uses VEVENT. 6 tools.

**Step 1: Write the failing test**

Create `container/icloud-tools/src/__tests__/calendar.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  login: vi.fn(),
  fetchCalendars: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  createCalendarObject: vi.fn(),
  updateCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
};

vi.mock('../auth.js', () => ({
  getCaldavClient: vi.fn().mockResolvedValue(mockClient),
}));

const veventIcal = (uid: string, summary: string, dtstart: string, dtend: string, location?: string) => {
  let ical = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART:${dtstart}\r\nDTEND:${dtend}\r\n`;
  if (location) ical += `LOCATION:${location}\r\n`;
  ical += `END:VEVENT\r\nEND:VCALENDAR`;
  return ical;
};

import {
  handleListCalendars,
  handleListEvents,
  handleCreateEvent,
} from '../modules/calendar.js';

describe('calendar module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.fetchCalendars.mockResolvedValue([
      { displayName: 'Personal', url: '/cal/1/', components: ['VEVENT'] },
      { displayName: 'Reminders', url: '/cal/2/', components: ['VTODO'] },
    ]);
  });

  describe('list_calendars', () => {
    it('returns only VEVENT calendars', async () => {
      const result = await handleListCalendars();
      const data = JSON.parse(result.content[0].text);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe('Personal');
    });
  });

  describe('list_events', () => {
    it('returns events within date range', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: veventIcal('e1', 'Meeting', '20260315T090000Z', '20260315T100000Z', 'Office'), url: '/cal/1/e1.ics', etag: '"x"' },
      ]);

      const result = await handleListEvents({
        start_date: '2026-03-01T00:00:00Z',
        end_date: '2026-03-31T23:59:59Z',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe('Meeting');
      expect(data.data[0].location).toBe('Office');
    });
  });

  describe('create_event', () => {
    it('creates VEVENT with required fields', async () => {
      mockClient.createCalendarObject.mockResolvedValue(undefined);

      const result = await handleCreateEvent({
        calendar: 'Personal',
        title: 'Lunch',
        start: '2026-03-15T12:00:00Z',
        end: '2026-03-15T13:00:00Z',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/calendar.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `container/icloud-tools/src/modules/calendar.ts`.

Key patterns (mirrors reminders):
- `getEventCalendars()` filters to calendars with `VEVENT` component
- `parseEvent()` uses `ical.js` to parse VEVENT → `{id, title, start, end, location, description, allDay}`
- `buildVeventIcal()` generates iCal with DTSTART/DTEND (converted via `toIcalDateTime()`)
- `handleListUpcoming()` delegates to `handleListEvents()` with a 90-day window, slices to `count`
- `findEventById()` scans all calendars by UID (same pattern as `findTodoById`)

The module exports 6 handlers and `registerCalendar(server)`:
- `handleListCalendars` — returns name, color, editable flag
- `handleListEvents` — fetches by date range, optional calendar filter, sorts by start time
- `handleListUpcoming` — convenience wrapper around list_events (next N events)
- `handleCreateEvent` — builds VEVENT iCal, creates via CalDAV
- `handleUpdateEvent` — finds event, rebuilds with merged fields
- `handleDeleteEvent` — finds event, deletes via CalDAV

See design doc lines 118-124 for exact parameter names.

**Step 4: Run test to verify it passes**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/calendar.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add container/icloud-tools/src/modules/calendar.ts container/icloud-tools/src/__tests__/calendar.test.ts
git commit -m "feat(icloud-tools): add calendar module (6 CalDAV VEVENT tools)"
```

---

## Task 6: Contacts Module (TDD)

**Files:**
- Test: `container/icloud-tools/src/__tests__/contacts.test.ts`
- Create: `container/icloud-tools/src/modules/contacts.ts`

Uses CardDAV with manual vCard parsing (regex-based, no extra dependency). 4 tools.

**Step 1: Write the failing test**

Create `container/icloud-tools/src/__tests__/contacts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  login: vi.fn(),
  fetchAddressBooks: vi.fn(),
  fetchVCards: vi.fn(),
  createVCard: vi.fn(),
  updateVCard: vi.fn(),
};

vi.mock('../auth.js', () => ({
  getCarddavClient: vi.fn().mockResolvedValue(mockClient),
}));

const vcard = (uid: string, fn: string, n: string, tel?: string, email?: string, org?: string) => {
  let v = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:${fn}\r\nN:${n}\r\n`;
  if (tel) v += `TEL;type=CELL:${tel}\r\n`;
  if (email) v += `EMAIL:${email}\r\n`;
  if (org) v += `ORG:${org}\r\n`;
  v += 'END:VCARD';
  return v;
};

import { handleSearch, handleCreate } from '../modules/contacts.js';

describe('contacts module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.fetchAddressBooks.mockResolvedValue([
      { url: '/ab/1/', displayName: 'Contacts' },
    ]);
  });

  describe('search', () => {
    it('finds contacts matching query', async () => {
      mockClient.fetchVCards.mockResolvedValue([
        { data: vcard('c1', 'John Doe', 'Doe;John', '+1234567890', 'john@example.com', 'Acme'), url: '/ab/1/c1.vcf', etag: '"e1"' },
        { data: vcard('c2', 'Jane Smith', 'Smith;Jane'), url: '/ab/1/c2.vcf', etag: '"e2"' },
      ]);

      const result = await handleSearch({ query: 'John' });
      const data = JSON.parse(result.content[0].text);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe('John Doe');
    });
  });

  describe('create', () => {
    it('creates vCard with name and optional fields', async () => {
      mockClient.createVCard.mockResolvedValue(undefined);

      const result = await handleCreate({
        first_name: 'Alice',
        last_name: 'Wonderland',
        phone: '+9876543210',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();

      const arg = mockClient.createVCard.mock.calls[0][0];
      expect(arg.vCardString).toContain('FN:Alice Wonderland');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/contacts.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `container/icloud-tools/src/modules/contacts.ts`.

Key patterns:
- `parseVcard()` uses regex to extract FN, UID, TEL, EMAIL, ORG, NOTE fields from raw vCard text
- `buildVcard()` generates vCard 3.0 strings with N, FN, TEL, EMAIL, ORG fields
- `handleSearch()` fetches all vCards, filters by case-insensitive substring match across name/phone/email/org
- `handleCreate()` creates vCard in first available address book
- `handleUpdate()` finds by UID, merges fields, calls `updateVCard`
- `handleListGroups()` returns address book names (iCloud typically has one)

See design doc lines 126-133 for exact parameter names.

**Step 4: Run test to verify it passes**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/contacts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add container/icloud-tools/src/modules/contacts.ts container/icloud-tools/src/__tests__/contacts.test.ts
git commit -m "feat(icloud-tools): add contacts module (4 CardDAV vCard tools)"
```

---

## Task 7: Mail Module (TDD)

**Files:**
- Test: `container/icloud-tools/src/__tests__/mail.test.ts`
- Create: `container/icloud-tools/src/modules/mail.ts`

Uses `imapflow` for reading and `nodemailer` for sending. 12 tools.

**Step 1: Write the failing test**

Create `container/icloud-tools/src/__tests__/mail.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockImapClient = {
  connect: vi.fn(),
  list: vi.fn(),
  getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
  fetch: vi.fn(),
  search: vi.fn(),
  messageFlagsAdd: vi.fn(),
  messageFlagsRemove: vi.fn(),
  messageMove: vi.fn(),
  messageDelete: vi.fn(),
  append: vi.fn(),
};

const mockSmtpTransport = {
  sendMail: vi.fn().mockResolvedValue({ messageId: '<test@icloud.com>' }),
};

vi.mock('../auth.js', () => ({
  getImapClient: vi.fn().mockResolvedValue(mockImapClient),
  getSmtpTransport: vi.fn().mockReturnValue(mockSmtpTransport),
}));

import { handleListFolders, handleSend, handleFlag } from '../modules/mail.js';

describe('mail module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list_folders', () => {
    it('returns IMAP mailbox list', async () => {
      mockImapClient.list.mockResolvedValue([
        { path: 'INBOX', name: 'INBOX', status: { messages: 42, unseen: 5 } },
        { path: 'Sent Messages', name: 'Sent Messages', status: { messages: 100, unseen: 0 } },
      ]);

      const result = await handleListFolders();
      const data = JSON.parse(result.content[0].text);
      expect(data.data).toHaveLength(2);
      expect(data.data[0].name).toBe('INBOX');
    });
  });

  describe('send', () => {
    it('sends email via SMTP', async () => {
      process.env.ICLOUD_EMAIL = 'me@icloud.com';
      const result = await handleSend({
        to: 'recipient@example.com',
        subject: 'Test',
        body: 'Hello world',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(mockSmtpTransport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'recipient@example.com',
          subject: 'Test',
          text: 'Hello world',
        }),
      );
    });
  });

  describe('flag', () => {
    it('adds flagged flag', async () => {
      const result = await handleFlag({ id: '123', flagged: true });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(mockImapClient.messageFlagsAdd).toHaveBeenCalledWith(123, ['\\Flagged'], { uid: true });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/mail.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `container/icloud-tools/src/modules/mail.ts`.

Key patterns:
- All IMAP operations use `getMailboxLock()` + `try/finally { lock.release() }` for concurrency safety
- `handleListMessages()` fetches the last N messages using a UID range, returns envelope data
- `handleReadMessage()` fetches full source, extracts plain text body after double CRLF
- `handleSend()` uses nodemailer `sendMail()` with `from: process.env.ICLOUD_EMAIL`
- `handleReply()` reads original message, prepends quoted body, sets `inReplyTo` header
- `handleForward()` reads original, builds forwarded message template
- `handleSearch()` uses IMAP SEARCH with OR across subject/from/body fields
- `handleCreateDraft()` uses `client.append('Drafts', rawMessage, ['\\Draft'])`
- `handleUpdateDraft()` deletes old draft + appends new (IMAP has no in-place edit)
- `handleFlag/handleMarkRead` use `messageFlagsAdd/messageFlagsRemove` with `\\Flagged`/`\\Seen`
- `handleMove()` uses `messageMove()` for server-side IMAP MOVE

The module exports 12 handlers and `registerMail(server)`.
See design doc lines 136-150 for exact parameter names.

**Step 4: Run test to verify it passes**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/mail.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add container/icloud-tools/src/modules/mail.ts container/icloud-tools/src/__tests__/mail.test.ts
git commit -m "feat(icloud-tools): add mail module (12 IMAP+SMTP tools)"
```

---

## Task 8: Notes Module (TDD)

**Files:**
- Test: `container/icloud-tools/src/__tests__/notes.test.ts`
- Create: `container/icloud-tools/src/modules/notes.ts`

Read-only access to iCloud Notes via IMAP Notes folder. 2 tools.

**Step 1: Write the failing test**

Create `container/icloud-tools/src/__tests__/notes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockImapClient = {
  connect: vi.fn(),
  list: vi.fn(),
  getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
  fetch: vi.fn(),
};

vi.mock('../auth.js', () => ({
  getImapClient: vi.fn().mockResolvedValue(mockImapClient),
}));

import { handleList, handleRead } from '../modules/notes.js';

describe('notes module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('lists notes from IMAP Notes folder', async () => {
      const mockMessages = [
        {
          uid: 1,
          envelope: { subject: 'Shopping List', date: new Date('2026-03-01') },
          source: Buffer.from('Subject: Shopping List\r\n\r\nMilk, eggs, bread'),
        },
      ];
      mockImapClient.fetch.mockReturnValue((async function* () {
        for (const msg of mockMessages) yield msg;
      })());

      const result = await handleList({});
      const data = JSON.parse(result.content[0].text);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe('Shopping List');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/notes.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `container/icloud-tools/src/modules/notes.ts`.

Key patterns:
- `handleList()` opens the IMAP "Notes" folder (or subfolder), fetches all messages, extracts subject as title and first 100 chars as snippet
- `handleRead()` fetches a single note by UID, returns full plain text body
- Both use `getMailboxLock()` pattern from mail module
- Notes are intentionally read-only — IMAP Notes access is plain text only

The module exports 2 handlers and `registerNotes(server)`.
See design doc lines 153-158.

**Step 4: Run test to verify it passes**

Run: `cd container/icloud-tools && npx vitest run src/__tests__/notes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add container/icloud-tools/src/modules/notes.ts container/icloud-tools/src/__tests__/notes.test.ts
git commit -m "feat(icloud-tools): add notes module (2 read-only IMAP tools)"
```

---

## Task 9: Update Dockerfile + Container Build

**Files:**
- Modify: `container/Dockerfile` (add icloud-tools build between agent-runner build and workspace dirs)

**Step 1: Add icloud-tools build steps to Dockerfile**

After `RUN npm run build` (line 59), before `# Create workspace directories` (line 61), insert:

```dockerfile
# Build icloud-tools MCP server
COPY icloud-tools/package*.json /opt/icloud-tools/
RUN cd /opt/icloud-tools && npm install --omit=dev
COPY icloud-tools/ /opt/icloud-tools/
RUN cd /opt/icloud-tools && npx tsc
```

Uses `/opt/icloud-tools/` to stay out of the `/workspace/` mount namespace.

**Step 2: Build the container image**

Run: `cd container && ./build.sh`

**Step 3: Commit**

```bash
git add container/Dockerfile
git commit -m "build: add icloud-tools MCP server to container image"
```

---

## Task 10: Host-Side Integration (Secrets + allowedTools)

**Files:**
- Modify: `src/container-runner.ts:192-200` (add iCloud secrets to `readSecrets()`)
- Modify: `container/agent-runner/src/index.ts:214-219` (add to `SECRET_ENV_VARS`)
- Modify: `container/agent-runner/src/index.ts:487-498` (add to `allowedTools`)

**Step 1: Add iCloud secrets to `readSecrets()`**

At `src/container-runner.ts:193-199`, add `'ICLOUD_EMAIL'` and `'ICLOUD_APP_PASSWORD'` to the array inside `readEnvFile([...])`.

**Step 2: Add `ICLOUD_APP_PASSWORD` to `SECRET_ENV_VARS`**

At `container/agent-runner/src/index.ts:214-219`, add `'ICLOUD_APP_PASSWORD'` to the array. Do NOT add `ICLOUD_EMAIL` — it's not sensitive enough to strip from Bash (same as `PASSION_GOOGLE_EMAIL`).

**Step 3: Add `'mcp__icloud-tools__*'` to `allowedTools`**

At `container/agent-runner/src/index.ts:495-497`, add `'mcp__icloud-tools__*'` after the existing MCP wildcards.

**Step 4: Add iCloud env vars to `.env`**

Run: `echo -e '\n# iCloud (app-specific password from appleid.apple.com)\nICLOUD_EMAIL=\nICLOUD_APP_PASSWORD=' >> .env`

**Step 5: Sync agent-runner caches + rebuild host**

Run: `for dir in data/sessions/*/agent-runner-src/; do cp container/agent-runner/src/*.ts "$dir"; done && npm run build`

**Step 6: Commit**

```bash
git add src/container-runner.ts container/agent-runner/src/index.ts
git commit -m "feat(icloud-tools): wire secrets and allowedTools for container integration"
```

---

## Task 11: Remove Hardcoded Reminders

**Files:**
- Delete: `src/reminders.ts`, `src/reminders-ipc.ts`, `src/reminders.test.ts`
- Modify: `src/ipc.ts:17` (remove import)
- Modify: `src/ipc.ts:385-390` (simplify default case)
- Modify: `container/agent-runner/src/ipc-mcp-stdio.ts:283-441` (remove reminders section)

**Step 1: Delete reminders source files**

Run: `rm src/reminders.ts src/reminders-ipc.ts src/reminders.test.ts`

**Step 2: Remove import from `src/ipc.ts`**

Delete line 17: `import { handleRemindersIpc } from './reminders-ipc.js';`

**Step 3: Simplify default case in `src/ipc.ts`**

At lines 385-390, replace the `handleRemindersIpc` call with just the warning:

```ts
    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
```

**Step 4: Remove reminders section from `ipc-mcp-stdio.ts`**

Delete lines 283-441 (from `// ── Reminders` comment through the last `);` of `reminders_remove_item`). Keep the stdio transport startup code that follows.

**Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (reminders tests are gone, no broken imports)

**Step 6: Rebuild host + sync caches**

Run: `npm run build && for dir in data/sessions/*/agent-runner-src/; do cp container/agent-runner/src/*.ts "$dir"; done`

**Step 7: Commit**

```bash
git add -u src/reminders.ts src/reminders-ipc.ts src/reminders.test.ts src/ipc.ts container/agent-runner/src/ipc-mcp-stdio.ts
git commit -m "refactor: remove hardcoded JXA reminders (replaced by icloud-tools MCP)"
```

---

## Task 12: Skill Package + Validation Tests

**Files:**
- Create: `.claude/skills/icloud-tools/SKILL.md`
- Create: `.claude/skills/icloud-tools/manifest.yaml`
- Create: `.claude/skills/icloud-tools/tests/icloud-tools.test.ts`

**Step 1: Create SKILL.md**

Create `.claude/skills/icloud-tools/SKILL.md` with frontmatter (`name: icloud-tools`) and phases:
1. Pre-flight — generate app-specific password, add to `.env`
2. Choose Modules — list available modules
3. Configure Group — add MCP entry to group's `.mcp.json` with `/opt/icloud-tools/dist/server.js`
4. Rebuild + Restart — `./build.sh`, kill containers, restart service
5. Verify — test with a message

**Step 2: Create manifest.yaml**

Create `.claude/skills/icloud-tools/manifest.yaml`:

```yaml
skill: icloud-tools
version: 1.0.0
description: "iCloud productivity tools via CalDAV/CardDAV/IMAP/SMTP"
core_version: 1.1.2
adds:
  - container/icloud-tools/package.json
  - container/icloud-tools/tsconfig.json
  - container/icloud-tools/src/server.ts
  - container/icloud-tools/src/auth.ts
  - container/icloud-tools/src/types.ts
  - container/icloud-tools/src/modules/reminders.ts
  - container/icloud-tools/src/modules/calendar.ts
  - container/icloud-tools/src/modules/contacts.ts
  - container/icloud-tools/src/modules/mail.ts
  - container/icloud-tools/src/modules/notes.ts
modifies:
  - container/Dockerfile
  - src/container-runner.ts
  - container/agent-runner/src/index.ts
  - src/ipc.ts
  - container/agent-runner/src/ipc-mcp-stdio.ts
removes:
  - src/reminders.ts
  - src/reminders-ipc.ts
  - src/reminders.test.ts
structured:
  npm_dependencies: {}
  env_additions:
    - ICLOUD_EMAIL
    - ICLOUD_APP_PASSWORD
conflicts:
  - apple-reminders
depends: []
test: "cd container/icloud-tools && npx vitest run"
```

**Step 3: Create validation test**

Create `.claude/skills/icloud-tools/tests/icloud-tools.test.ts` that checks:
- SKILL.md exists
- manifest.yaml is valid YAML with expected fields
- All declared `adds` files exist in repo
- All declared `removes` files no longer exist
- Dockerfile contains `icloud-tools`
- `allowedTools` in agent-runner contains `mcp__icloud-tools__*`
- `readSecrets` in container-runner contains `ICLOUD_EMAIL`
- `ipc.ts` no longer imports `reminders-ipc`

**Step 4: Run skill validation tests**

Run: `npx vitest run --config vitest.skills.config.ts .claude/skills/icloud-tools/tests/icloud-tools.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add .claude/skills/icloud-tools/
git commit -m "feat(icloud-tools): add skill package with SKILL.md, manifest, and validation tests"
```

---

## Task 13: Per-Group Configuration + Verification

This task is environment-specific and cannot be automated in tests.

**Step 1: Add iCloud credentials to `.env`**

Fill in `ICLOUD_EMAIL` and `ICLOUD_APP_PASSWORD` with real values.

**Step 2: Configure test group's `.mcp.json`**

Add to the desired group's `.mcp.json`:

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

Merge with existing MCP entries. Customize `ICLOUD_MODULES` per group.

**Step 3: Rebuild container + restart**

Run:
1. `cd container && ./build.sh`
2. `container stop nanoclaw-{group}-*`
3. `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

**Step 4: Manual verification**

Send test messages:
1. "List my reminder lists" — should return iCloud reminder lists
2. "What are my upcoming calendar events?" — should return events
3. "Search contacts for [name]" — should search iCloud contacts
4. "Check my unread emails" — should list recent mail
5. "List my notes" — should list iCloud notes

**Step 5: Commit group config**

```bash
git add groups/*/.mcp.json
git commit -m "config: enable icloud-tools for groups"
```
