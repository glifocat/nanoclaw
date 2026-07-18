# Remove /add-operator-dashboard

Reverses everything the skill's apply steps left behind.

## 1. Stop and remove the systemd user service (if step 5 was applied)

```bash
systemctl --user disable --now nanoclaw-dashboard 2>/dev/null || true
rm -f ~/.config/systemd/user/nanoclaw-dashboard.service
systemctl --user daemon-reload
```

## 2. Kill any foreground/nohup instance

```bash
pkill -f 'dashboard/server.js' 2>/dev/null || true
```

## 3. Delete the dashboard directory

This also deletes the bearer token (`dashboard/.token`) — any browser that
stored it in `localStorage` loses access permanently.

```bash
rm -rf dashboard
```

Nothing else was touched: no NanoClaw source changes, no dependencies, no DB
rows.
