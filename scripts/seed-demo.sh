#!/bin/sh
# Seed a demo book into a running stack: realistic history from bean-example, with recent
# purchases staged for review (services/ledger/src/ledger/demo.py). The default also seeds a
# small second book, "Demo Household" (`--household`), to switch to. The books go to whoever
# LUMINOUS_MONEY_TOKEN belongs to: make an API token on the "Your account" page.
#
#   LUMINOUS_MONEY_TOKEN=lm_... pnpm seed
#   pnpm seed                         books "demo" and "demo-household" on http://localhost:8080
#   pnpm seed other --years 5         another book; extra options go to `python -m ledger.demo`
#   LUMINOUS_MONEY_URL=http://pi:8080 pnpm seed
set -eu
cd "$(dirname "$0")/.."

book="${1:-demo}"
[ $# -gt 0 ] && shift
url="${LUMINOUS_MONEY_URL:-http://localhost:8080}"
image="${LUMINOUS_MONEY_REGISTRY:-luminous-money}/ledger:${LUMINOUS_MONEY_VERSION:-dev}"

if [ -z "${LUMINOUS_MONEY_TOKEN:-}" ]; then
  echo "set LUMINOUS_MONEY_TOKEN to an API token (Your account → API tokens) for the account to seed" >&2
  exit 1
fi
auth="authorization: Bearer $LUMINOUS_MONEY_TOKEN"

tz="${LUMINOUS_MONEY_TZ:-$(cat /etc/timezone 2>/dev/null || echo UTC)}"

# seed BOOK STARRED-ACCOUNTS [demo options...]: import the generated book, star the accounts the
# home page shows, and set its time zone (what "today" is for schedules and the price run).
seed() {
  id="$1"; starred="$2"; shift 2
  # Importing twice would duplicate everything (the demo's IDs are new on every run).
  if curl -fsS -H "$auth" "$url/api/ledger/v1/books" | grep -q "\"id\":\"$id\""; then
    echo "book '$id' already exists; skipped (pass another name for a new one)" >&2
    return 0
  fi
  docker run --rm "$image" python -m ledger.demo "$@" \
    | curl -fsS -X POST -H "$auth" -H "content-type: text/plain" --data-binary @- "$url/api/ledger/v1/books/$id/import"
  echo
  for account in $starred; do
    curl -fsS -X PUT -H "$auth" "$url/api/app/v1/books/$id/stars/$account" >/dev/null
  done
  curl -fsS -X PUT -H "$auth" -H "content-type: application/json" \
    --data "{\"time_zone\": \"$tz\"}" "$url/api/app/v1/books/$id/settings" >/dev/null
  echo "Seeded '$id'."
}

# The demo's checking account, card and brokerage (demo.STARRED, and the ETrade brokerage).
seed "$book" "Assets:US:BofA:Checking Liabilities:US:Chase:Slate Assets:US:ETrade" "$@"
if [ "$book" = demo ]; then
  seed demo-household "Assets:Bank:Joint-Checking" --household  # demo.HOUSEHOLD_STARRED
fi
