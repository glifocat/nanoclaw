import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = vi.hoisted(() => ({
  login: vi.fn(),
  fetchCalendars: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  createCalendarObject: vi.fn(),
  updateCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  getCaldavClient: vi.fn().mockResolvedValue(mockClient),
}));

/** Build a VEVENT iCal string for tests. */
const veventIcal = (
  uid: string,
  summary: string,
  dtstart: string,
  dtend: string,
  opts?: { location?: string; description?: string; allDay?: boolean },
) => {
  let ical = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\n`;
  if (opts?.allDay) {
    // All-day events use DATE (no time component) — VALUE=DATE format
    ical += `DTSTART;VALUE=DATE:${dtstart}\r\n`;
    ical += `DTEND;VALUE=DATE:${dtend}\r\n`;
  } else {
    ical += `DTSTART:${dtstart}\r\n`;
    ical += `DTEND:${dtend}\r\n`;
  }
  if (opts?.location) ical += `LOCATION:${opts.location}\r\n`;
  if (opts?.description) ical += `DESCRIPTION:${opts.description}\r\n`;
  ical += `END:VEVENT\r\nEND:VCALENDAR`;
  return ical;
};

import {
  handleListCalendars,
  handleListEvents,
  handleListUpcoming,
  handleCreateEvent,
  handleUpdateEvent,
  handleDeleteEvent,
} from '../modules/calendar.js';

describe('calendar module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.fetchCalendars.mockResolvedValue([
      { displayName: 'Personal', url: '/cal/1/', components: ['VEVENT'] },
      { displayName: 'Work', url: '/cal/2/', components: ['VEVENT'] },
      { displayName: 'Groceries', url: '/cal/3/', components: ['VTODO'] },
    ]);
  });

  describe('list_calendars', () => {
    it('returns only VEVENT calendars', async () => {
      const result = await handleListCalendars();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0]).toEqual({ name: 'Personal', color: undefined, editable: true });
      expect(data.data[1]).toEqual({ name: 'Work', color: undefined, editable: true });
    });
  });

  describe('list_events', () => {
    it('returns events within date range', async () => {
      mockClient.fetchCalendarObjects
        .mockResolvedValueOnce([
          {
            data: veventIcal('ev1', 'Lunch', '20260310T120000Z', '20260310T130000Z', { location: 'Cafe' }),
            url: '/cal/1/ev1.ics',
            etag: '"e1"',
          },
          {
            data: veventIcal('ev2', 'Meeting', '20260311T090000Z', '20260311T100000Z'),
            url: '/cal/1/ev2.ics',
            etag: '"e2"',
          },
        ])
        .mockResolvedValueOnce([]); // Work calendar has no events

      const result = await handleListEvents({
        start_date: '2026-03-01',
        end_date: '2026-03-31',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0].title).toBe('Lunch');
      expect(data.data[0].location).toBe('Cafe');
      expect(data.data[1].title).toBe('Meeting');
    });

    it('filters by calendar name when provided', async () => {
      // Only Personal calendar will be queried
      mockClient.fetchCalendarObjects.mockResolvedValue([
        {
          data: veventIcal('ev1', 'Yoga', '20260310T070000Z', '20260310T080000Z'),
          url: '/cal/1/ev1.ics',
          etag: '"e1"',
        },
      ]);

      const result = await handleListEvents({
        calendar: 'Personal',
        start_date: '2026-03-01',
        end_date: '2026-03-31',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe('Yoga');
    });

    it('returns error for non-existent calendar', async () => {
      const result = await handleListEvents({
        calendar: 'Nonexistent',
        start_date: '2026-03-01',
        end_date: '2026-03-31',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });

    it('returns events sorted by start time', async () => {
      mockClient.fetchCalendarObjects
        .mockResolvedValueOnce([
          {
            data: veventIcal('ev2', 'Later', '20260311T140000Z', '20260311T150000Z'),
            url: '/cal/1/ev2.ics',
            etag: '"e2"',
          },
          {
            data: veventIcal('ev1', 'Earlier', '20260310T090000Z', '20260310T100000Z'),
            url: '/cal/1/ev1.ics',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]); // Work calendar has no events

      const result = await handleListEvents({
        start_date: '2026-03-01',
        end_date: '2026-03-31',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.data[0].title).toBe('Earlier');
      expect(data.data[1].title).toBe('Later');
    });

    it('detects all-day events', async () => {
      mockClient.fetchCalendarObjects
        .mockResolvedValueOnce([
          {
            data: veventIcal('ev1', 'Holiday', '20260315', '20260316', { allDay: true }),
            url: '/cal/1/ev1.ics',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]); // Work calendar has no events

      const result = await handleListEvents({
        start_date: '2026-03-01',
        end_date: '2026-03-31',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.data[0].allDay).toBe(true);
      expect(data.data[0].title).toBe('Holiday');
    });
  });

  describe('list_upcoming', () => {
    it('returns upcoming events limited by count', async () => {
      const events = Array.from({ length: 5 }, (_, i) => ({
        data: veventIcal(`ev${i}`, `Event ${i}`, `2026031${i}T090000Z`, `2026031${i}T100000Z`),
        url: `/cal/1/ev${i}.ics`,
        etag: `"e${i}"`,
      }));
      mockClient.fetchCalendarObjects.mockResolvedValue(events);

      const result = await handleListUpcoming({ count: 3 });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);
    });

    it('defaults to 10 events when count not specified', async () => {
      const events = Array.from({ length: 15 }, (_, i) => ({
        data: veventIcal(
          `ev${i}`,
          `Event ${i}`,
          `202603${String(i + 10).padStart(2, '0')}T090000Z`,
          `202603${String(i + 10).padStart(2, '0')}T100000Z`,
        ),
        url: `/cal/1/ev${i}.ics`,
        etag: `"e${i}"`,
      }));
      mockClient.fetchCalendarObjects.mockResolvedValue(events);

      const result = await handleListUpcoming({});
      const data = JSON.parse(result.content[0].text);
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('includes calendar name in results', async () => {
      mockClient.fetchCalendarObjects
        .mockResolvedValueOnce([
          {
            data: veventIcal('ev1', 'Personal Event', '20260310T090000Z', '20260310T100000Z'),
            url: '/cal/1/ev1.ics',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([
          {
            data: veventIcal('ev2', 'Work Event', '20260311T090000Z', '20260311T100000Z'),
            url: '/cal/2/ev2.ics',
            etag: '"e2"',
          },
        ]);

      const result = await handleListUpcoming({ count: 10 });
      const data = JSON.parse(result.content[0].text);
      expect(data.data[0].calendar).toBe('Personal');
      expect(data.data[1].calendar).toBe('Work');
    });
  });

  describe('create_event', () => {
    it('creates VEVENT with required fields', async () => {
      mockClient.createCalendarObject.mockResolvedValue(undefined);

      const result = await handleCreateEvent({
        calendar: 'Personal',
        title: 'Team Standup',
        start: '2026-03-15T09:00:00Z',
        end: '2026-03-15T09:30:00Z',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();

      const calArg = mockClient.createCalendarObject.mock.calls[0][0];
      expect(calArg.iCalString).toContain('SUMMARY:Team Standup');
      expect(calArg.iCalString).toContain('DTSTART');
      expect(calArg.iCalString).toContain('DTEND');
    });

    it('creates VEVENT with optional location and description', async () => {
      mockClient.createCalendarObject.mockResolvedValue(undefined);

      const result = await handleCreateEvent({
        calendar: 'Personal',
        title: 'Dinner',
        start: '2026-03-15T19:00:00Z',
        end: '2026-03-15T21:00:00Z',
        location: 'Italian Restaurant',
        description: 'Birthday dinner',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const calArg = mockClient.createCalendarObject.mock.calls[0][0];
      expect(calArg.iCalString).toContain('LOCATION:Italian Restaurant');
      expect(calArg.iCalString).toContain('DESCRIPTION:Birthday dinner');
    });

    it('returns error for non-existent calendar', async () => {
      const result = await handleCreateEvent({
        calendar: 'Nonexistent',
        title: 'Test',
        start: '2026-03-15T09:00:00Z',
        end: '2026-03-15T10:00:00Z',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  describe('update_event', () => {
    it('updates title of existing event', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        {
          data: veventIcal('uid1', 'Old Title', '20260315T090000Z', '20260315T100000Z'),
          url: '/cal/1/uid1.ics',
          etag: '"e1"',
        },
      ]);
      mockClient.updateCalendarObject.mockResolvedValue(undefined);

      const result = await handleUpdateEvent({ id: 'uid1', title: 'New Title' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateCalendarObject.mock.calls[0][0];
      expect(updateArg.calendarObject.data).toContain('SUMMARY:New Title');
    });

    it('updates location of existing event', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        {
          data: veventIcal('uid1', 'Meeting', '20260315T090000Z', '20260315T100000Z', { location: 'Room A' }),
          url: '/cal/1/uid1.ics',
          etag: '"e1"',
        },
      ]);
      mockClient.updateCalendarObject.mockResolvedValue(undefined);

      const result = await handleUpdateEvent({ id: 'uid1', location: 'Room B' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateCalendarObject.mock.calls[0][0];
      expect(updateArg.calendarObject.data).toContain('LOCATION:Room B');
    });

    it('returns error for non-existent event', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([]);

      const result = await handleUpdateEvent({ id: 'nonexistent', title: 'Test' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  describe('delete_event', () => {
    it('deletes the calendar object', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        {
          data: veventIcal('uid1', 'Cancel This', '20260315T090000Z', '20260315T100000Z'),
          url: '/cal/1/uid1.ics',
          etag: '"e1"',
        },
      ]);
      mockClient.deleteCalendarObject.mockResolvedValue(undefined);

      const result = await handleDeleteEvent({ id: 'uid1' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(mockClient.deleteCalendarObject).toHaveBeenCalledWith({
        calendarObject: { url: '/cal/1/uid1.ics', etag: '"e1"' },
      });
    });

    it('returns error for non-existent event', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([]);

      const result = await handleDeleteEvent({ id: 'nonexistent' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });
});
