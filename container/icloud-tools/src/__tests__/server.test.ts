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
