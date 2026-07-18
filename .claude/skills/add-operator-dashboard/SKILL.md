---
name: add-operator-dashboard
description: Add a mutating web operator console for NanoClaw — a zero-dependency single-page app over the ncl admin CLI with bearer-token auth. Full CRUD on groups, wirings, messaging groups, users, roles, members, destinations, policies, and scheduled tasks (run/pause/resume), plus a topology view and full mobile parity. Distinct from the read-only /add-clidash and the snapshot-pusher /add-dashboard.
---

# /add-operator-dashboard — mutating web console over `ncl`

A single-page operator console for a live NanoClaw instance. Zero npm
dependencies: a thin `node:http` server that shells out to the `ncl` admin CLI
(`--json`) for every read and mutation, so all business logic and validation
stay inside NanoClaw itself. The SPA is one self-contained HTML file (inline
CSS/JS, no CDN) with light/dark themes, an SVG topology view, and full mobile
parity.

**How it differs from the other dashboard skills:**

| Skill | Nature |
|-------|--------|
| `/add-clidash` | Read-only, no auth (network is the boundary) |
| `/add-dashboard` | Pushes JSON snapshots to a separate npm package |
| **this** | **Mutating operator console** — full CRUD + tasks + bearer-token auth |

## ⚠️ Security model — read before installing

- **The bearer token is a root credential over the whole assistant.** Every
  mutating verb the dashboard exposes is executed by `ncl` as a HOST caller,
  which **bypasses ncl's approval flow** (`src/cli/guard.ts`): dashboard
  mutations apply immediately, with no approval card to anyone.
- Auth: every `/api/*` request requires `Authorization: Bearer <token>`. The
  token is generated at first start (`crypto.randomBytes(32)`) and persisted to
  `dashboard/.token` (mode 600, gitignored).
- Binds `127.0.0.1` by default. To use it from other devices, bind a
  **private** interface (a tailnet IP is the intended deployment) — never
  `0.0.0.0`, and never a public interface.
- Injection surface: resource+verb are validated against a hard allowlist
  mirroring the ncl surface, arg keys must match `^[a-z][a-z0-9-]*$`, values
  may not start with `--`, and everything goes to `execFile` as an argv
  array — no shell interpolation.
- `groups config add-mount` / `remove-mount` are **deliberately excluded** from
  the allowlist: a leaked token must not grant host-filesystem mount edits.

## Steps

### 1. Copy the tool into place

The dashboard is fully self-contained — copy the whole directory in:

```bash
cp -R .claude/skills/add-operator-dashboard/add/dashboard dashboard
```

That is the only file change this skill makes. Nothing in NanoClaw `src/` is
touched, no dependency is added, no build step exists.

### 2. Run the smoke test

Verifies auth enforcement and allowlist behavior against a stub `ncl` — no
live instance is touched:

```bash
node dashboard/test/smoke.test.mjs
```

Expect `smoke: all N checks passed`.

### 3. Choose a bind address

Default is `127.0.0.1` (same-machine browser or SSH tunnel only). To reach it
from a phone/laptop, bind a private interface. If Tailscale is present, offer
the tailnet IP:

```bash
tailscale ip -4 2>/dev/null   # if this prints an IP, it's the recommended bind
```

Ask the user which to use. Never suggest `0.0.0.0` or a public IP.

### 4. First run + token

```bash
NCL_DASH_HOST=<bind-host> bash dashboard/start.sh   # foreground; picks port 8787+
cat dashboard/.token
```

Open `http://<bind-host>:8787` and paste the token into the login screen.
The NanoClaw host service must be running (the dashboard talks to `ncl`, which
needs the host's socket).

### 5. (Optional, Linux) Install as a systemd user service

```bash
mkdir -p ~/.config/systemd/user
sed -e "s|__NANOCLAW_DIR__|$(pwd)|g" \
    -e "s|__BIND_HOST__|<bind-host>|g" \
    -e "s|__NODE_DIR__|$(dirname "$(command -v node)")|g" \
    dashboard/nanoclaw-dashboard.service.template \
    > ~/.config/systemd/user/nanoclaw-dashboard.service
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-dashboard
loginctl enable-linger "$USER"    # keep it running after logout
```

On macOS there is no unit template — run `dashboard/start.sh` under your
preferred supervisor (launchd plist, tmux, `nohup`).

### 6. Verify

```bash
curl -fsS http://<bind-host>:<port>/api/health                        # 200
curl -s -o /dev/null -w '%{http_code}\n' http://<bind-host>:<port>/api/list/groups   # 401 (no token)
curl -fsS -H "Authorization: Bearer $(cat dashboard/.token)" \
  http://<bind-host>:<port>/api/list/groups                           # live groups JSON
```

## Usage

See `dashboard/README.md` for the full API, UI feature list, coverage notes,
and env overrides (`NCL_DASH_HOST`, `NCL_DASH_PORT`, `NCL_BIN`).

Phone tip: open `http://<bind-host>:<port>/#token=<token>` once — the page
stores the token in `localStorage` and strips it from the URL (the fragment
never reaches the server).

## Troubleshooting

- **401 with the right token** — the SPA caches the token in `localStorage`;
  if you regenerated `.token` (deleted it), log out and paste the new one.
- **`ncl` errors / empty tables** — the dashboard resolves `ncl` as
  `<repo>/bin/ncl` relative to its own directory. If `dashboard/` lives
  outside the checkout, set `NCL_BIN` explicitly. The NanoClaw host service
  must be running for `ncl` to answer.
- **Port isn't 8787** — `start.sh` walks 8787→8887 to the first free port; the
  bound port is in the startup log line and `/api/health`.
- **Nothing reachable from other devices** — the bind host is `127.0.0.1`;
  reinstall the unit (or set `NCL_DASH_HOST`) with a tailnet/LAN IP.
- **A mutation you expected an approval card for applied silently** — that's
  by design; see the security model above. Guard the token accordingly.
