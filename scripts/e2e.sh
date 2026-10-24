#!/bin/sh
# Run the end-to-end suites (API, then browser) against a throwaway copy of the stack: its own
# project name, fresh volumes, no published ports. Then the `luminous-money` command's own test
# (scripts/cli-test.sh), on another throwaway deployment. To run the suites against an
# already-running stack instead, use `pnpm e2e:local` (LUMINOUS_MONEY_URL, default
# http://localhost:8080).
set -u
cd "$(dirname "$0")/.."

docker buildx bake default e2e ui-tests simplefin-fake || exit 1

compose="docker compose -p luminous-money-e2e -f compose.yaml -f compose.e2e.yaml"
$compose up -d --wait traefik auth ledger app ai mailpit simplefin-fake || exit 1
$compose run --rm e2e
api=$?
# The browser suite keeps its container until its failures' traces and page snapshots are copied
# out (tests/ui/test-results), so a failure can be looked at instead of guessed at.
docker rm -f luminous-money-e2e-ui >/dev/null 2>&1
$compose run --name luminous-money-e2e-ui ui
ui=$?
if [ $ui -ne 0 ]; then
  rm -rf tests/ui/test-results
  docker cp luminous-money-e2e-ui:/repo/tests/ui/test-results tests/ui/test-results >/dev/null 2>&1 &&
    echo "The browser failures' traces and snapshots: tests/ui/test-results"
fi
docker rm luminous-money-e2e-ui >/dev/null 2>&1
$compose down --volumes --remove-orphans >/dev/null 2>&1
./scripts/cli-test.sh >/tmp/luminous-money-cli-test.log 2>&1
cli=$?
[ $cli -eq 0 ] || tail -40 /tmp/luminous-money-cli-test.log

echo "API suite: $([ $api -eq 0 ] && echo passed || echo FAILED); browser suite: $([ $ui -eq 0 ] && echo passed || echo FAILED); command: $([ $cli -eq 0 ] && echo passed || echo FAILED)"
[ $api -eq 0 ] && [ $ui -eq 0 ] && [ $cli -eq 0 ]
