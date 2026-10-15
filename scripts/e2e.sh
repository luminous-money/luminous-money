#!/bin/sh
# Run the end-to-end suites (API, then browser) against a throwaway copy of the stack: its own
# project name, fresh volumes, no published ports. To run them against an already-running stack
# instead, use `pnpm e2e:local` (FAVA_BEANS_URL, default http://localhost:8080).
set -u
cd "$(dirname "$0")/.."

docker buildx bake default e2e ui-tests || exit 1

compose="docker compose -p fava-beans-e2e -f compose.yaml -f compose.e2e.yaml"
$compose up -d traefik auth ledger app mailpit || exit 1
$compose run --rm e2e
api=$?
$compose run --rm ui
ui=$?
$compose down --volumes --remove-orphans >/dev/null 2>&1

echo "API suite: $([ $api -eq 0 ] && echo passed || echo FAILED); browser suite: $([ $ui -eq 0 ] && echo passed || echo FAILED)"
[ $api -eq 0 ] && [ $ui -eq 0 ]
