import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';

const stateRoot = (...parts: string[]) => path.join(DATA_DIR, 'provider-state', 'opencode', ...parts);

export function pendingOpenCodeStateDir(requestId: string): string {
  return stateRoot('pending', encodeURIComponent(requestId));
}

export function groupOpenCodeStateDir(agentGroupId: string): string {
  return stateRoot('groups', encodeURIComponent(agentGroupId));
}

export function hasOpenCodeProviderAuth(root: string, providerId: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'opencode', 'auth.json'), 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && providerId in parsed;
  } catch {
    return false;
  }
}

export function promotePendingOpenCodeState(requestId: string, agentGroupId: string): void {
  const pending = pendingOpenCodeStateDir(requestId);
  const group = groupOpenCodeStateDir(agentGroupId);
  if (!fs.existsSync(pending)) return;
  fs.mkdirSync(path.dirname(group), { recursive: true, mode: 0o700 });
  if (fs.existsSync(group)) throw new Error(`OpenCode state already exists for group ${agentGroupId}`);
  fs.renameSync(pending, group);
  fs.chmodSync(group, 0o700);
}

export function removePendingOpenCodeState(requestId: string): void {
  fs.rmSync(pendingOpenCodeStateDir(requestId), { recursive: true, force: true });
}
