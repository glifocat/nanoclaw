# NanoClaw Operator Dashboard

A single-page web console for operating a live NanoClaw v2 instance from the
operator's tailnet browser. Zero npm dependencies — a thin `node:http` server
that shells out to the `ncl` admin CLI (`--json`) for every read and mutation,
so all business logic and validation stay inside NanoClaw itself.

## Files

| File | Purpose |
|------|---------|
| `server.js` | HTTP bridge: bearer auth, allowlisted `ncl` subprocess calls via `execFile` |
| `index.html` | Self-contained SPA (inline CSS/JS, no CDN) served at `/` |
| `start.sh` | Starts the server; picks port 8787 unless taken (walks up to 8887) |
| `nanoclaw-dashboard.service.template` | systemd **user** unit (placeholders filled at install) |
| `test/smoke.test.mjs` | self-contained smoke test (stub ncl; auth + allowlist behavior) |
| `.token` | Bearer token, auto-generated at first start (chmod 600, gitignored) |

## Security model

- Binds **only** to a private interface (`127.0.0.1` by default; set
  `NCL_DASH_HOST` to a tailnet/LAN IP to reach it from other devices) —
  never `0.0.0.0`.
- Every `/api/*` request requires `Authorization: Bearer <token>`. The token is
  generated at first start (`crypto.randomBytes(32)`), persisted to
  `dashboard/.token` with mode 600. The login screen stores it in
  `localStorage` and sends it on every request.
- Mutations are `POST /api/ncl {resource, verb, args}`; resource+verb are
  validated against a hard allowlist mirroring the ncl surface, arg keys must
  match `^[a-z][a-z0-9-]*$`, values may not start with `--`, and everything is
  passed to `execFile` as an argv array — **no shell interpolation, ever**.
- This dashboard can control the whole assistant. Treat the token like a root
  credential.

## Run it

```bash
bash dashboard/start.sh                 # foreground
cat dashboard/.token                    # token to paste into the login screen
# open http://<bind-host>:8787
```

Phone tip: open `http://<bind-host>:8787/#token=<token>` once — the page
stores the token in `localStorage` and strips it from the URL (the fragment
never reaches the server), so you don't have to paste 64 hex chars on a
touch keyboard.

Env overrides: `NCL_DASH_HOST`, `NCL_DASH_PORT`, `NCL_BIN` (default
`<repo>/bin/ncl`, resolved relative to this directory — set it explicitly if
the dashboard directory lives outside the checkout it should operate).

## Install as a systemd user service (Linux)

```bash
mkdir -p ~/.config/systemd/user
sed -e "s|__NANOCLAW_DIR__|$(pwd)|g" \
    -e "s|__BIND_HOST__|127.0.0.1|g" \
    -e "s|__NODE_DIR__|$(dirname "$(command -v node)")|g" \
    dashboard/nanoclaw-dashboard.service.template \
    > ~/.config/systemd/user/nanoclaw-dashboard.service
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-dashboard
systemctl --user status nanoclaw-dashboard
loginctl enable-linger "$USER"    # keep it running after logout (if not already)
```

Logs: `journalctl --user -u nanoclaw-dashboard -f`

## API

- `GET /` — the app (no auth; contains the login screen).
- `GET /api/health` — auth check + liveness.
- `GET /api/list/<resource>` — `ncl <resource> list --json`.
- `POST /api/ncl` — `{"resource":"groups","verb":"config update","args":{"id":"…","model":"…"}}`
  → `ncl groups config update --id … --model … --json`. Boolean `true` args
  become bare flags (e.g. `"rebuild": true` → `--rebuild`).

Responses are the raw ncl JSON frame (`{id, ok, data|error}`) plus a `cmd`
field showing the exact command that ran (surfaced in UI toasts).

## UI

- **Full mobile parity** — below 900px the sidebar becomes a bottom tab bar
  (Overview / Topology / Sessions / Approvals / More-sheet); below 700px
  tables render as cards, the detail drawer and forms become bottom sheets,
  and a floating action button creates the current resource. Touch targets
  are ≥ 44px; inputs are 16px on touch to avoid iOS zoom.
- **Light + dark themes** (system default, manual toggle, both WCAG AA),
  `prefers-reduced-motion` respected, keyboard navigable (sortable headers,
  focusable rows, Escape closes layers, focus restore on dialog close).
- **Glanceable overview** — health headline + three tiles (agents awake,
  approvals waiting, dropped messages) render before the slower
  `ncl sessions list` finishes; live views auto-refresh every 8s ("Live"
  pill toggle).
- The topology view pans by scroll/drag and has zoom controls; edges and
  nodes are tappable and open the matching detail sheet.

## Coverage

Nearly the full CRUD surface of the ncl CLI: groups (incl. `create
--template` stamping, container config scalars, MCP servers add/remove,
apt/npm packages add/remove, restart with `--rebuild`/`--message`),
messaging-groups (incl. `send` — inject a test message through the live
router as an arbitrary sender label), wirings (incl. per-wiring
`--threads`/`--priority` overrides), tasks (all 10 verbs: list, get, create,
update, cancel, pause, resume, run, append-log, delete — the Tasks screen
covers everything but append-log, which is meant for agents mid-run), users,
roles, members, destinations, policies; read-only: sessions, approvals,
dropped-messages, user-dms. Plus an SVG topology view (messaging groups →
wirings → agent groups → destination ACL edges) and auto-refresh on live
views (sessions, approvals, dropped messages).

Deliberately excluded from the server allowlist:
- `groups config add-mount` / `config remove-mount` — their `hostOnly` flag
  only denies container callers, and the dashboard invokes ncl as a host
  caller, so allowlisting them would let a leaked bearer token edit
  host-filesystem mounts. Edit mounts with `ncl` on the host instead (and
  remember the hostPath must also be listed in
  `~/.config/nanoclaw/mount-allowlist.json` or the container spawn is
  rejected).

Notes:
- `get`-by-id uses `--id <id>` (positional targets break for IDs containing
  dashes — the dispatcher's fallback only trims one dash segment).
- Approvals are read-only by design: `ncl` exposes no approve/reject verb;
  respond to approval cards from the messaging channel.
- **The dashboard bypasses ncl's approval flow.** Every mutating
  groups/messaging-groups/wirings/users/roles/members/destinations/policies
  verb is `access=approval` in ncl, but HOST callers (this dashboard's `ncl`
  subprocess) skip the approval hold entirely (`src/cli/guard.ts`) — dashboard
  mutations apply immediately, with no approval card to anyone. tasks verbs
  are `access=open` even for delete. This is why the token must be treated as
  a root credential over the fleet.
- Timeouts: `restart`, `config add-package` and `config remove-package` get a
  300s ceiling (they can rebuild the container image); everything else 60s.
  Container-config changes only take effect after `groups restart` (package
  changes need restart with `--rebuild`).
- All `--json` verbs worked against NanoClaw 2.1.53, so the documented
  read-only sqlite fallback (SELECTs on `data/v2.db`) was not needed and is
  not wired in. (`wirings create` auto-provisions the companion
  agent_destinations row since 2.1.42, so the dashboard no longer carries the
  old #2389 destination workaround — the provision path keeps a pure
  idempotence backstop.)
