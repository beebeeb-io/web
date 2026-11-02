#!/usr/bin/env bash
# Generates the wire types from the vendored server OpenAPI document.
#
# The document is vendored (contracts/openapi.json + contracts/SERVER_REV) so
# CI type-checks the client without the private server repo. The generator is
# pinned exactly: a schema change and a generator bump must stay separate,
# visible commits (spec §16.2 decision 2).
#
#   ./scripts/openapi-types.sh --write   # regenerate the committed .d.ts
#   ./scripts/openapi-types.sh --check   # fail if it differs (CI)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GENERATOR="openapi-typescript@7.13.0"
SOURCE="contracts/openapi.json"
OUTPUT="packages/shared/src/types/openapi.d.ts"

# One type per `components.schemas` entry: object schemas open a block, alias
# schemas point at another entry.
count_types() {
  awk '
    /^    schemas: \{/ { in_schemas = 1; next }
    in_schemas && /^    \};/ { exit }
    in_schemas && /^        ("[^"]+"|[A-Za-z_][A-Za-z0-9_]*): / { n++ }
    END { print n + 0 }
  ' "$1"
}

usage() {
  echo "usage: $0 --write|--check" >&2
  exit 2
}

[ $# -eq 1 ] || usage
case "$1" in
  --write|--check) ;;
  *) usage ;;
esac

[ -f "$SOURCE" ] || { echo "openapi-types: missing $SOURCE" >&2; exit 1; }
[ -f contracts/SERVER_REV ] || { echo "openapi-types: missing contracts/SERVER_REV" >&2; exit 1; }

WRITTEN=0
if [ "$1" = "--write" ]; then
  bunx "$GENERATOR" "$SOURCE" -o "$OUTPUT" >/dev/null
  WRITTEN=1
else
  TMP="$(mktemp -t openapi-types.XXXXXX).d.ts"
  trap 'rm -f "$TMP"' EXIT
  bunx "$GENERATOR" "$SOURCE" -o "$TMP" >/dev/null
  if ! diff -u "$OUTPUT" "$TMP" > /tmp/openapi-types.diff 2>&1; then
    DIFFS="$(grep -c '^[+-][^+-]' /tmp/openapi-types.diff || true)"
    TYPES="$(count_types "$TMP")"
    echo "openapi-types: $TYPES types, $DIFFS differences (committed copy is stale; run --write)"
    exit 1
  fi
fi

TYPES="$(count_types "$OUTPUT")"
REV="$(cat contracts/SERVER_REV)"
echo "openapi-types: $TYPES types, 0 differences (server $REV)"
