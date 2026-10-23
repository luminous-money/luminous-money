#!/bin/sh
# Render the PWA's PNG icons from services/app/public/icon.svg (services/app/scripts/icons.mjs),
# in the browser-test image, which has Chromium (`pnpm build` makes it: docker buildx bake
# ui-tests).
set -eu
cd "$(dirname "$0")/.."
exec docker run --rm --ipc=host -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD/services/app/public:/icons" -v "$PWD/services/app/scripts/icons.mjs:/repo/tests/ui/icons.mjs:ro" \
  -w /repo/tests/ui "${LUMINOUS_MONEY_REGISTRY:-luminous-money}/ui-tests:${LUMINOUS_MONEY_VERSION:-dev}" \
  node icons.mjs /icons
