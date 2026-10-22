#!/bin/sh
# Run the end-to-end suites (API, then browser) against a throwaway copy of the stack: its own
# project name, fresh volumes, no published ports. Then the `fava-beans` command's own test
# (scripts/cli-test.sh), on another throwaway deployment. To run the suites against an
# already-running stack instead, use `pnpm e2e:local` (FAVA_BEANS_URL, default
# http://localhost:8080).
set -u
cd "$(dirname "$0")/.."

docker buildx bake default e2e ui-tests simplefin-fake || exit 1

compose="docker compose -p fava-beans-e2e -f compose.yaml -f compose.e2e.yaml"
$compose up -d --wait traefik auth ledger app ai mailpit simplefin-fake || exit 1
$compose run --rm e2e
api=$?
$compose run --rm ui
ui=$?
$compose down --volumes --remove-orphans >/dev/null 2>&1
./scripts/cli-test.sh >/tmp/fava-beans-cli-test.log 2>&1
cli=$?
[ $cli -eq 0 ] || tail -40 /tmp/fava-beans-cli-test.log

echo "API suite: $([ $api -eq 0 ] && echo passed || echo FAILED); browser suite: $([ $ui -eq 0 ] && echo passed || echo FAILED); command: $([ $cli -eq 0 ] && echo passed || echo FAILED)"
[ $api -eq 0 ] && [ $ui -eq 0 ] && [ $cli -eq 0 ]
