#!/usr/bin/env bash
#
# office-bundle-stage.sh — stages the PRODUCTION LibreOffice-WASM office
# bundle for the web Docker image (task 1567, hosting lane).
#
# Reproducible source, never a third-party CDN:
#   1. repos/office/evidence/artifacts/emscripten/ (the 8 raw Emscripten
#      artifacts: soffice.wasm/.data/.js + qt_soffice.html/qtloader.js/
#      qtlogo.svg/favicon.ico/soffice.data.js.metadata) — verified byte-for-
#      byte against that repo's OWN COMMITTED reproducibility record,
#      repos/office/evidence/artifacts/MANIFEST.sha256, before anything else
#      runs. A mismatch or a file the record doesn't list REFUSES to stage.
#   2. repos/office/bridge/{bb-office-api.js,bb-office-worker.js} — regular
#      git-tracked source in the office repo (branch feat/1567-engine as of
#      this writing); git's own object store is the integrity guarantee for
#      these, the same as for any other source file this build reads.
#
# What it does, in order:
#   1. Verify (1) above against MANIFEST.sha256. Copies ONLY the files that
#      record names into a clean scratch dir — nothing else in that
#      directory (e.g. a `.br`/manifest.json a prior ad-hoc run left sitting
#      there) is allowed to leak into the staged bundle.
#   2. Reuse office-dev-assets.sh's own (already load-bearing, already-tested)
#      assembly step to build the SAME file tree the dev/e2e harness serves:
#      engine binaries + bb-office-api.js (sibling of the host page) +
#      bridge/bb-office-worker.js (which MUST live at that nested path — the
#      engine's own baked-in `Module.uno_scripts` importScripts() call is
#      relative to the host page, see that script's own comment) +
#      bb-office-host.html (qt_soffice.html with bb-office-api.js injected
#      before </body> — never a mutation of the engine's own file). This
#      script does not re-implement that assembly; office-dev-assets.sh is
#      the one place it is allowed to drift, and both paths call it.
#   3. Run office-precompress.sh (delivery groundwork, task 1567) over the
#      WHOLE assembled tree — brotli -q11 every file, content-address the
#      version from all of them together (so a bridge-script change bumps
#      the version exactly like an engine-artifact change would), write a
#      manifest.json with sha256 integrity of the assembled bytes.
#   4. Enforce the build-time invariant repos/web/nginx.conf's office
#      locations assume: every staged asset has a `.br` sibling. A missing
#      one REFUSES to stage rather than shipping a config that would silently
#      3-way-fork between "brotli", "plain", and "404" per file.
#   5. Replace repos/web/office-bundle-staging/ with the result:
#        office-bundle-staging/manifest.json         (top-level pointer)
#        office-bundle-staging/<version>/...          (assets + .br siblings)
#      Gitignored (see .gitignore) except a tracked `.gitkeep`, so
#      repos/web/Dockerfile's COPY of this directory into the image NEVER
#      fails the build just because this script hasn't been run — the office
#      editor stays feature-flagged and inert (a missing/absent bundle just
#      404s manifest.json; OfficeLoaderError surfaces it) exactly like the
#      web delivery groundwork lane already established.
#
# Usage:
#   scripts/office-bundle-stage.sh [--engine-dir <dir>] [--bridge-dir <dir>] \
#       [--sha256-record <file>] [--out <dir>]
#
# Defaults assume the standard workspace layout (resolved the same way
# office-dev-assets.sh resolves it, via git's common dir, so it also works
# from a worktree):
#   --engine-dir     <workspace>/repos/office/evidence/artifacts/emscripten
#   --bridge-dir     <workspace>/repos/office/bridge
#   --sha256-record  <workspace>/repos/office/evidence/artifacts/MANIFEST.sha256
#   --out            <this repo>/office-bundle-staging

set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if GIT_COMMON_DIR="$(cd "$WEB_DIR" && git rev-parse --git-common-dir 2>/dev/null)"; then
  PRIMARY_WEB_DIR="$(cd "$GIT_COMMON_DIR/.." && pwd)"
  WORKSPACE="$(cd "$PRIMARY_WEB_DIR/../.." && pwd)"
else
  WORKSPACE="$(cd "$WEB_DIR/../.." && pwd)"
fi

