#!/bin/sh
# Our Dialogues Reader launcher for macOS / Linux.
# Same behavior as Start Reader.bat: a dependency-free Node static server on a
# FIXED port (the IndexedDB text library is scoped to host+port, so hopping
# ports would open an empty library), plus best-effort browser opening.
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org and run this again."
  exit 1
fi

PORT="${OUR_DIALOGUES_PORT:-4173}"
URL="http://127.0.0.1:${PORT}/"

# --open only knows Windows; open the browser from here instead.
(
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" # Linux
  else echo "Open ${URL} in your browser."
  fi
) &

exec node tools/serve-reader.mjs
