---
name: add-mattermost-rocky
description: Preserve and install the Spark appliance Rocky Mattermost channel instance.
---

# Rocky Mattermost instance for the Spark appliance

Install the second Mattermost adapter instance used by the Rocky agent. It
shares the first-party Mattermost package with the default instance and keeps
its own token and webhook route.

Copy the maintained instance module:

```nc:copy
payload/src/channels/mattermost-rocky.ts -> src/channels/mattermost-rocky.ts
```

Register the Rocky instance:

```nc:append to:src/channels/index.ts
import './mattermost-rocky.js';
```
