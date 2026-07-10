/**
 * Integration test for the matrix channel's single reach-in: the self-registration
 * import in the `src/channels/index.ts` barrel. Importing the barrel runs matrix.ts's
 * top-level `registerChannelAdapter('matrix', …)`; without the import the channel is
 * silently absent.
 *
 * Behavior, not structural: it imports the real barrel and asserts the registry
 * actually contains the channel. This reflects what happens at host boot — if the
 * `import './matrix.js';` line is deleted, or the barrel fails to evaluate for any
 * reason (so the channel genuinely would not register), this goes red. A structural
 * check of the import line would falsely pass in that second case.
 *
 * Importing the barrel is safe: registration is a pure top-level call. The
 * native SDK and crypto binding are loaded lazily only when a configured
 * Matrix adapter is set up.
 *
 * Matrix implements ChannelAdapter directly. The build/typecheck leg guards
 * that core contract against upstream drift.
 */
import { describe, it, expect } from 'vitest';

import { getRegisteredChannelNames } from './channel-registry.js';
import './index.js'; // the real barrel — triggers every channel's self-registration

describe('matrix channel registration', () => {
  it('registers matrix via the channel barrel', () => {
    expect(getRegisteredChannelNames()).toContain('matrix');
  });
});
