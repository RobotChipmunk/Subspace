#!/bin/bash
# Starts a freshly seeded Subspace on http://localhost:3000 for the iOS UI tests, replacing any
# server this script started before. Needs Postgres running and DATABASE_URL exported.
#   ios/scripts/e2e-server.sh          reset the database, seed it, start the server
#   ios/scripts/e2e-server.sh stop     stop the server
set -euo pipefail
cd "$(dirname "$0")/../.."
PIDFILE="${TMPDIR:-/tmp}/subspace-e2e.pid"
LOG="${E2E_LOG:-${TMPDIR:-/tmp}/subspace-e2e.log}"
: "${DATABASE_URL:?export DATABASE_URL first}"
DB="${DATABASE_URL##*/}"
ADMIN_URL="${DATABASE_URL%/*}/postgres"

if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
  sleep 1
fi
[ "${1:-}" = "stop" ] && exit 0

psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
npm run seed

# The tests sign in with this password (see SubspaceUITests).
export SUBSPACE_PASSWORD="${SUBSPACE_PASSWORD:-subspace}"
[ -d .next ] && [ -f .next/BUILD_ID ] || npm run build
nohup node node_modules/next/dist/bin/next start --port 3000 >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null http://localhost:3000/login; then echo "Subspace is up."; exit 0; fi
  sleep 1
done
echo "Subspace did not start. Log:"; tail -50 "$LOG"; exit 1
