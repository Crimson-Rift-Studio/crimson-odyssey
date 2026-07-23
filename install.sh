#!/usr/bin/env sh
set -eu

REPOSITORY="${CRIMSON_REPOSITORY:-github:aabrur/crimson-odyssey#main}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required. Current version: $(node --version)" >&2
  exit 1
fi

if [ -f "$SCRIPT_DIR/package.json" ]; then
  npm install -g "$SCRIPT_DIR"
else
  npm install -g "$REPOSITORY"
fi

crimson --version
echo "Installed. Run: crimson setup"
