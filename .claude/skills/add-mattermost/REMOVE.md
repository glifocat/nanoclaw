# Remove Mattermost Channel

1. Comment out `import './mattermost.js'` in `src/channels/index.ts`
2. Remove `MATTERMOST_BASE_URL`, `MATTERMOST_BOT_TOKEN`, `MATTERMOST_CALLBACK_URL` and
   `MATTERMOST_CALLBACK_SECRET` from `.env`
3. `pnpm uninstall @nanoco/chat-adapter-mattermost`
4. Rebuild and restart
