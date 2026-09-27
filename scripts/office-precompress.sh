#!/usr/bin/env bash
#
# office-precompress.sh — Brotli-precompresses the office (LibreOffice-WASM)
# bundle artifacts and writes a manifest with sha256 + sizes (task 1567, web
# delivery groundwork).
#
# Lives in `repos/web`, not `repos/office`, on purpose: this script is about
# DELIVERY (how the already-built bundle gets served to the browser), which
# is a web-repo concern in this architecture — `gen-wasm-sri.mjs` already
# lives here for exactly the same reason (post-build tooling for a WASM
# binary the web app serves). `repos/office`'s own build pipeline (Legion,
# emscripten, `make wasm`) is owned by other lanes/agents, and this task's
# brief says to never disturb a live build lane — writing into that repo's
# tree now risks exactly that. This script only ever READS office's build
# output; it never touches `repos/office`.
#
# What it does:
#   1. For every file under --input (default: the office evidence artifacts
#      dir), runs `brotli -q 11 -k` to produce a sibling `.br` file.
#   2. Computes sha256 of the ORIGINAL (uncompressed) bytes — that is what
#      `WebAssembly.instantiateStreaming`/`fetch().arrayBuffer()` sees in the
#      browser once nginx transparently decompresses a `Content-Encoding: br`
#      response, so that is the correct identity to put in the manifest that
#      src/lib/office/loader.ts's `integrity` check verifies against.
#   3. Writes <output>/manifest.json: { version, generated, assets: [{ path,
#      bytes, sha256 (as "sha256-<base64>", matching fetch()'s `integrity`
#      format), brotliBytes, brotliRatio, contentType }] }.
#   4. Prints a human-readable size report to stdout.
#
# The `.br` files and the manifest are written to --output (default: a
# scratch dir under /tmp) — NEVER into this git repo. This task's own brief
# says not to commit the binaries; a 92–171 MB WASM/data pair has no business
# in git history regardless.
#
# Usage:
#   ./scripts/office-precompress.sh --input <dir> [--output <dir>] [--version <hash>]
#
# Requires: brotli, shasum (or sha256sum), python3 (for the JSON manifest).

set -euo pipefail

INPUT_DIR=""
OUTPUT_DIR=""
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input) INPUT_DIR="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "office-precompress.sh: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$INPUT_DIR" ]]; then
  echo "office-precompress.sh: --input <dir> is required" >&2
  exit 1
fi
if [[ ! -d "$INPUT_DIR" ]]; then
  echo "office-precompress.sh: input dir not found: $INPUT_DIR" >&2
  exit 1
fi

if ! command -v brotli >/dev/null 2>&1; then
  echo "office-precompress.sh: 'brotli' CLI not found (brew install brotli)" >&2
  exit 1
fi

SHASUM_CMD=""
if command -v shasum >/dev/null 2>&1; then
  SHASUM_CMD="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  SHASUM_CMD="sha256sum"
else
  echo "office-precompress.sh: neither 'shasum' nor 'sha256sum' found" >&2
  exit 1
fi

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$(mktemp -d -t bb-office-precompress)"
fi
mkdir -p "$OUTPUT_DIR"

if [[ -z "$VERSION" ]]; then
  # Derive a stable version from the sha256 of every input file's name+size+hash
  # concatenated — content-addressed, so an unchanged artifact set reproduces
  # the same version directory across runs (needed for the office cache's
  # "same content, same URL, cache forever" contract in public/sw.js).
  VERSION="$(
    find "$INPUT_DIR" -type f | sort | while read -r f; do
      $SHASUM_CMD "$f"
    done | $SHASUM_CMD | cut -c1-16
  )"
fi

echo "office-precompress.sh: input=$INPUT_DIR output=$OUTPUT_DIR version=$VERSION"
echo

MANIFEST_TMP="$(mktemp)"
trap 'rm -f "$MANIFEST_TMP"' EXIT

printf '[]' > "$MANIFEST_TMP"

TOTAL_ORIG=0
TOTAL_BR=0

content_type_for() {
  case "$1" in
    *.wasm) echo "application/wasm" ;;
    *.js) echo "application/javascript" ;;
    *.data) echo "application/octet-stream" ;;
    *.html) echo "text/html" ;;
    *.svg) echo "image/svg+xml" ;;
    *.ico) echo "image/x-icon" ;;
    *.json|*.metadata) echo "application/json" ;;
    *) echo "application/octet-stream" ;;
  esac
}

printf '%-28s %12s %12s %8s\n' "FILE" "ORIGINAL" "BROTLI(-q11)" "RATIO"
printf '%-28s %12s %12s %8s\n' "----" "--------" "------------" "-----"

while IFS= read -r -d '' file; do
  rel="${file#"$INPUT_DIR"/}"
  orig_bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
  sha_hex=$($SHASUM_CMD "$file" | awk '{print $1}')
  sha_b64=$(echo -n "$sha_hex" | xxd -r -p | base64)

  out_file="$OUTPUT_DIR/$rel"
  mkdir -p "$(dirname "$out_file")"
  cp "$file" "$out_file"

  br_file="${out_file}.br"
  brotli -q 11 -f -o "$br_file" "$file"
  br_bytes=$(stat -f%z "$br_file" 2>/dev/null || stat -c%s "$br_file")

  ratio=$(awk -v o="$orig_bytes" -v b="$br_bytes" 'BEGIN { if (o > 0) printf "%.1f%%", (1 - b/o) * 100; else print "n/a" }')
  printf '%-28s %12s %12s %8s\n' "$rel" "$orig_bytes" "$br_bytes" "$ratio"

  TOTAL_ORIG=$((TOTAL_ORIG + orig_bytes))
  TOTAL_BR=$((TOTAL_BR + br_bytes))

  ctype=$(content_type_for "$rel")

  python3 - "$MANIFEST_TMP" "$rel" "$orig_bytes" "$sha_b64" "$br_bytes" "$ctype" <<'PY'
import json, sys
manifest_path, rel, orig_bytes, sha_b64, br_bytes, ctype = sys.argv[1:7]
with open(manifest_path) as f:
    assets = json.load(f)
assets.append({
    "path": rel,
    "bytes": int(orig_bytes),
    "integrity": f"sha256-{sha_b64}",
    "contentType": ctype,
    "brotliBytes": int(br_bytes),
})
with open(manifest_path, "w") as f:
    json.dump(assets, f)
PY
done < <(find "$INPUT_DIR" -type f -print0 | sort -z)

echo
TOTAL_RATIO=$(awk -v o="$TOTAL_ORIG" -v b="$TOTAL_BR" 'BEGIN { if (o > 0) printf "%.1f%%", (1 - b/o) * 100; else print "n/a" }')
printf '%-28s %12s %12s %8s\n' "TOTAL" "$TOTAL_ORIG" "$TOTAL_BR" "$TOTAL_RATIO"

python3 - "$MANIFEST_TMP" "$OUTPUT_DIR/manifest.json" "$VERSION" <<'PY'
import json, sys, datetime
manifest_tmp, out_path, version = sys.argv[1:4]
with open(manifest_tmp) as f:
    assets = json.load(f)
manifest = {
    "version": version,
    "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
    "assets": assets,
}
with open(out_path, "w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
PY

echo
echo "office-precompress.sh: manifest -> $OUTPUT_DIR/manifest.json"
echo "office-precompress.sh: NOT committed — .br files and manifest are build artifacts, written outside the git tree."
