/**
 * Integration test for the opencode provider's HOST-side reach-in: the self-registration
 * import in the src/providers/index.ts barrel. Importing the barrel runs opencode.ts's
 * top-level registerProviderContainerConfig('opencode', …); without that import line the
 * host never wires the provider's per-session mounts / env passthrough.
 *
 * Behavior, not structural, and BARREL-ONLY: it imports the real barrel (./index.js),
 * never ./opencode.js directly, then asserts the registry actually contains the provider.
 * Importing the provider module directly (as opencode.factory.test.ts does) self-registers
 * it and would stay GREEN even if the barrel line were deleted — that is a unit test,
 * not a registration guard. This test goes red if the barrel import is deleted/drifts,
 * or the barrel fails to evaluate.
 *
 * A provider is a MULTI-POINT integration: this guards the HOST barrel; the CONTAINER
 * barrel is guarded by the sibling bun test; the SDK/CLI dependency + Dockerfile install
 * are guarded by the build/container legs (see the skill's validate step).
 */
import fs from 'fs';

import { afterAll, describe, it, expect } from 'vitest';

import { DATA_DIR } from '../config.js';
import { getProviderContainerConfig, listProviderContainerConfigNames } from './provider-container-registry.js';
import './index.js'; // the real host provider barrel — triggers each provider's self-registration

describe('opencode provider host registration', () => {
  const testRoots = ['ag-opencode-auth-lifecycle', 'ag-one', 'ag-two', 'ag-opencode-legacy'].map(
    (id) => `${DATA_DIR}/provider-state/opencode/groups/${encodeURIComponent(id)}`,
  );
  afterAll(() => {
    for (const root of testRoots) fs.rmSync(root, { recursive: true, force: true });
  });

  it('registers opencode host container-config via the barrel', () => {
    expect(listProviderContainerConfigNames()).toContain('opencode');
  });

  it('reuses one private OpenCode state root across fresh sessions in the same group', async () => {
    const configure = getProviderContainerConfig('opencode');
    expect(configure).toBeDefined();

    const context = {
      agentGroupId: 'ag-opencode-auth-lifecycle',
      groupDir: '/tmp/group',
      selectedSkills: [],
      providerSettings: {},
      hostEnv: {},
    };
    const first = await configure!({ ...context, sessionDir: '/tmp/session-one' });
    const second = await configure!({ ...context, sessionDir: '/tmp/session-two' });
    const expected = `${DATA_DIR}/provider-state/opencode/groups/${context.agentGroupId}`;

    expect(first.mounts).toEqual([{ hostPath: expected, containerPath: '/opencode-xdg', readonly: false }]);
    expect(second.mounts).toEqual(first.mounts);
    expect(first.mounts![0].hostPath).not.toContain('session-one');
  });

  it('atomically migrates the current session state on first group-scoped spawn', async () => {
    const configure = getProviderContainerConfig('opencode')!;
    const sessionDir = fs.mkdtempSync('/tmp/nanoclaw-opencode-session-');
    const legacyRoot = `${sessionDir}/opencode-xdg`;
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(`${legacyRoot}/auth.json`, '{"openai":{"type":"oauth"}}');

    const result = await configure({
      agentGroupId: 'ag-opencode-legacy',
      sessionDir,
      groupDir: '/tmp/group',
      selectedSkills: [],
      providerSettings: {},
      hostEnv: {},
    });

    expect(fs.readFileSync(`${result.mounts![0].hostPath}/auth.json`, 'utf8')).toContain('oauth');
    expect(fs.existsSync(legacyRoot)).toBe(false);
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });

  it('isolates OpenCode state between agent groups', async () => {
    const configure = getProviderContainerConfig('opencode')!;
    const base = {
      sessionDir: '/tmp/session',
      groupDir: '/tmp/group',
      selectedSkills: [],
      providerSettings: {},
      hostEnv: {},
    };
    const first = await configure({ ...base, agentGroupId: 'ag-one' });
    const second = await configure({ ...base, agentGroupId: 'ag-two' });

    expect(first.mounts![0].hostPath).not.toBe(second.mounts![0].hostPath);
  });
});
