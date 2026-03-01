import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = vi.hoisted(() => ({
  login: vi.fn(),
  fetchAddressBooks: vi.fn(),
  fetchVCards: vi.fn(),
  createVCard: vi.fn(),
  updateVCard: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  getCarddavClient: vi.fn().mockResolvedValue(mockClient),
}));

const vcard = (
  uid: string,
  fn: string,
  n: string,
  opts?: { tel?: string[]; email?: string[]; org?: string; note?: string },
) => {
  let data = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:${fn}\r\nN:${n}\r\n`;
  if (opts?.tel) {
    for (const t of opts.tel) data += `TEL;type=CELL:${t}\r\n`;
  }
  if (opts?.email) {
    for (const e of opts.email) data += `EMAIL;type=INTERNET:${e}\r\n`;
  }
  if (opts?.org) data += `ORG:${opts.org}\r\n`;
  if (opts?.note) data += `NOTE:${opts.note}\r\n`;
  data += `END:VCARD`;
  return data;
};

import {
  handleSearch,
  handleListGroups,
  handleCreate,
  handleUpdate,
} from '../modules/contacts.js';

describe('contacts module', () => {
  const addressBooks = [
    { displayName: 'Contacts', url: '/ab/1/' },
    { displayName: 'Work', url: '/ab/2/' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.fetchAddressBooks.mockResolvedValue(addressBooks);
  });

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------
  describe('search', () => {
    it('finds contacts by name substring (case-insensitive)', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;', {
              tel: ['+1234567890'],
              email: ['john@example.com'],
              org: 'Acme Inc.',
            }),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
          {
            data: vcard('uid2', 'Jane Smith', 'Smith;Jane;;;', {
              tel: ['+0987654321'],
              email: ['jane@example.com'],
            }),
            url: '/ab/1/uid2.vcf',
            etag: '"e2"',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await handleSearch({ query: 'john' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0]).toEqual({
        id: 'uid1',
        name: 'John Doe',
        phones: ['+1234567890'],
        emails: ['john@example.com'],
        organization: 'Acme Inc.',
      });
    });

    it('finds contacts by phone number', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;', {
              tel: ['+1234567890'],
            }),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await handleSearch({ query: '1234' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe('John Doe');
    });

    it('finds contacts by email', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;', {
              email: ['john@example.com'],
            }),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await handleSearch({ query: 'example.com' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
    });

    it('finds contacts by organization', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;', {
              org: 'Acme Inc.',
            }),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await handleSearch({ query: 'acme' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
    });

    it('returns empty array when no matches', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;'),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await handleSearch({ query: 'zzz-no-match' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0);
    });

    it('handles contacts with multiple phones and emails', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;', {
              tel: ['+111', '+222'],
              email: ['a@b.com', 'c@d.com'],
            }),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await handleSearch({ query: 'john' });
      const data = JSON.parse(result.content[0].text);
      expect(data.data[0].phones).toEqual(['+111', '+222']);
      expect(data.data[0].emails).toEqual(['a@b.com', 'c@d.com']);
    });

    it('searches across all address books', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;'),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([
          {
            data: vcard('uid2', 'Johnny Cash', 'Cash;Johnny;;;'),
            url: '/ab/2/uid2.vcf',
            etag: '"e2"',
          },
        ]);

      const result = await handleSearch({ query: 'john' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // list_groups
  // ---------------------------------------------------------------------------
  describe('list_groups', () => {
    it('returns address book names with member counts', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          { data: vcard('uid1', 'John Doe', 'Doe;John;;;'), url: '/ab/1/uid1.vcf' },
          { data: vcard('uid2', 'Jane Smith', 'Smith;Jane;;;'), url: '/ab/1/uid2.vcf' },
        ])
        .mockResolvedValueOnce([
          { data: vcard('uid3', 'Bob Work', 'Work;Bob;;;'), url: '/ab/2/uid3.vcf' },
        ]);

      const result = await handleListGroups();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toEqual([
        { name: 'Contacts', memberCount: 2 },
        { name: 'Work', memberCount: 1 },
      ]);
    });

    it('handles empty address books', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await handleListGroups();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toEqual([
        { name: 'Contacts', memberCount: 0 },
        { name: 'Work', memberCount: 0 },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('generates vCard with correct FN and N fields', async () => {
      mockClient.createVCard.mockResolvedValue(undefined);

      const result = await handleCreate({
        first_name: 'John',
        last_name: 'Doe',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();

      const callArg = mockClient.createVCard.mock.calls[0][0];
      expect(callArg.vCardString).toContain('FN:John Doe');
      expect(callArg.vCardString).toContain('N:Doe;John;;;');
      expect(callArg.vCardString).toContain('VERSION:3.0');
      expect(callArg.vCardString).toContain('BEGIN:VCARD');
      expect(callArg.vCardString).toContain('END:VCARD');
    });

    it('creates vCard with first name only', async () => {
      mockClient.createVCard.mockResolvedValue(undefined);

      const result = await handleCreate({ first_name: 'Madonna' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const callArg = mockClient.createVCard.mock.calls[0][0];
      expect(callArg.vCardString).toContain('FN:Madonna');
      expect(callArg.vCardString).toContain('N:;Madonna;;;');
    });

    it('includes optional phone, email, and organization', async () => {
      mockClient.createVCard.mockResolvedValue(undefined);

      const result = await handleCreate({
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890',
        email: 'john@example.com',
        organization: 'Acme Inc.',
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const callArg = mockClient.createVCard.mock.calls[0][0];
      expect(callArg.vCardString).toContain('TEL;type=CELL:+1234567890');
      expect(callArg.vCardString).toContain('EMAIL:john@example.com');
      expect(callArg.vCardString).toContain('ORG:Acme Inc.');
    });

    it('uses first address book for creation', async () => {
      mockClient.createVCard.mockResolvedValue(undefined);

      await handleCreate({ first_name: 'John' });

      const callArg = mockClient.createVCard.mock.calls[0][0];
      expect(callArg.addressBook).toBe(addressBooks[0]);
    });

    it('sets a .vcf filename based on UID', async () => {
      mockClient.createVCard.mockResolvedValue(undefined);

      const result = await handleCreate({ first_name: 'John' });
      const data = JSON.parse(result.content[0].text);

      const callArg = mockClient.createVCard.mock.calls[0][0];
      expect(callArg.filename).toBe(`${data.data.id}.vcf`);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('finds contact by id and updates phone', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;', {
              tel: ['+1234567890'],
              email: ['john@example.com'],
            }),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);
      mockClient.updateVCard.mockResolvedValue(undefined);

      const result = await handleUpdate({ id: 'uid1', phone: '+9999999999' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateVCard.mock.calls[0][0];
      expect(updateArg.vCard.data).toContain('TEL;type=CELL:+9999999999');
      expect(updateArg.vCard.url).toBe('/ab/1/uid1.vcf');
      expect(updateArg.vCard.etag).toBe('"e1"');
    });

    it('updates email', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;', {
              email: ['old@example.com'],
            }),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);
      mockClient.updateVCard.mockResolvedValue(undefined);

      const result = await handleUpdate({ id: 'uid1', email: 'new@example.com' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateVCard.mock.calls[0][0];
      expect(updateArg.vCard.data).toContain('EMAIL:new@example.com');
    });

    it('updates organization', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;'),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);
      mockClient.updateVCard.mockResolvedValue(undefined);

      const result = await handleUpdate({ id: 'uid1', organization: 'NewCorp' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateVCard.mock.calls[0][0];
      expect(updateArg.vCard.data).toContain('ORG:NewCorp');
    });

    it('updates notes', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;'),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);
      mockClient.updateVCard.mockResolvedValue(undefined);

      const result = await handleUpdate({ id: 'uid1', notes: 'Met at conference' });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updateArg = mockClient.updateVCard.mock.calls[0][0];
      expect(updateArg.vCard.data).toContain('NOTE:Met at conference');
    });

    it('preserves existing FN and N when updating', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;', {
              tel: ['+111'],
              org: 'OldCorp',
            }),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);
      mockClient.updateVCard.mockResolvedValue(undefined);

      await handleUpdate({ id: 'uid1', notes: 'New note' });

      const updateArg = mockClient.updateVCard.mock.calls[0][0];
      expect(updateArg.vCard.data).toContain('FN:John Doe');
      expect(updateArg.vCard.data).toContain('UID:uid1');
    });

    it('returns error for non-existent contact', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await handleUpdate({ id: 'nonexistent', phone: '+111' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/not found/i);
    });
  });

  // ---------------------------------------------------------------------------
  // error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('search returns error on client failure', async () => {
      mockClient.fetchAddressBooks.mockRejectedValue(new Error('Network error'));

      const result = await handleSearch({ query: 'test' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/network error/i);
      expect(result.isError).toBe(true);
    });

    it('list_groups returns error on client failure', async () => {
      mockClient.fetchAddressBooks.mockRejectedValue(new Error('Auth failed'));

      const result = await handleListGroups();
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/auth failed/i);
      expect(result.isError).toBe(true);
    });

    it('create returns error on client failure', async () => {
      mockClient.createVCard.mockRejectedValue(new Error('Server error'));

      const result = await handleCreate({ first_name: 'John' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/server error/i);
      expect(result.isError).toBe(true);
    });

    it('update returns error on client failure', async () => {
      mockClient.fetchVCards
        .mockResolvedValueOnce([
          {
            data: vcard('uid1', 'John Doe', 'Doe;John;;;'),
            url: '/ab/1/uid1.vcf',
            etag: '"e1"',
          },
        ])
        .mockResolvedValueOnce([]);
      mockClient.updateVCard.mockRejectedValue(new Error('Update failed'));

      const result = await handleUpdate({ id: 'uid1', phone: '+111' });
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toMatch(/update failed/i);
      expect(result.isError).toBe(true);
    });
  });
});
