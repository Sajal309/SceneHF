#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
  cat <<EOF
Error: Expected backend Python at $PYTHON_BIN

Create the repo virtualenv and install backend dependencies, then retry:
  cd "$ROOT_DIR"
  python3 -m venv .venv
  ./.venv/bin/pip install -r backend/requirements.txt
EOF
  exit 1
fi

if [ ! -f "$BACKEND_DIR/app/main.py" ]; then
  echo "Error: backend app entrypoint not found at $BACKEND_DIR/app/main.py"
  exit 1
fi

cd "$BACKEND_DIR"

UVICORN_ARGS=(
  app.main:app
  --host 127.0.0.1
  --port 8000
)

if [ "${SCENEHF_BACKEND_RELOAD:-0}" = "1" ]; then
  UVICORN_ARGS+=(
    --reload
    --reload-dir "$BACKEND_DIR/app"
  )
  echo "Starting backend with auto-reload enabled (watching $BACKEND_DIR/app)"
else
  echo "Starting backend with auto-reload disabled (set SCENEHF_BACKEND_RELOAD=1 to enable)"
fi

exec "$PYTHON_BIN" -m uvicorn "${UVICORN_ARGS[@]}"
