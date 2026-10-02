#!/usr/bin/env bash
# Builds the app, starts it against a throwaway demo database, runs the HTTP walkthrough and the
# browser/accessibility check, then stops the server. Exits non-zero on any failure.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${E2E_PORT:-3100}"
export DATABASE_PATH="${E2E_DB:-./data/e2e.db}"
export OPENFRAME_DEMO=1 BASE_URL="http://localhost:$PORT" TRUST_PROXY=0
export AUTH_SECRET="e2e-only-secret-e2e-only-secret-e2e-only-secret"
export AUTH_SIGNUP_LIMIT_PER_HOUR=1000 AUTH_SIGNIN_LIMIT_PER_MINUTE=1000
if curl -sf "http://localhost:$PORT/" > /dev/null 2>&1; then echo "Port $PORT is already in use (stale server?). Stop it or set E2E_PORT." >&2; exit 1; fi
rm -f "$DATABASE_PATH" "$DATABASE_PATH-wal" "$DATABASE_PATH-shm"
npx tsx scripts/seed-demo.ts || exit 1
NEXT_TELEMETRY_DISABLED=1 npx next build > /tmp/openframe-e2e-build.log 2>&1 || { cat /tmp/openframe-e2e-build.log; exit 1; }
# Own process group, so the whole server tree is stopped on exit.
NODE_ENV=production setsid node_modules/.bin/next start -p "$PORT" > /tmp/openframe-e2e-server.log 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null || kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf "$BASE_URL/" > /dev/null && break; sleep 0.5; done
STATUS=0
npx tsx scripts/e2e-walkthrough.ts || STATUS=1

# Second, production-style server (no demo mode, dummy Google client) on the same build, separate database.
PORT2=$((PORT + 1))
PROD_DB="${DATABASE_PATH%.db}-prod.db"
rm -f "$PROD_DB" "$PROD_DB-wal" "$PROD_DB-shm"
if curl -sf "http://localhost:$PORT2/" > /dev/null 2>&1; then echo "Port $PORT2 is already in use." >&2; exit 1; fi
GOOGLE_CLIENT_ID="dummy-client-id.apps.googleusercontent.com" GOOGLE_CLIENT_SECRET="dummy-secret" \
  OPENFRAME_DEMO=0 DATABASE_PATH="$PROD_DB" BASE_URL="http://localhost:$PORT2" NODE_ENV=production \
  setsid node_modules/.bin/next start -p "$PORT2" > /tmp/openframe-e2e-server2.log 2>&1 &
SERVER2=$!
trap 'kill -- -$SERVER 2>/dev/null || kill $SERVER 2>/dev/null; kill -- -$SERVER2 2>/dev/null || kill $SERVER2 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT2/" > /dev/null && break; sleep 0.5; done
BASE_URL="http://localhost:$PORT2" GOOGLE_CLIENT_ID="dummy-client-id.apps.googleusercontent.com" npx tsx scripts/prod-config-check.ts || STATUS=1
if [ "${SKIP_BROWSER:-0}" != "1" ]; then PROD_URL="http://localhost:$PORT2" npx tsx scripts/browser-check.ts "${E2E_SHOTS:-}" || STATUS=1; fi
exit $STATUS
