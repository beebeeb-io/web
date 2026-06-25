# beebeeb-io/web

React web client for Beebeeb. Encrypted file management in the browser.

## Stack

React 19 + Vite 6 + Tailwind 4 + react-router-dom 7. Package manager: **bun**.

## Build & dev

```sh
bun install
bun dev          # localhost:5173
bun run build    # Production build
bunx tsc --noEmit  # Type check
```

## Regenerating beebeeb-wasm (from core)

`beebeeb-wasm` is a **committed workspace package** at `repos/web/packages/beebeeb-wasm/`
(resolved via `beebeeb-wasm: workspace:*`). It is the **single source of truth for
every web build** — local, CI, e2e, and the prod Docker image (which bundles the
committed package; there is no fresh core build at deploy time). So when core's
WASM surface changes, you MUST regenerate + commit this package or web won't see it.

```sh
# 1. Build the wasm from core (documented at core README.md:71)
cd repos/core && wasm-pack build beebeeb-wasm --target web
# 2. Copy the 4 generated artifacts into the web package (KEEP the committed
#    package.json unless wasm-pack's output meaningfully differs — diff it first)
cp beebeeb-wasm/pkg/{beebeeb_wasm_bg.wasm,beebeeb_wasm_bg.wasm.d.ts,beebeeb_wasm.d.ts,beebeeb_wasm.js} \
   ../web/packages/beebeeb-wasm/
# 3. Diff the .d.ts: new exports = additive (fine). An EXISTING export with a
#    changed signature means core drifted under web — STOP and verify before committing.
# 4. Commit in web naming the core SHA:  build(wasm): regenerate from core @ <SHA>
```

The vendored package now exports the **search surface** too (B4, task 0871):
`WasmSearchIndex` (build / fromEncryptedShards / upsert / remove / query /
encryptShards / encryptBuckets) + `searchIndexSyncPlan` + `decrypt_names`. From
the workspace root, `make wasm-sync` does the regen + copy in one step.

## Encrypted search index (B4, task 0871)

Web's file-name search runs on core's **unified sharded** primitive (HKDF label
`beebeeb-search-index-shard-v1`, 64 buckets, AES-256-GCM per shard) — BYTE-
identical shard keys to mobile/core (proven by `test/search-index-kat.test.ts`
against the pinned kdf.rs vectors). All crypto runs in core via `WasmSearchIndex`.

- `src/lib/search-index-shards.ts` — transport client for the sharded endpoints
  `/api/v1/search-index/shards` (manifest GET, per-shard GET/PUT/DELETE, LWW).
- `src/lib/search-index-core.ts` — `CoreSearchIndex`: build / fromShards /
  upsert / remove / query / pushBuckets(dirty) / pushAllShards. Joins the crypto
  proxy to the shard storage. `DEFAULT_NUM_SHARDS = 64` MUST match core.
- `src/lib/crypto.ts` `SearchIndexProxy` + `src/workers/crypto.worker.ts` — the
  `WasmSearchIndex` is a worker-owned stateful struct (like `WasmChunkEncryptor`),
  addressed by an opaque handle; the master key crosses as 32 raw bytes.
- `src/lib/search-index-context.tsx` — ONE owned `CoreSearchIndex` for the app,
  exposed via `useSearchIndex()` (singleton-via-context; palette + /search +
  drive all query the SAME index). On first unlock the shard manifest is empty,
  so `reconcileFromTree` REBUILDS shards from the decrypted file tree; until then
  queries fall back to the legacy blob (`src/lib/search-index.ts`, DEPRECATED) so
  there is no empty-search window. The index stores names only — result metadata
  (path/size/kind/modified) is resolved from the live sync tree at query time.
- `src/lib/search-index.ts` is the LEGACY single-blob `/api/v1/index` path, kept
  ONLY as the rebuild-window fallback/seed. Do not add new callers. Its removal +
  the `/api/v1/index` endpoint retirement is a later, Guus-gated, post-mobile task.

## API

Backend runs at `http://localhost:3001`. API client is in `src/lib/api.ts`. All endpoints documented in the server repo's CLAUDE.md.

## Design tokens (Tailwind 4 @theme)

Defined in `src/index.css`. Key colors:
- `paper` / `paper-2` / `paper-3` — warm off-whites
- `ink` / `ink-2` / `ink-3` / `ink-4` — warm darks
- `amber` / `amber-deep` / `amber-bg` — THE accent (encryption state + primary CTAs only)
- `green` — success
- `red` — danger
- `line` / `line-2` — borders

Typography: `font-sans` (Inter), `font-mono` (JetBrains Mono)
Spacing: 4px base (xs=4, sm=8, md=12, lg=18, xl=24, 2xl=36)
Radii: sm=4, md=6, lg=10, xl=14
Shadows: shadow-1 (subtle), shadow-2 (medium), shadow-3 (elevated)

## Design references

