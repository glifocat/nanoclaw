#!/usr/bin/env bash
#
# Start the NanoClaw dashboard.
#
# Binds to 127.0.0.1 by default (set NCL_DASH_HOST to a tailnet/LAN IP
# to reach it from other devices — never 0.0.0.0). Picks port 8787
# unless already taken, then walks upward to the next free port.
#
# Env overrides:
#   NCL_DASH_HOST  bind address        (default 127.0.0.1)
#   NCL_DASH_PORT  preferred port      (default 8787)
#   NCL_BIN        path to ncl binary  (default <repo>/bin/ncl)

set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${NCL_DASH_HOST:-127.0.0.1}"
PORT="${NCL_DASH_PORT:-8787}"

port_free() {
  ! (ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | awk '{print $4}' | grep -qE "[:.]$1\$"
}

while ! port_free "$PORT"; do
  echo "[nanoclaw-dashboard] port $PORT taken, trying $((PORT + 1))" >&2
  PORT=$((PORT + 1))
  if [ "$PORT" -gt 8887 ]; then
    echo "[nanoclaw-dashboard] no free port found in 8787-8887" >&2
    exit 1
  fi
done

export NCL_DASH_HOST="$HOST"
export NCL_DASH_PORT="$PORT"
exec node "$SCRIPT_DIR/server.js"
