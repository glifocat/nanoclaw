import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({ DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-opencode-auth-')) }));

import { DATA_DIR } from '../config.js';
import {
  groupOpenCodeStateDir,
  hasOpenCodeProviderAuth,
  pendingOpenCodeStateDir,
  promotePendingOpenCodeState,
  removePendingOpenCodeState,
} from './opencode-auth.js';

afterEach(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

describe('OpenCode authentication state', () => {
  it('recognizes only the requested provider in native auth.json', () => {
    const root = pendingOpenCodeStateDir('mg-one');
    fs.mkdirSync(path.join(root, 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(root, 'opencode', 'auth.json'), JSON.stringify({ openai: { type: 'oauth' } }));

    expect(hasOpenCodeProviderAuth(root, 'openai')).toBe(true);
    expect(hasOpenCodeProviderAuth(root, 'google')).toBe(false);
  });

  it('promotes pending native state into the created group without copying credentials', () => {
    const pending = pendingOpenCodeStateDir('mg-two');
    fs.mkdirSync(path.join(pending, 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(pending, 'opencode', 'auth.json'), '{"openai":{"type":"oauth"}}');

    promotePendingOpenCodeState('mg-two', 'ag-two');

    expect(fs.existsSync(pending)).toBe(false);
    expect(hasOpenCodeProviderAuth(groupOpenCodeStateDir('ag-two'), 'openai')).toBe(true);
  });

  it('removes abandoned pending credentials', () => {
    const pending = pendingOpenCodeStateDir('mg-three');
    fs.mkdirSync(pending, { recursive: true });
    fs.writeFileSync(path.join(pending, 'secret'), 'credential material');

    removePendingOpenCodeState('mg-three');

    expect(fs.existsSync(pending)).toBe(false);
  });
});
