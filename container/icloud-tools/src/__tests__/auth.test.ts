import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('tsdav', () => ({
  DAVClient: vi.fn().mockImplementation(function () {
    (this as Record<string, unknown>).login = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(function () {
    (this as Record<string, unknown>).connect = vi.fn().mockResolvedValue(undefined);
    (this as Record<string, unknown>).logout = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn().mockReturnValue({ verify: vi.fn() }),
}));

describe('auth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