ENGINE_DIR="$WORKSPACE/repos/office/evidence/artifacts/emscripten"
BRIDGE_DIR="$WORKSPACE/repos/office/bridge"
SHA256_RECORD="$WORKSPACE/repos/office/evidence/artifacts/MANIFEST.sha256"
STAGE_DIR="$WEB_DIR/office-bundle-staging"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine-dir) ENGINE_DIR="$2"; shift 2 ;;
    --bridge-dir) BRIDGE_DIR="$2"; shift 2 ;;
    --sha256-record) SHA256_RECORD="$2"; shift 2 ;;
    --out) STAGE_DIR="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "office-bundle-stage.sh: unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -d "$ENGINE_DIR" ]] || { echo "office-bundle-stage.sh: engine dir not found: $ENGINE_DIR" >&2; exit 1; }
[[ -d "$BRIDGE_DIR" ]] || { echo "office-bundle-stage.sh: bridge dir not found: $BRIDGE_DIR" >&2; exit 1; }
[[ -f "$SHA256_RECORD" ]] || { echo "office-bundle-stage.sh: reproducibility record not found: $SHA256_RECORD" >&2; exit 1; }
[[ -x "$WEB_DIR/scripts/office-dev-assets.sh" || -f "$WEB_DIR/scripts/office-dev-assets.sh" ]] || { echo "office-bundle-stage.sh: missing scripts/office-dev-assets.sh (assembly step)" >&2; exit 1; }
[[ -f "$WEB_DIR/scripts/office-precompress.sh" ]] || { echo "office-bundle-stage.sh: missing scripts/office-precompress.sh (brotli step)" >&2; exit 1; }

SHASUM_CMD="shasum -a 256"
command -v shasum >/dev/null 2>&1 || SHASUM_CMD="sha256sum"

echo "office-bundle-stage.sh: step 1/5 — verifying $ENGINE_DIR against $SHA256_RECORD"
CLEAN_ENGINE_DIR="$(mktemp -d -t bb-office-clean-engine)"
VERIFY_FAIL=0
VERIFIED_COUNT=0
# MANIFEST.sha256 is an append-only, DATED reproducibility record (this
# repo's own convention — never quietly rewritten, a new section is added
# per phase instead, e.g. "## 2026-09-27 — Fix pass update"). That means the
# SAME filename legitimately appears more than once, once per phase, with a
# DIFFERENT hash each time the artifact actually changed — only the LAST
# recorded hash per filename is current. Reading the file top-to-bottom and
# requiring every line to match (the original, naive form of this loop)
# refused to stage ANY bundle built after phase 4, since phase 4's own
# stale soffice.wasm/.data/.js/.data.js.metadata hashes still sit earlier in
# the same file and mismatch the current (fix-pass) artifact bytes — found
# empirically running this exact script against a real fix-pass build
# (task 1567 ship prep, 2026-09-27), not by inspection. `awk` collapses to
# one line per filename (last occurrence wins, matching the record's own
# append order) BEFORE the verification loop runs, so the loop itself is
# unchanged; the historical entries stay in the file for the audit trail,
# they just stop being treated as the current truth.
LATEST_HASHES="$(awk '$1 ~ /^[0-9a-f]{64}$/ && $2 { line[$2] = $1 " " $2 } END { for (f in line) print line[f] }' "$SHA256_RECORD")"
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  expected_hash=$(awk '{print $1}' <<<"$line")
  filename=$(awk '{print $2}' <<<"$line")
  [[ "$expected_hash" =~ ^[0-9a-f]{64}$ ]] || continue
  [[ -n "$filename" ]] || continue
  target="$ENGINE_DIR/$filename"
  if [[ ! -f "$target" ]]; then
    echo "  MISSING: $filename (listed in $SHA256_RECORD, not found in $ENGINE_DIR)" >&2
    VERIFY_FAIL=1
    continue
  fi
  actual_hash=$($SHASUM_CMD "$target" | awk '{print $1}')
  if [[ "$actual_hash" != "$expected_hash" ]]; then
    echo "  MISMATCH: $filename expected=$expected_hash actual=$actual_hash" >&2
    VERIFY_FAIL=1
    continue
  fi
  cp "$target" "$CLEAN_ENGINE_DIR/$filename"
  VERIFIED_COUNT=$((VERIFIED_COUNT + 1))
  echo "  OK: $filename"
done <<<"$LATEST_HASHES"

