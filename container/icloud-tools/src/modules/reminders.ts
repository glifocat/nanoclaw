import { randomUUID } from 'crypto';
import ICAL from 'ical.js';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DAVCalendar, DAVObject } from 'tsdav';
import { getCaldavClient } from '../auth.js';
import { ok, err } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedTodo {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch all calendars that have VTODO component support (i.e. reminder lists). */
async function getReminderLists(): Promise<DAVCalendar[]> {
  const client = await getCaldavClient();
  const calendars = await client.fetchCalendars();
  return calendars.filter(
    (cal) => cal.components && cal.components.includes('VTODO'),
  );
}

/** Find a single reminder list by display name. */
async function findList(name: string): Promise<DAVCalendar | undefined> {
  const lists = await getReminderLists();
  return lists.find((l) => l.displayName === name);
}

/** Parse iCal data into a structured todo object. */
function parseTodo(obj: DAVObject): ParsedTodo | null {
  try {
    if (!obj.data) return null;

    const jcal = ICAL.parse(obj.data as string);
    const comp = new ICAL.Component(jcal);
    const vtodo = comp.getFirstSubcomponent('vtodo');
    if (!vtodo) return null;

    const uid = String(vtodo.getFirstPropertyValue('uid') ?? '');
    const summary = String(vtodo.getFirstPropertyValue('summary') ?? '');
    const status = String(vtodo.getFirstPropertyValue('status') ?? 'NEEDS-ACTION');
    const due = vtodo.getFirstPropertyValue('due');
    const descVal = vtodo.getFirstPropertyValue('description');
    const description: string | null = descVal ? String(descVal) : null;

    return {
      id: uid,
      title: summary,
      completed: status === 'COMPLETED',
      dueDate: due ? due.toString() : null,
      notes: description,
    };
  } catch {
    return null;
  }
}

/** Build an iCal VTODO string from fields. */
function buildVtodoIcal(fields: {
  uid: string;
  title: string;
  status?: string;
  dueDate?: string;
  notes?: string;
}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//icloud-tools//EN',
    'BEGIN:VTODO',
    `UID:${fields.uid}`,
    `DTSTAMP:${formatIcalDate(new Date())}`,
    `SUMMARY:${fields.title}`,
    `STATUS:${fields.status ?? 'NEEDS-ACTION'}`,
  ];

  if (fields.dueDate) {
    lines.push(`DUE:${formatIcalDate(new Date(fields.dueDate))}`);
  }

  if (fields.notes) {
    lines.push(`DESCRIPTION:${fields.notes}`);
  }

  lines.push('END:VTODO', 'END:VCALENDAR');
  return lines.join('\r\n');
}

/** Format a Date to iCal UTC timestamp (YYYYMMDDTHHmmssZ). */
function formatIcalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Search all reminder lists for a VTODO with the given UID.
 * Returns the raw DAVObject and its parent calendar, or null.
 */
