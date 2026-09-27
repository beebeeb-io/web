#!/usr/bin/env bash
#
# office-dev-assets.sh — assembles `public/office/` for LOCAL dev/e2e use from
# a real repos/office LibreOffice-WASM build (task 1567).
#
# What it does, that office-precompress.sh (delivery groundwork, task 1567)
# deliberately does NOT do:
#   1. Copies the engine binaries (soffice.wasm/.data/.js, qtloader.js,
#      qtlogo.svg, favicon.ico) from repos/office's build output.
#   2. Copies the bridge scripts (bb-office-api.js, bb-office-worker.js) from
#      repos/office/bridge/ — same origin as the engine, per the bridge's own
#      "load me as a sibling <script>" contract.
#   3. Assembles `bb-office-host.html`: the engine's OWN qt_soffice.html body,
#      with `bb-office-api.js` appended as a sibling <script> tag right before
#      </body> — this repo's copy, never a mutation of the engine's own file.
#   4. Writes `public/office/manifest.json` (the loader.ts contract: version +
#      assets[] with sha256 integrity) covering every file above, RAW (no
#      brotli) — this is for `bun dev`/e2e, not the precompressed prod bundle.
#
# None of this is committed (public/office/ is gitignored — see .gitignore's
# task-1567 entry) and none of it touches repos/office.
#
# Usage:
#   ./scripts/office-dev-assets.sh [--engine-dir <dir>] [--bridge-dir <dir>] [--out <dir>]
#
# Defaults assume the standard workspace layout (this script resolves the
# workspace root the same way e2e/scripts/web-e2e.sh does, via git's common
# dir, so it works from a worktree too):
#   --engine-dir  <workspace>/repos/office/evidence/artifacts/emscripten
#   --bridge-dir  <workspace>/repos/office/bridge
#   --out         <this repo>/public/office

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
OUT_DIR="$WEB_DIR/public/office"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine-dir) ENGINE_DIR="$2"; shift 2 ;;
    --bridge-dir) BRIDGE_DIR="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "office-dev-assets.sh: unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -d "$ENGINE_DIR" ]] || { echo "office-dev-assets.sh: engine dir not found: $ENGINE_DIR (build it on the Legion first, or pass --engine-dir)" >&2; exit 1; }
[[ -f "$ENGINE_DIR/soffice.wasm" ]] || { echo "office-dev-assets.sh: $ENGINE_DIR has no soffice.wasm" >&2; exit 1; }
[[ -f "$BRIDGE_DIR/bb-office-api.js" ]] || { echo "office-dev-assets.sh: bridge dir missing bb-office-api.js: $BRIDGE_DIR" >&2; exit 1; }
[[ -f "$ENGINE_DIR/manifest.json" ]] || { echo "office-dev-assets.sh: engine dir missing manifest.json (need it for the version string)" >&2; exit 1; }

SHASUM_CMD="shasum -a 256"
command -v shasum >/dev/null 2>&1 || SHASUM_CMD="sha256sum"

VERSION="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$ENGINE_DIR/manifest.json")"
VDIR="$OUT_DIR/$VERSION"

echo "office-dev-assets.sh: engine=$ENGINE_DIR version=$VERSION out=$VDIR"

rm -rf "$OUT_DIR"
mkdir -p "$VDIR"

# 1. Engine binaries (raw, uncompressed — this is dev/e2e, not the
#    Brotli-precompressed prod path office-precompress.sh builds separately).
for f in soffice.wasm soffice.data soffice.js soffice.data.js.metadata qtloader.js qtlogo.svg favicon.ico; do
  cp "$ENGINE_DIR/$f" "$VDIR/$f"
done

# 2. Bridge scripts. bb-office-api.js is a sibling of the host HTML page (see
#    its own "load me as a sibling <script>" header comment). bb-office-worker.js
#    is fetched by the pthread's own importScripts() at a path the ENGINE
#    ITSELF baked in at build time (static/emscripten/bb-uno-scripts-default.js,
#    task 1567 phase 4: `Module.uno_scripts = ["bridge/bb-office-worker.js"]`,
#    relative to wherever the host HTML page is served) — it MUST live at
#    <version>/bridge/bb-office-worker.js, not flat next to the other files,
#    or the pthread's importScripts() 404s and the whole engine boot fails
#    (found by testing this exact layout: "Failed to execute 'importScripts'
#    ... bridge/bb-office-worker.js failed to load").
cp "$BRIDGE_DIR/bb-office-api.js" "$VDIR/bb-office-api.js"
mkdir -p "$VDIR/bridge"
cp "$BRIDGE_DIR/bb-office-worker.js" "$VDIR/bridge/bb-office-worker.js"

# 3. bb-office-host.html — the engine's own qt_soffice.html body, with
#    bb-office-api.js appended as a sibling <script>, right before </body>.
#    Never edits qt_soffice.html itself; this is OUR page, built from it.
python3 - "$ENGINE_DIR/qt_soffice.html" "$VDIR/bb-office-host.html" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
html = open(src, encoding="utf-8").read()
inject = '    <script type="text/javascript" src="bb-office-api.js"></script>\n  </body>'
if '</body>' not in html:
    raise SystemExit("bb-office-host.html: source qt_soffice.html has no </body> to inject before")
html = html.replace('</body>', inject, 1)
with open(dst, "w", encoding="utf-8") as f:
    f.write(html)
PY

# 4. manifest.json — every file above, sha256 integrity, RAW bytes (fetch()'s
#    `integrity` option checks the bytes actually transferred; bun dev/nginx
#    -gzip serve these uncompressed in this dev path, unlike the prod Brotli
#    pipeline office-precompress.sh feeds).
python3 - "$VDIR" "$VERSION" "$OUT_DIR/manifest.json" <<'PY'
import base64, hashlib, json, os, sys, mimetypes

vdir, version, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
content_types = {
    ".wasm": "application/wasm",
    ".js": "application/javascript",
    ".data": "application/octet-stream",
    ".html": "text/html",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".metadata": "application/json",
}

assets = []
for root, _dirs, files in os.walk(vdir):
    for name in sorted(files):
        full = os.path.join(root, name)
        rel = os.path.relpath(full, vdir)  # e.g. "bridge/bb-office-worker.js"
        data = open(full, "rb").read()
        digest = hashlib.sha256(data).digest()
        ext = "." + name.split(".")[-1]
        ctype = content_types.get(ext, mimetypes.guess_type(name)[0] or "application/octet-stream")
        assets.append({
            "path": rel,
            "bytes": len(data),
            "integrity": "sha256-" + base64.b64encode(digest).decode(),
            "contentType": ctype,
        })
assets.sort(key=lambda a: a["path"])

manifest = {"version": version, "generated": "", "assets": assets}
with open(out_path, "w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
print(f"office-dev-assets.sh: wrote {out_path} ({len(assets)} assets)")
PY

echo "office-dev-assets.sh: done. Served at /office/manifest.json + /office/$VERSION/... once bun dev / the e2e harness's vite is running."