if [[ "$VERIFY_FAIL" -ne 0 ]]; then
  echo "office-bundle-stage.sh: REFUSING to stage — verification failed against $SHA256_RECORD" >&2
  rm -rf "$CLEAN_ENGINE_DIR"
  exit 1
fi
if [[ "$VERIFIED_COUNT" -eq 0 ]]; then
  echo "office-bundle-stage.sh: REFUSING to stage — 0 files verified from $SHA256_RECORD (parse bug or empty record?)" >&2
  rm -rf "$CLEAN_ENGINE_DIR"
  exit 1
fi
echo "office-bundle-stage.sh: $VERIFIED_COUNT file(s) verified sha256-clean; only these bytes proceed"
echo

# office-dev-assets.sh reads a version string out of $ENGINE_DIR/manifest.json
# purely to name its own output directory — that value is discarded below (we
# re-derive our OWN content-addressed version from the full assembled tree
# via office-precompress.sh), so a placeholder is fine and correct here.
printf '{"version":"stage"}\n' > "$CLEAN_ENGINE_DIR/manifest.json"

echo "office-bundle-stage.sh: step 2/5 — assembling engine + bridge + host HTML (via office-dev-assets.sh)"
ASSEMBLE_DIR="$(mktemp -d -t bb-office-assemble)"
"$WEB_DIR/scripts/office-dev-assets.sh" \
  --engine-dir "$CLEAN_ENGINE_DIR" \
  --bridge-dir "$BRIDGE_DIR" \
  --out "$ASSEMBLE_DIR/office"
rm -rf "$CLEAN_ENGINE_DIR"

ASSEMBLED_TREE="$ASSEMBLE_DIR/office/stage"
[[ -d "$ASSEMBLED_TREE" ]] || { echo "office-bundle-stage.sh: assembly did not produce $ASSEMBLED_TREE" >&2; exit 1; }
echo

echo "office-bundle-stage.sh: step 3/5 — brotli -q11 + manifest (office-precompress.sh)"
TMP_OUT="$(mktemp -d -t bb-office-precompress)"
"$WEB_DIR/scripts/office-precompress.sh" --input "$ASSEMBLED_TREE" --output "$TMP_OUT"
rm -rf "$ASSEMBLE_DIR"
echo

VERSION="$(python3 -c "import json; print(json.load(open('$TMP_OUT/manifest.json'))['version'])")"
echo "office-bundle-stage.sh: content-addressed version = $VERSION"
echo

echo "office-bundle-stage.sh: step 4/5 — verifying the brotli-sibling invariant nginx.conf relies on"
MISSING_BR=0
while IFS= read -r -d '' f; do
  case "$f" in
    */manifest.json|*.br) continue ;;
  esac
  if [[ ! -f "$f.br" ]]; then
    echo "  MISSING .br SIBLING: ${f#"$TMP_OUT"/}" >&2
    MISSING_BR=1
  fi
done < <(find "$TMP_OUT" -type f -print0)
if [[ "$MISSING_BR" -ne 0 ]]; then
  echo "office-bundle-stage.sh: REFUSING to stage — a staged asset has no .br sibling (nginx.conf's office locations assume every one does)" >&2
  rm -rf "$TMP_OUT"
  exit 1
fi
echo "office-bundle-stage.sh: invariant holds — every asset has a .br sibling"
echo

echo "office-bundle-stage.sh: step 5/5 — writing $STAGE_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/$VERSION"
cp -R "$TMP_OUT"/. "$STAGE_DIR/$VERSION/"
cp "$TMP_OUT/manifest.json" "$STAGE_DIR/manifest.json"
touch "$STAGE_DIR/.gitkeep"
rm -rf "$TMP_OUT"

stat_bytes() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }
TOTAL_BYTES=0
BR_BYTES=0
while IFS= read -r -d '' f; do
  b=$(stat_bytes "$f")
  TOTAL_BYTES=$((TOTAL_BYTES + b))
  case "$f" in *.br) BR_BYTES=$((BR_BYTES + b)) ;; esac
done < <(find "$STAGE_DIR/$VERSION" -type f -print0)

echo
echo "office-bundle-stage.sh: staged $STAGE_DIR"
echo "office-bundle-stage.sh: version=$VERSION  bundle-dir-total=$TOTAL_BYTES bytes (plain+br)  brotli-only=$BR_BYTES bytes"
echo "office-bundle-stage.sh: repos/web/Dockerfile COPYs this directory to /usr/share/nginx/html/office"
