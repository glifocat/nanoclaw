---
name: add-web
description: Preserve and install the Spark appliance first-party web chat channel and SPA.
---

# Web channel for the Spark appliance

Install the appliance's first-party WebSocket channel and React SPA. This is
the live tailnet web surface with reconnect/replay, files, cards, PWA support,
and thread-backed conversation sessions.

Copy the maintained channel and UI payload:

```nc:copy
payload/src/channels/web.ts -> src/channels/web.ts
payload/src/channels/web-ui/.gitignore -> src/channels/web-ui/.gitignore
payload/src/channels/web-ui/index.html -> src/channels/web-ui/index.html
payload/src/channels/web-ui/package.json -> src/channels/web-ui/package.json
payload/src/channels/web-ui/package-lock.json -> src/channels/web-ui/package-lock.json
payload/src/channels/web-ui/src/App.tsx -> src/channels/web-ui/src/App.tsx
payload/src/channels/web-ui/src/components/ApprovalCard.tsx -> src/channels/web-ui/src/components/ApprovalCard.tsx
payload/src/channels/web-ui/src/components/Conversation.tsx -> src/channels/web-ui/src/components/Conversation.tsx
payload/src/channels/web-ui/src/components/Login.tsx -> src/channels/web-ui/src/components/Login.tsx
payload/src/channels/web-ui/src/components/Markdown.tsx -> src/channels/web-ui/src/components/Markdown.tsx
payload/src/channels/web-ui/src/components/Message.tsx -> src/channels/web-ui/src/components/Message.tsx
payload/src/channels/web-ui/src/components/PromptInput.tsx -> src/channels/web-ui/src/components/PromptInput.tsx
payload/src/channels/web-ui/src/components/TopBar.tsx -> src/channels/web-ui/src/components/TopBar.tsx
payload/src/channels/web-ui/src/components/TypingDots.tsx -> src/channels/web-ui/src/components/TypingDots.tsx
payload/src/channels/web-ui/src/index.css -> src/channels/web-ui/src/index.css
payload/src/channels/web-ui/src/main.tsx -> src/channels/web-ui/src/main.tsx
payload/src/channels/web-ui/src/types.ts -> src/channels/web-ui/src/types.ts
payload/src/channels/web-ui/src/useNanoclaw.ts -> src/channels/web-ui/src/useNanoclaw.ts
payload/src/channels/web-ui/src/vite-env.d.ts -> src/channels/web-ui/src/vite-env.d.ts
payload/src/channels/web-ui/tsconfig.app.json -> src/channels/web-ui/tsconfig.app.json
payload/src/channels/web-ui/tsconfig.json -> src/channels/web-ui/tsconfig.json
payload/src/channels/web-ui/tsconfig.node.json -> src/channels/web-ui/tsconfig.node.json
payload/src/channels/web-ui/vite.config.ts -> src/channels/web-ui/vite.config.ts
```

Register the web channel:

```nc:append to:src/channels/index.ts
import './web.js';
```
