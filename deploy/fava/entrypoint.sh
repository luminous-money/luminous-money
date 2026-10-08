#!/bin/sh
# Serve every exported book. Fava takes its ledger list at startup, so a newly created book
# appears after a restart (an open question in the README).
set -eu
until ls "$EXPORT_DIR"/*.beancount >/dev/null 2>&1; do
  echo "waiting for book exports in $EXPORT_DIR"
  sleep 2
done
exec fava --read-only "$@" "$EXPORT_DIR"/*.beancount
