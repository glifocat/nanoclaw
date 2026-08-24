import type { Migration } from './index.js';

/** Restart-safe, not-yet-durable local provider settings collected by the registration wizard. */
export const migration026: Migration = {
  version: 26,
  name: 'opencode-inline-provider',
  async up(db) {
    await db.exec(`ALTER TABLE pending_channel_approvals ADD COLUMN pending_provider_json TEXT`);
  },
};
