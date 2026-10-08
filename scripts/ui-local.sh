#!/bin/sh
# Run the browser suite against an already-running stack, in Playwright's image so no browsers
# need installing on the host. FAVA_BEANS_URL defaults to http://localhost:8080.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'require("./tests/ui/node_modules/@playwright/test/package.json").version')
exec docker run --rm --network host --ipc=host -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -e FAVA_BEANS_URL="${FAVA_BEANS_URL:-http://localhost:8080}" \
  -v "$PWD":/repo -w /repo/tests/ui "mcr.microsoft.com/playwright:v$version-noble" npx playwright test
