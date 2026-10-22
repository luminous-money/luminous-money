#!/bin/sh
# The `fava-beans` command, end to end, against images built here (`pnpm build`): install a
# deployment from this checkout into a scratch directory, under its own project and port, then
# its health, a sign-up, a backup, a restore (what came after the backup is gone), an upgrade,
# the report (its secrets hidden), and the settings check. Cleans up after itself. Run by
# `pnpm e2e`; on its own, `pnpm test:cli`.
set -eu
cd "$(dirname "$0")/.."

project=fava-beans-clitest
port=${CLI_TEST_PORT:-18080}
base="http://127.0.0.1:$port"
work=$(mktemp -d)
home="$work/home"
cli="$home/fava-beans"

cleanup() {
  docker compose -p "$project" -f compose.yaml down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() {
  echo "cli-test: $*" >&2
  exit 1
}
step() { echo "cli-test: $*"; }

step "install"
scripts/fava-beans install --dir "$home" --from . --name "$project" --port "$port" --bind 127.0.0.1 --yes
[ -x "$cli" ] || fail "install didn't copy the command into the deployment"
[ "$(stat -c %a "$home/.env" 2>/dev/null || stat -f %Lp "$home/.env")" = 600 ] || fail ".env isn't private"
# No outside calls in a test: breached-password checks off.
echo "AUTH_BREACHED_PASSWORDS=false" >>"$home/.env"
"$cli" up >/dev/null

step "health"
curl -fsS "$base/api/health" | grep -q '"status":"ok"' || fail "the stack isn't healthy"
"$cli" status | grep -q "ledger   up" || fail "status doesn't show the services' health"

step "sign up, and a book"
token=$(curl -fsS -H 'content-type: application/json' "$base/api/auth/v1/signup" \
  -d '{"name":"Cli Test","email":"cli@test.local","password":"a long enough test passphrase","delivery":"body"}' |
  sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$token" ] || fail "couldn't sign up"
book() {
  curl -fsS -H "authorization: Bearer $token" -H 'content-type: application/json' \
    "$base/api/ledger/v1/books" -d "{\"name\":\"$1\"}" >/dev/null
}
books() { curl -fsS -H "authorization: Bearer $token" "$base/api/ledger/v1/books"; }
book Before

step "backup"
"$cli" backup --keep 5 >/dev/null
backup=$(ls -1 "$home"/backups/fava-beans-*.tar.gz | tail -1)
[ -f "$backup" ] || fail "no backup"
gzip -dc "$backup" | tar -tf - | grep -q '^data/ledger.sqlite$' || fail "the backup has no ledger"
gzip -dc "$backup" | tar -tf - | grep -q '^\.env$' || fail "the backup has no settings"

step "restore"
book After
books | grep -q '"After"' || fail "the second book wasn't made"
"$cli" restore "$backup" --yes >/dev/null
books | grep -q '"Before"' || fail "restoring lost what the backup had"
if books | grep -q '"After"'; then fail "restoring kept what came after the backup"; fi

step "upgrade"
"$cli" upgrade dev --from . | grep -q "Now on dev" || fail "upgrade didn't finish"
[ "$(ls -1 "$home"/backups/fava-beans-*.tar.gz | wc -l | tr -d ' ')" = 2 ] || fail "upgrade didn't back up first"

step "report and config"
(cd "$home" && ./fava-beans report --since 1h >/dev/null)
report=$(ls -1 "$home"/fava-beans-report-*.tar.gz | tail -1)
key=$(awk -F= '$1 == "SIMPLEFIN_ENCRYPTION_KEY" { sub(/^[^=]*=/, ""); print }' "$home/.env")
gzip -dc "$report" | tar -xOf - ./settings.txt | grep -q 'SIMPLEFIN_ENCRYPTION_KEY=(set, hidden)' ||
  fail "the report's settings don't hide the key"
if gzip -dc "$report" | grep -aqF "$key"; then fail "the report has a secret in it"; fi
"$cli" config >/dev/null || fail "config found a problem with a fresh install"

echo "cli-test: passed"
