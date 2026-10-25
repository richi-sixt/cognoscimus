#!/bin/bash
# Pull, install and build. Restarting the server process is done separately.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm --filter @cognoscimus/web setup-vendors
pnpm --filter @cognoscimus/web build-web
echo "Build done."
