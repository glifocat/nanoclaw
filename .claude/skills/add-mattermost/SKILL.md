---
name: add-mattermost
description: Preserve and install the Spark appliance Mattermost Chat SDK channel adapter.
---

# Mattermost channel for the Spark appliance

Install the appliance's first-party Mattermost channel module. The external
`chat-adapter-mattermost` package remains pinned to the locally preserved 0.0.5
tarball in `package.json`; verify that tarball exists before building.

Copy the maintained channel module into the host tree:

```nc:copy
payload/src/channels/mattermost.ts -> src/channels/mattermost.ts
```

Register the default Mattermost instance:

```nc:append to:src/channels/index.ts
import './mattermost.js';
```

Verify the local adapter artifact:

```nc:run effect:check
test -f /home/nanoco/mattermost-lab/chat-adapter-mattermost-0.0.5.tgz
```