async function findTodoById(
  id: string,
): Promise<{ obj: DAVObject; calendar: DAVCalendar } | null> {
  const client = await getCaldavClient();
  const lists = await getReminderLists();
  for (const list of lists) {
    const objects = await client.fetchCalendarObjects({ calendar: list });
    for (const obj of objects) {
      const parsed = parseTodo(obj);
      if (parsed && parsed.id === id) {
        return { obj, calendar: list };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function handleListLists() {
  try {
    const client = await getCaldavClient();
    const lists = await getReminderLists();

    const results = await Promise.all(
      lists.map(async (list) => {
        const objects = await client.fetchCalendarObjects({ calendar: list });
        // Count only incomplete items
        let count = 0;
        for (const obj of objects) {
          const parsed = parseTodo(obj);
          if (parsed && !parsed.completed) count++;
        }
        return { name: list.displayName, itemCount: count };
      }),
    );

    return ok(results);
  } catch (e) {
    return err(`Failed to list reminder lists: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleListItems(params: {
  list_name: string;
  include_completed?: boolean;
}) {
  try {
    const list = await findList(params.list_name);
    if (!list) {
      return err(`List "${params.list_name}" not found`);
    }

    const client = await getCaldavClient();
    const objects = await client.fetchCalendarObjects({ calendar: list });

    const items: ParsedTodo[] = [];
    for (const obj of objects) {
      const parsed = parseTodo(obj);
      if (!parsed) continue;
      if (!params.include_completed && parsed.completed) continue;
      items.push(parsed);
    }

    return ok(items);
  } catch (e) {
    return err(`Failed to list items: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleAddItem(params: {
  list_name: string;
  title: string;
  notes?: string;
  due_date?: string;
}) {
  try {
    const list = await findList(params.list_name);
    if (!list) {
      return err(`List "${params.list_name}" not found`);
    }

    const uid = randomUUID();
    const icalString = buildVtodoIcal({
      uid,
      title: params.title,
      notes: params.notes,
      dueDate: params.due_date,
    });

    const client = await getCaldavClient();
    await client.createCalendarObject({
      calendar: list,
      filename: `${uid}.ics`,
      iCalString: icalString,
    });

    return ok({ id: uid });
  } catch (e) {
    return err(`Failed to add item: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleUpdateItem(params: {
  id: string;
  title?: string;
  notes?: string;
  due_date?: string;
}) {
  try {
    const found = await findTodoById(params.id);
    if (!found) {
      return err(`Item "${params.id}" not found`);
    }

    const { obj } = found;
    const parsed = parseTodo(obj)!;

    const updatedIcal = buildVtodoIcal({
      uid: parsed.id,
      title: params.title ?? parsed.title,
      status: parsed.completed ? 'COMPLETED' : 'NEEDS-ACTION',
      dueDate: params.due_date ?? parsed.dueDate ?? undefined,
      notes: params.notes ?? parsed.notes ?? undefined,
    });

    const client = await getCaldavClient();
    await client.updateCalendarObject({
      calendarObject: {
        url: obj.url,
        etag: obj.etag,
        data: updatedIcal,
      },
    });

    return ok({ success: true });
  } catch (e) {
    return err(`Failed to update item: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleCompleteItem(params: { id: string }) {
  try {
    const found = await findTodoById(params.id);
    if (!found) {
      return err(`Item "${params.id}" not found`);
    }

    const { obj } = found;
    const parsed = parseTodo(obj)!;

    const updatedIcal = buildVtodoIcal({
      uid: parsed.id,
      title: parsed.title,
      status: 'COMPLETED',
      dueDate: parsed.dueDate ?? undefined,
      notes: parsed.notes ?? undefined,
    });

    const client = await getCaldavClient();
    await client.updateCalendarObject({
      calendarObject: {
        url: obj.url,
        etag: obj.etag,
        data: updatedIcal,
      },
    });

    return ok({ success: true });
  } catch (e) {
    return err(`Failed to complete item: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleRemoveItem(params: { id: string }) {
  try {
    const found = await findTodoById(params.id);
    if (!found) {
      return err(`Item "${params.id}" not found`);
    }

    const { obj } = found;
    const client = await getCaldavClient();
    await client.deleteCalendarObject({
      calendarObject: { url: obj.url, etag: obj.etag },
    });

    return ok({ success: true });
  } catch (e) {
    return err(`Failed to remove item: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleMoveItem(params: { id: string; target_list: string }) {
  try {
    const found = await findTodoById(params.id);
    if (!found) {
      return err(`Item "${params.id}" not found`);
    }

    const targetList = await findList(params.target_list);
    if (!targetList) {
      return err(`Target list "${params.target_list}" not found`);
    }

    const { obj } = found;
    const parsed = parseTodo(obj)!;

    // CalDAV has no native "move" — create in target, delete from source
    const icalString = buildVtodoIcal({
      uid: parsed.id,
      title: parsed.title,
      status: parsed.completed ? 'COMPLETED' : 'NEEDS-ACTION',
      dueDate: parsed.dueDate ?? undefined,
      notes: parsed.notes ?? undefined,
    });

    const client = await getCaldavClient();

    await client.createCalendarObject({
      calendar: targetList,
      filename: `${parsed.id}.ics`,
      iCalString: icalString,
    });

    await client.deleteCalendarObject({
      calendarObject: { url: obj.url, etag: obj.etag },
    });

    return ok({ success: true });
  } catch (e) {
    return err(`Failed to move item: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// MCP Registration
// ---------------------------------------------------------------------------

export function registerReminders(server: McpServer): void {
  server.tool(
    'icloud_reminders_list_lists',
    'List all iCloud reminder lists with their incomplete item counts',
    {},
    async () => handleListLists(),
  );

  server.tool(
    'icloud_reminders_list_items',
    'List items in a specific iCloud reminder list',
    {
      list_name: z.string().describe('Name of the reminder list'),
      include_completed: z
        .boolean()
        .optional()
        .describe('Whether to include completed items (default: false)'),
    },
    async (params) => handleListItems(params),
  );

  server.tool(
    'icloud_reminders_add_item',
    'Add a new reminder to a list',
    {
      list_name: z.string().describe('Name of the reminder list'),
      title: z.string().describe('Title of the reminder'),
      notes: z.string().optional().describe('Additional notes'),
      due_date: z.string().optional().describe('Due date in ISO 8601 format'),
    },
    async (params) => handleAddItem(params),
  );

  server.tool(
    'icloud_reminders_update_item',
    'Update an existing reminder',
    {
      id: z.string().describe('UID of the reminder to update'),
      title: z.string().optional().describe('New title'),
      notes: z.string().optional().describe('New notes'),
      due_date: z.string().optional().describe('New due date in ISO 8601 format'),
    },
    async (params) => handleUpdateItem(params),
  );

  server.tool(
    'icloud_reminders_complete_item',
    'Mark a reminder as completed',
    {
      id: z.string().describe('UID of the reminder to complete'),
    },
    async (params) => handleCompleteItem(params),
  );

  server.tool(
    'icloud_reminders_remove_item',
    'Delete a reminder',
    {
      id: z.string().describe('UID of the reminder to delete'),
    },
    async (params) => handleRemoveItem(params),
  );

  server.tool(
    'icloud_reminders_move_item',
    'Move a reminder to a different list',
    {
      id: z.string().describe('UID of the reminder to move'),
      target_list: z.string().describe('Name of the target reminder list'),
    },
    async (params) => handleMoveItem(params),
  );
}
