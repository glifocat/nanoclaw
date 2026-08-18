---
name: add-mattermost
description: Preserve and install the Spark appliance Mattermost Chat SDK channel adapter.
---

# Mattermost channel for the Spark appliance

Install the appliance's first-party Mattermost channel module. The external
`chat-adapter-mattermost` package is pinned to a vendored 0.0.5 tarball so both
isolated update worktrees and the live checkout resolve the same artifact.

Copy the maintained channel module and adapter artifact into the host tree:

```nc:copy
payload/src/channels/mattermost.ts -> src/channels/mattermost.ts
payload/vendor/chat-adapter-mattermost-0.0.5.tgz -> vendor/chat-adapter-mattermost-0.0.5.tgz
```

```nc:run effect:fetch
pnpm pkg set 'dependencies.chat-adapter-mattermost=file:vendor/chat-adapter-mattermost-0.0.5.tgz'
pnpm install --lockfile-only --no-frozen-lockfile
```

Register the default Mattermost instance:

```nc:append to:src/channels/index.ts
import './mattermost.js';
```

Verify the vendored adapter artifact:

```nc:run effect:check
test -f vendor/chat-adapter-mattermost-0.0.5.tgz
```
