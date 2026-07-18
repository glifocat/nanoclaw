# Remove /add-operator-dashboard

Reverses everything the skill's apply steps left behind.

## 1. Stop and remove the systemd user service (if step 5 was applied)

Run from the repo root (the unit name carries the install slug):

```bash
source setup/lib/install-slug.sh
UNIT="nanoclaw-dashboard-$(_nanoclaw_install_slug)"
systemctl --user disable --now "$UNIT" 2>/dev/null || true
rm -f ~/.config/systemd/user/"$UNIT".service
systemctl --user daemon-reload
```

(Installs made before the slug-suffixed naming used plain
`nanoclaw-dashboard.service` — check for and remove that name too.)

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
