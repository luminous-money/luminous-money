#!/bin/sh
# Run the end-to-end suite against a throwaway copy of the stack: its own project name, fresh
# volumes, no published ports. To run the suite against an already-running stack instead, use
# `pnpm e2e:local` (FAVA_BEANS_URL, default http://localhost:8080).
set -u
cd "$(dirname "$0")/.."

docker buildx bake default e2e || exit 1

compose="docker compose -p fava-beans-e2e -f compose.yaml -f compose.e2e.yaml"
$compose up --attach e2e --exit-code-from e2e
status=$?
$compose down --volumes --remove-orphans >/dev/null 2>&1
exit $status
