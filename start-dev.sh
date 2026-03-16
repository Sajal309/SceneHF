#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_SCRIPT="$ROOT_DIR/start-backend.sh"
FRONTEND_SCRIPT="$ROOT_DIR/start-frontend.sh"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_HOST="127.0.0.1"
FRONTEND_PORT="5174"
BACKEND_URL="http://$BACKEND_HOST:$BACKEND_PORT"
FRONTEND_URL="http://$FRONTEND_HOST:$FRONTEND_PORT"
BACKEND_HEALTH_URL="$BACKEND_URL/health"
BACKEND_HEALTH_TIMEOUT_SECONDS="45"
BACKEND_HEALTH_POLL_SECONDS="0.5"
FRONTEND_START_TIMEOUT_SECONDS="30"

die() {
  echo "Error: $*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Missing required command '$1'."
  fi
}

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

check_backend_health() {
  curl -fsS --max-time 2 "$BACKEND_HEALTH_URL" >/dev/null
}

check_frontend_http() {
  curl -fsS --max-time 2 "$FRONTEND_URL" >/dev/null
}

shell_quote() {
  printf '%q' "$1"
}

escape_applescript_string() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s' "$value"
}

manual_commands() {
  cat <<EOF
Manual fallback commands:
  Backend:  cd "$ROOT_DIR" && SCENEHF_BACKEND_RELOAD=0 ./start-backend.sh
  Frontend: cd "$ROOT_DIR" && SCENEHF_FRONTEND_MODE=preview ./start-frontend.sh
EOF
}

open_terminal_and_run() {
  local command="$1"
  local escaped
  escaped="$(escape_applescript_string "$command")"

  osascript >/dev/null <<EOF
tell application "Terminal"
  activate
  do script "$escaped"
end tell
EOF
}

wait_for_backend_health() {
  local timeout="$1"
  local start
  start="$(date +%s)"

  while true; do
    if check_backend_health; then
      return 0
    fi

    if [ $(( $(date +%s) - start )) -ge "$timeout" ]; then
      return 1
    fi

    sleep "$BACKEND_HEALTH_POLL_SECONDS"
  done
}

wait_for_frontend_start() {
  local timeout="$1"
  local start
  start="$(date +%s)"

  while true; do
    if is_port_listening "$FRONTEND_PORT" && check_frontend_http; then
      return 0
    fi

    if [ $(( $(date +%s) - start )) -ge "$timeout" ]; then
      return 1
    fi

    sleep "$BACKEND_HEALTH_POLL_SECONDS"
  done
}

backend_status="reused"

require_cmd curl
require_cmd lsof
require_cmd npm
require_cmd osascript

[ -x "$PYTHON_BIN" ] || die "Expected backend Python at $PYTHON_BIN. Create .venv and install backend requirements first."
[ -f "$BACKEND_DIR/app/main.py" ] || die "Missing backend entrypoint at $BACKEND_DIR/app/main.py"
[ -f "$FRONTEND_DIR/package.json" ] || die "Missing frontend package.json at $FRONTEND_DIR/package.json"
[ -x "$BACKEND_SCRIPT" ] || die "Missing executable $BACKEND_SCRIPT"
[ -x "$FRONTEND_SCRIPT" ] || die "Missing executable $FRONTEND_SCRIPT"

if is_port_listening "$FRONTEND_PORT"; then
  die "Frontend port $FRONTEND_PORT is already in use. Stop the process on $FRONTEND_PORT and retry."
fi

if check_backend_health; then
  echo "Reusing existing backend at $BACKEND_URL"
elif is_port_listening "$BACKEND_PORT"; then
  cat <<EOF >&2
Error: Port $BACKEND_PORT is in use, but $BACKEND_HEALTH_URL did not respond successfully.
This usually means another process is using the backend port.
EOF
  manual_commands >&2
  exit 1
else
  backend_status="started"
  backend_terminal_cmd="cd $(shell_quote "$ROOT_DIR") && ./start-backend.sh"
  echo "Starting backend in a new Terminal window..."
  if ! open_terminal_and_run "$backend_terminal_cmd"; then
    cat <<EOF >&2
Error: Failed to open Terminal for backend startup (macOS automation may be blocked).
EOF
    manual_commands >&2
    exit 1
  fi

  echo "Waiting for backend health at $BACKEND_HEALTH_URL ..."
  if ! wait_for_backend_health "$BACKEND_HEALTH_TIMEOUT_SECONDS"; then
    cat <<EOF >&2
Error: Backend did not become healthy within ${BACKEND_HEALTH_TIMEOUT_SECONDS}s.
Expected health endpoint: $BACKEND_HEALTH_URL
Backend launch command:
  cd "$ROOT_DIR" && SCENEHF_BACKEND_RELOAD=0 ./start-backend.sh
EOF
    manual_commands >&2
    exit 1
  fi
fi

if is_port_listening "$FRONTEND_PORT"; then
  die "Frontend port $FRONTEND_PORT became occupied before launch. Stop the process on $FRONTEND_PORT and retry."
fi

frontend_terminal_cmd="cd $(shell_quote "$ROOT_DIR") && ./start-frontend.sh"
echo "Starting frontend in a new Terminal window..."
if ! open_terminal_and_run "$frontend_terminal_cmd"; then
  cat <<EOF >&2
Error: Failed to open Terminal for frontend startup (macOS automation may be blocked).
EOF
  manual_commands >&2
  exit 1
fi

echo "Waiting for frontend at $FRONTEND_URL ..."
if ! wait_for_frontend_start "$FRONTEND_START_TIMEOUT_SECONDS"; then
  cat <<EOF >&2
Error: Frontend did not become reachable within ${FRONTEND_START_TIMEOUT_SECONDS}s.
Expected frontend URL: $FRONTEND_URL
Frontend launch command:
  cd "$ROOT_DIR" && SCENEHF_FRONTEND_MODE=preview ./start-frontend.sh

Check the newly opened Terminal tab/window for the Vite error output.
EOF
  manual_commands >&2
  exit 1
fi

echo
echo "SceneHF dev environment is ready."
echo "Backend:  $BACKEND_URL ($backend_status)"
echo "Frontend: $FRONTEND_URL"
echo "Frontend auto-connects to the backend via the Vite /api proxy."
