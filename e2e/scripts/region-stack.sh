#!/usr/bin/env bash
#
# region-stack.sh — a LOCAL stack with three storage pools, for the region-choice
# e2e (task 1919, e2e/1919-region-choice.spec.ts). Local only, never prod.
#
#   up    fresh scratch DB; API from an API binary built from the server 1919
#         branch (GET /api/v1/storage-regions) with pools fsn1 (the default),
#         hel1 and nbg1, each a local blob directory; Vite pointed at it.
#   down  stop both (by the PIDs this script recorded) and drop the scratch DB.
#
# Required: E2E_API_BIN (path to the beebeeb-api binary of the server 1919 branch).
# Optional: E2E_API_PORT (3039)  E2E_VITE_PORT (5139)  E2E_DB_NAME (bb_1919_web)
#           E2E_STATE_DIR (mktemp-style dir under /tmp, kept in .state-dir)
#           E2E_PG_CONTAINER (beebeebio-postgres-1)  E2E_PGPASSWORD (dev DB password)
#
# `up` prints the env the spec needs. It never signals a process by name.
set -uo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_BIN="${E2E_API_BIN:?set E2E_API_BIN to the server 1919 branch beebeeb-api binary}"
PORT="${E2E_API_PORT:-3039}"
VPORT="${E2E_VITE_PORT:-5139}"
DB="${E2E_DB_NAME:-bb_1919_web}"
PG_CONTAINER="${E2E_PG_CONTAINER:-beebeebio-postgres-1}"
PGPW="${E2E_PGPASSWORD:-beebeeb_dev}"
STATE="${E2E_STATE_DIR:-/tmp/bb-region-stack-$PORT}"
BLOBS="$STATE/blobs"
mkdir -p "$STATE"

psqlx() { docker exec -e PGPASSWORD="$PGPW" "$PG_CONTAINER" psql -U beebeeb -v ON_ERROR_STOP=1 "$@"; }

stop_pid() {
  local f=$1 p
  [ -f "$f" ] || return 0
  p=$(cat "$f")
  kill "$p" 2>/dev/null
  for _ in 1 2 3 4 5; do kill -0 "$p" 2>/dev/null || break; sleep 1; done
  kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
  rm -f "$f"
  return 0
}

start_api() {
  DATABASE_URL="postgres://beebeeb:$PGPW@localhost:5434/$DB" BB_PORT="$PORT" \
  CORS_ORIGINS="http://localhost:$VPORT" BLOB_STORE=local BLOB_STORE_PATH="$BLOBS/fsn1" \
  AUDIT_SIGNING_KEY=0000000000000000000000000000000000000000000000000000000000000001 \
  SHARE_WRAPPING_KEY=0000000000000000000000000000000000000000000000000000000000000002 \
  OPAQUE_SERVER_SETUP="$(cat "$STATE/opaque")" SECRET_FINGERPRINTS_PATH="$STATE/.secret-fingerprints" \
  BB_RATE_LIMIT_DISABLED=1 APP_URL="http://localhost:$VPORT" API_URL="http://localhost:$PORT" \
  WEBAUTHN_RP_ID=localhost WEBAUTHN_RP_ORIGIN="http://localhost:$VPORT" BB_REQUIRE_PILOT_KEY=0 \
  nohup "$API_BIN" >"$STATE/api.log" 2>&1 &
  echo $! >"$STATE/api.pid"
  for _ in $(seq 1 90); do
    curl -fsS -m10 -o /dev/null "http://localhost:$PORT/api/v1/storage-regions" && return 0
    kill -0 "$(cat "$STATE/api.pid")" 2>/dev/null || { echo "API died on boot:"; tail -20 "$STATE/api.log"; return 1; }
    sleep 1
  done
  echo "API never answered /api/v1/storage-regions"; return 1
}

case "${1:-}" in
up)
  [ -x "$API_BIN" ] || { echo "no API binary at $API_BIN"; exit 1; }
  stop_pid "$STATE/api.pid"; stop_pid "$STATE/vite.pid"
  rm -rf "$BLOBS"; mkdir -p "$BLOBS/fsn1" "$BLOBS/hel1" "$BLOBS/nbg1"
  psqlx -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null || exit 1
  psqlx -d postgres -c "CREATE DATABASE $DB;" >/dev/null || exit 1
  [ -s "$STATE/opaque" ] || "$API_BIN" --generate-opaque-setup 2>/dev/null | grep -oE '[A-Za-z0-9+/=]{40,}' | head -1 >"$STATE/opaque"
  rm -f "$STATE/.secret-fingerprints"
  # Boot 1 runs the migrations (seeds the datacenters) and creates the default pool.
  start_api || exit 1
  stop_pid "$STATE/api.pid"
  psqlx -d "$DB" -c "UPDATE storage_pools SET region='fsn1', city='Falkenstein', display_name='Falkenstein', continent='europe', is_healthy=TRUE, is_active=TRUE, write_mode='active' WHERE is_default;" >/dev/null || exit 1
  for r in hel1:Helsinki nbg1:Nuremberg; do
    code=${r%%:*}; city=${r##*:}
    psqlx -d "$DB" -c "INSERT INTO storage_pools (name,provider,endpoint,bucket,region,display_name,city,continent,is_default,is_active,is_healthy,capacity_bytes,used_bytes,object_count,object_limit,object_warn_threshold_percent,bytes_warn_threshold_percent,write_mode) VALUES ('s-$code','local','file://','$BLOBS/$code','$code','$city','$city','europe',FALSE,TRUE,TRUE,1073741824,0,0,100000,80,80,'active');" >/dev/null || exit 1
  done
  # Boot 2 loads the pools (a new pool needs a restart to get a live client).
  start_api || exit 1
  (cd "$WEB_DIR" && NODE_ENV=test VITE_API_URL="http://localhost:$PORT" nohup bunx vite --mode test --port "$VPORT" --strictPort >"$STATE/vite.log" 2>&1 & echo $! >"$STATE/vite.pid")
  for _ in $(seq 1 60); do curl -fsS -m3 -o /dev/null "http://localhost:$VPORT" && break; sleep 1; done
  echo "up: api :$PORT (pid $(cat "$STATE/api.pid")), vite :$VPORT (pid $(cat "$STATE/vite.pid")), db $DB, state $STATE"
  echo "E2E_1919=1 E2E_API_URL=http://localhost:$PORT E2E_WEB_URL=http://localhost:$VPORT E2E_1919_DB=$DB E2E_1919_BLOB_ROOT=$BLOBS E2E_1919_PG_CONTAINER=$PG_CONTAINER E2E_NO_WEBSERVER=1"
  echo "(also export E2E_1919_PGPASSWORD to the dev DB password)"
  ;;
down)
  stop_pid "$STATE/vite.pid"; stop_pid "$STATE/api.pid"
  psqlx -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null
  echo down
  ;;
*) echo "usage: $0 up|down"; exit 2 ;;
esac
