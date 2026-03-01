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
  handleUpdateItem,
  handleCompleteItem,
  handleRemoveItem,
  handleMoveItem,
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

    it('returns all items when include_completed is true', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: vtodoIcal('1', 'Milk', 'NEEDS-ACTION'), url: '/cal/1/1.ics', etag: '"e1"' },
        { data: vtodoIcal('2', 'Eggs', 'COMPLETED'), url: '/cal/1/2.ics', etag: '"e2"' },
      ]);

      const result = await handleListItems({ list_name: 'Groceries', include_completed: true });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
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

    it('creates VTODO with title only (minimal)', async () => {
      mockClient.createCalendarObject.mockResolvedValue(undefined);

      const result = await handleAddItem({
        list_name: 'Groceries',
        title: 'Butter',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();

      const calArg = mockClient.createCalendarObject.mock.calls[0][0];
      expect(calArg.iCalString).toContain('SUMMARY:Butter');
      expect(calArg.iCalString).toContain('STATUS:NEEDS-ACTION');
      expect(calArg.iCalString).not.toContain('DESCRIPTION');
    });

    it('returns error for non-existent list', async () => {
      const result = await handleAddItem({ list_name: 'Nonexistent', title: 'Test' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  describe('update_item', () => {
    it('updates title of existing item', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: vtodoIcal('uid1', 'Milk', 'NEEDS-ACTION'), url: '/cal/1/uid1.ics', etag: '"e1"' },
      ]);
      mockClient.updateCalendarObject.mockResolvedValue(undefined);

      const result = await handleUpdateItem({ id: 'uid1', title: 'Almond Milk' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateCalendarObject.mock.calls[0][0];
      expect(updateArg.calendarObject.data).toContain('SUMMARY:Almond Milk');
    });

    it('updates notes of existing item', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: vtodoIcal('uid1', 'Milk', 'NEEDS-ACTION'), url: '/cal/1/uid1.ics', etag: '"e1"' },
      ]);
      mockClient.updateCalendarObject.mockResolvedValue(undefined);

      const result = await handleUpdateItem({ id: 'uid1', notes: 'Organic please' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateCalendarObject.mock.calls[0][0];
      expect(updateArg.calendarObject.data).toContain('DESCRIPTION:Organic please');
    });

    it('returns error for non-existent item', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([]);

      const result = await handleUpdateItem({ id: 'nonexistent', title: 'Test' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
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

    it('returns error for non-existent item', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([]);

      const result = await handleCompleteItem({ id: 'nonexistent' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
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

    it('returns error for non-existent item', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([]);

      const result = await handleRemoveItem({ id: 'nonexistent' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  describe('move_item', () => {
    it('creates item in target list and deletes from source', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: vtodoIcal('uid1', 'Milk', 'NEEDS-ACTION', '20260315T120000Z', 'Whole milk'), url: '/cal/1/uid1.ics', etag: '"e1"' },
      ]);
      mockClient.createCalendarObject.mockResolvedValue(undefined);
      mockClient.deleteCalendarObject.mockResolvedValue(undefined);

      const result = await handleMoveItem({ id: 'uid1', target_list: 'Work' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      // Should create in target list
      expect(mockClient.createCalendarObject).toHaveBeenCalledTimes(1);
      const createArg = mockClient.createCalendarObject.mock.calls[0][0];
      expect(createArg.calendar.url).toBe('/cal/2/');
      expect(createArg.iCalString).toContain('SUMMARY:Milk');

      // Should delete from source
      expect(mockClient.deleteCalendarObject).toHaveBeenCalledWith({
        calendarObject: { url: '/cal/1/uid1.ics', etag: '"e1"' },
      });
    });

    it('returns error for non-existent target list', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([
        { data: vtodoIcal('uid1', 'Milk', 'NEEDS-ACTION'), url: '/cal/1/uid1.ics', etag: '"e1"' },
      ]);

      const result = await handleMoveItem({ id: 'uid1', target_list: 'Nonexistent' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });

    it('returns error for non-existent item', async () => {
      mockClient.fetchCalendarObjects.mockResolvedValue([]);

      const result = await handleMoveItem({ id: 'nonexistent', target_list: 'Work' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });
});