Hi-fi designs are in the workspace: `../../design/hifi/`. Key files:
- `hifi-auth.jsx` — signup, login, 2FA, passkey, forgot password
- `hifi-onboarding.jsx` — recovery phrase screen
- `hifi-drive.jsx` — main drive view with sidebar
- `hifi-upload-share.jsx` — upload zone + share dialog
- `hifi-preview.jsx` — image/PDF/video/markdown preview
- `hifi-settings.jsx` — profile, devices, notifications, language
- `hifi-security.jsx` — security center
- `hifi-billing.jsx` — pricing, upgrade, billing management
- `hifi-empty-errors.jsx` — empty states and error pages
- `hifi-brand-system.jsx` — complete design system doc

## Pages & routing

- `/signup`, `/login` — guest only
- `/onboarding` — post-signup recovery phrase
- `/` — Drive (main file view)
- `/trash` — trashed files
- `/search` — search results
- `/settings/*` — profile, devices, notifications, language
- `/security` — security center
- `/billing` — billing management
- `/s/:token` — public share recipient view (no auth)
- `*` — 404

## Components

In `src/components/`: bb-button, bb-input, bb-chip, bb-checkbox, bb-toggle, bb-logo, icons (24 SVGs), auth-shell, settings-shell, file-icon, upload-zone, upload-progress, share-dialog, new-folder-dialog, context-menu, move-modal, version-history, preview/* (chrome, rail, image, pdf, video, markdown, text), empty-states/*

## Brand rules

- Amber ONLY for encryption indicators and primary CTAs
- "If you can't read it aloud, it's mono" (hashes, IDs, sizes, timestamps)
- No emojis in UI
- Honest copy: "We can't recover this" not "bank-grade security"


## How to add a new page

1. Create `src/pages/my-page.tsx` — export a component that wraps content in `<DriveLayout>`
2. In `src/app.tsx`: import the component, add `<Route path="/my-page" element={<ProtectedRoute><MyPage /></ProtectedRoute>} />`
3. If it needs a sidebar link: add to `navItems` array in `src/components/drive-layout.tsx`

## How to add a new API function

Add to `src/lib/api.ts` following existing patterns:
```typescript
export async function myFunction(param: string): Promise<MyType> {
  return request<MyType>(`/api/v1/my-endpoint/${param}`)
}
```

## Thumbnails

Thumbnails are WebP format, generated client-side in `src/lib/thumbnail.ts`. The generation uses a quality cascade (768px width, quality 0.82→0.5) targeting max 50 KB before encryption. Encrypted with the file's AES-256-GCM key, uploaded via `PUT /api/v1/files/:id/thumbnail`.

Decrypted thumbnails are cached persistently via the Cache API (`beebeeb-thumbnails-v2`, max 10,000 entries) so they survive page reloads. In-memory `Map<string, string>` of object URLs provides the hot cache for the current session.

## Uploads (streaming encryption)

`src/lib/encrypted-upload.ts` encrypts files via the shared core streaming
primitive (`WasmChunkEncryptor`), NOT a whole-file read. Per chunk it slices the
`File`, calls `enc.pushChunk(slice)` (returns the full `nonce||ciphertext||tag`
frame — no JS recombine), PUTs the frame, and runs `enc.finish()` (integrity
guard) before `completeUpload`. Memory stays bounded to one slice + one frame.

- `encryptedUpload(..., masterKey, ...)` takes BOTH `fileKey` (metadata,
  thumbnails, folder-share) and `masterKey`. The encryptor derives the per-file
  key ONCE inside core from `masterKey` + the final `serverFileId` — do not
  recombine keys in JS. Pass `getMasterKey()` from `useKeys()` at call sites.
- The encryptor lives INSIDE the crypto worker (it's a pointer into WASM linear
  memory and can't cross Comlink). `crypto.ts` addresses it by an opaque handle
  via `StreamingEncryptor` / `startEncryptedStream[WithChunkSize]`.
- `crypto.ts` `maybeRestart()` skips the 256 MiB worker recycle while
  `liveEncryptorCount() > 0`, so an in-flight upload is never orphaned.
- Resume = push-but-don't-upload: already-uploaded chunks are STILL pushed (to
  keep index/nonce/count aligned with `finish()`), just not re-PUT.
- Wire contract unchanged: `init_upload` still sends `size_bytes = file.size`
  (plaintext) and `chunk_count` from the core plan — the server recomputes from
  chunks. Do NOT switch the init total to the ciphertext size.

## Critical prop chains

When opening the ShareDialog, ALWAYS pass `isFolder={file.is_folder}`. Folder sharing generates a folder_key and encrypts all children — without this prop, folder shares silently create regular file shares that don't work.

For full component reference: use `/beebeeb:components` skill.

## Graphify

This repo has a knowledge graph at graphify-out/.
- Before exploring code, read graphify-out/GRAPH_REPORT.md for module structure and relationships
- After modifying code, run `graphify update .` and commit the updated graphify-out/
- The graph tracks modules, functions, types, and their relationships (calls, imports, inherits)
- Use `graphify query "<question>"` to ask questions about the codebase
- Use `graphify path "<A>" "<B>"` to find connections between two concepts

## Keep shared docs in sync

When you add/change/remove endpoints, types, build commands, or dependencies: update the relevant skill file in `/home/guus/code/beebeeb.io/.claude/skills/` (beebeeb-api.md, beebeeb-designs.md, beebeeb-stack.md, beebeeb-dev.md). Other agents depend on these being accurate.
