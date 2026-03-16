#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not on PATH."
  exit 1
fi

if [ ! -f "$FRONTEND_DIR/package.json" ]; then
  echo "Error: frontend package.json not found at $FRONTEND_DIR/package.json"
  exit 1
fi

cd "$FRONTEND_DIR"

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

FRONTEND_MODE="${SCENEHF_FRONTEND_MODE:-preview}"

if [ "$FRONTEND_MODE" = "dev" ]; then
  export SCENEHF_DISABLE_HMR="${SCENEHF_DISABLE_HMR:-1}"
  if [ "$SCENEHF_DISABLE_HMR" = "1" ]; then
    echo "Starting frontend DEV mode with auto-refresh disabled (set SCENEHF_DISABLE_HMR=0 to enable HMR)"
  else
    echo "Starting frontend DEV mode with HMR enabled"
  fi
  exec npm run dev -- "$@"
fi

if [ "$FRONTEND_MODE" != "preview" ]; then
  echo "Error: Unsupported SCENEHF_FRONTEND_MODE='$FRONTEND_MODE' (use 'preview' or 'dev')"
  exit 1
fi

if [ ! -f "$FRONTEND_DIR/dist/index.html" ] || [ "${SCENEHF_FRONTEND_REBUILD:-0}" = "1" ]; then
  echo "Building frontend for stable preview mode..."
  npm run build
fi

echo "Starting frontend PREVIEW mode (stable, no HMR/watch). Set SCENEHF_FRONTEND_MODE=dev for development."
exec npm run preview -- --host 127.0.0.1 --port 5174 --strictPort "$@"
