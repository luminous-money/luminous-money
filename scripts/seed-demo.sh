#!/bin/sh
# Seed a demo book into a running stack: realistic history from bean-example, with recent
# purchases staged for review (services/ledger/src/ledger/demo.py), owned by the stub user.
#
#   pnpm seed                         book "demo" on http://localhost:8080
#   pnpm seed other --years 5         another book; extra options go to `python -m ledger.demo`
#   FAVA_BEANS_URL=http://pi:8080 pnpm seed
set -eu
cd "$(dirname "$0")/.."

book="${1:-demo}"
[ $# -gt 0 ] && shift
url="${FAVA_BEANS_URL:-http://localhost:8080}"
image="${FAVA_BEANS_REGISTRY:-fava-beans}/ledger:${FAVA_BEANS_VERSION:-dev}"

token=$(curl -fsS -X POST "$url/api/auth/v1/login" | sed -E 's/.*"token":"([^"]+)".*/\1/')
auth="authorization: Bearer $token"

# Importing twice would duplicate everything (the demo's IDs are new on every run).
if curl -fsS -H "$auth" "$url/api/ledger/v1/books" | grep -q "\"id\":\"$book\""; then
  echo "book '$book' already exists; pick another name" >&2
  exit 1
fi

docker run --rm "$image" python -m ledger.demo "$@" \
  | curl -fsS -X POST -H "$auth" -H "content-type: text/plain" --data-binary @- "$url/api/ledger/v1/books/$book/import"
echo
echo "Seeded '$book' for the stub user (log in with the Log in button)."
