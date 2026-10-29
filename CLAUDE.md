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

`beebeeb-wasm` is a **committed workspace package** at `repos/web/packages/beebeeb-wasm/` (resolved via `beebeeb-wasm: workspace:*`). It is the **single source of truth for every web build** — local, CI, e2e, and the prod Docker image (which bundles the committed package; no fresh core build at deploy time). When core's WASM surface changes, you MUST regenerate + commit this package or web won't see it:

```sh
# 1. Build the wasm from core (documented at core README.md:71)
cd repos/core && wasm-pack build beebeeb-wasm --target web
# 2. Copy the 4 generated artifacts into the web package (KEEP the committed
#    package.json unless wasm-pack's output meaningfully differs — diff it first)
cp beebeeb-wasm/pkg/{beebeeb_wasm_bg.wasm,beebeeb_wasm_bg.wasm.d.ts,beebeeb_wasm.d.ts,beebeeb_wasm.js} \
   ../web/packages/beebeeb-wasm/
# 3. Diff the .d.ts: new exports = additive (fine). An EXISTING export with a changed signature
#    means core drifted under web — STOP and verify before committing.
# 4. Commit in web naming the core SHA:  build(wasm): regenerate from core @ <SHA>
```

From the workspace root, `make wasm-sync` does the regen + copy in one step.

## API

Backend runs at `http://localhost:3001`. API client is in `src/lib/api.ts`; all endpoints documented in the server repo's CLAUDE.md. Every request through the shared `request()` client (`packages/shared/src/api/request.ts`) carries `X-Beebeeb-Client: web` and `X-Beebeeb-Client-Version: <package.json version>` once `setClientInfo('web', __APP_VERSION__)` runs at startup — the server records both on every `object_versions` row (writer provenance). The raw-`fetch()` chunk-PUT path (`uploadChunkRequest`) attaches the same pair by hand via `provenanceHeaders()`, since it bypasses `request()`. `setClientInfo()` is opt-in per consuming app — admin does not call it, so admin traffic through the same shared package stays untagged.

## Encrypted search index

File-name search runs on core's **unified sharded** primitive (HKDF label `beebeeb-search-index-shard-v1`, 64 buckets, AES-256-GCM per shard) — BYTE-identical shard keys to mobile/core (proven by `test/search-index-kat.test.ts` against the pinned kdf.rs vectors). All crypto runs in core via `WasmSearchIndex` (worker-owned stateful struct, addressed by an opaque handle; master key crosses as 32 raw bytes).

- `src/lib/search-index-shards.ts` — transport for `/api/v1/search-index/shards` (manifest GET, per-shard GET/PUT/DELETE, LWW).
- `src/lib/search-index-core.ts` — `CoreSearchIndex`: build / fromShards / upsert / remove / query / pushBuckets(dirty) / pushAllShards. `DEFAULT_NUM_SHARDS = 64` MUST match core.
- `src/lib/search-index-context.tsx` — ONE owned index for the app via `useSearchIndex()` (palette + /search + drive query the SAME index). On first unlock `reconcileFromTree` REBUILDS shards from the decrypted file tree; until then queries fall back to the legacy blob so there is no empty-search window. The index stores names only — result metadata resolves from the live sync tree at query time.
- `src/lib/search-index.ts` is the LEGACY single-blob `/api/v1/index` path, kept ONLY as the rebuild-window fallback/seed. Do not add callers; its removal is a later, Guus-gated, post-mobile task. (details: docs/runbook/web-task-history.md#encrypted-search-index-b4-task-0871)

## Design tokens (Tailwind 4 @theme)

Defined in `src/index.css`. Key colors: `paper`/`paper-2`/`paper-3` (warm off-whites), `ink`/`ink-2`/`ink-3`/`ink-4` (warm darks), `amber`/`amber-deep`/`amber-bg` (THE accent — encryption state + primary CTAs only), `green` (success), `red` (danger), `line`/`line-2` (borders). Typography: `font-sans` (Inter), `font-mono` (JetBrains Mono). Spacing 4px base (xs=4, sm=8, md=12, lg=18, xl=24, 2xl=36). Radii sm=4, md=6, lg=10, xl=14. Shadows shadow-1 (subtle), shadow-2 (medium), shadow-3 (elevated).

## Design references

Hi-fi designs are in the workspace `../../design/hifi/`: hifi-auth.jsx, hifi-onboarding.jsx, hifi-drive.jsx, hifi-upload-share.jsx, hifi-preview.jsx, hifi-settings.jsx, hifi-security.jsx, hifi-billing.jsx, hifi-empty-errors.jsx, hifi-brand-system.jsx.

## Pages & routing

- `/signup`, `/login` — guest only · `/onboarding` — post-signup recovery phrase
- `/choose-plan` — trial with a payment mandate. Every new account lands here after onboarding; `account_state: "needs_plan"` redirects every other protected route here (`src/lib/account-state.ts` `planGateRedirect`); Mollie returns to `/choose-plan?returned=1`.
- `/` — Drive (main file view) · `/trash` · `/search` · `/settings/*` · `/security` · `/billing`
- `/s/:token` — public share recipient view (no auth) · `/c/:code` — coupon link (public)
- `/surveys/:id?token=` — exit survey from the trial-ended follow-up email (public, vault-free)
- `/cli-auth` — device approval for `bb login` + the desktop app (public)
- `/set-password/:token`, `/recover-with-phrase` — reset / recovery-phrase recovery
- `/return-to-app` — native apps' Mollie checkout return (public, no API call)
- `/erase-request/cancel`, `/erase-request/verify` — vault-free token-link pages · `*` — 404

Task-specific page behaviour (device approval 1734, reset-ends-at-2FA 1803, after-password-change vault 1810, erase request 1918, version delete 1809, coupon links 1814, exit survey 1920, inactive-account sign-out 1948, no-card trial 1757, checkout return 1743): docs/runbook/web-task-history.md

## Components

In `src/components/`: bb-button, bb-input, bb-chip, bb-checkbox, bb-toggle, bb-logo, icons (24 SVGs), auth-shell, settings-shell, file-icon, upload-zone, upload-progress, share-dialog, new-folder-dialog, context-menu, move-modal, version-history, preview/* (chrome, rail, image, pdf, video, markdown, text), empty-states/*. For full component reference: `/beebeeb:components` skill.

## Thumbnails

WebP, generated client-side in `src/lib/thumbnail.ts` (quality cascade: 768px width, 0.82→0.5, max 50 KB before encryption). Encrypted with the file's AES-256-GCM key via `encryptThumbnailBlob` / `decryptThumbnailBlob` (WebCrypto, wire format `nonce(12) || ciphertext`, no AAD, raw 32-byte FileKey) — proven byte-compatible with core's `encrypt_chunk`/`decrypt_chunk` (audit item K3) by `test/thumbnail-kat.test.ts` against the pinned `thumbnail_encrypt` vector in `repos/core/test-vectors/vectors.json`. Upload via `PUT /api/v1/files/:id/thumbnail`. Decrypted thumbnails are cached persistently via the Cache API (`beebeeb-thumbnails-v2`, max 10,000 entries) plus an in-memory `Map` of object URLs for the current session.

## Share-key wrapping

`wrapKeyForShare` / `unwrapKeyFromShare` (`src/lib/crypto.ts`) also run AES-256-GCM via WebCrypto independently of core — wire format `nonce(12) || ciphertext(48)` = 60 bytes, no AAD, raw 32-byte wrap key. Used for share links to double-encrypt a file key or bundle-item key under a client-side key that lives only in the URL fragment. Proven byte-compatible with core (audit item K3) by `test/share-wrap-kat.test.ts` against the pinned `share_key_wrap` vector.

## Uploads (streaming encryption)

`src/lib/encrypted-upload.ts` encrypts files via the shared core streaming primitive (`WasmChunkEncryptor`), NOT a whole-file read. Per chunk it slices the `File`, calls `enc.pushChunk(slice)` (returns the full `nonce||ciphertext||tag` frame — no JS recombine), PUTs the frame, and runs `enc.finish()` (integrity guard) before `completeUpload`. Memory stays bounded to one slice + one frame.

- `encryptedUpload(..., masterKey, ...)` takes BOTH `fileKey` (metadata, thumbnails, folder-share) and `masterKey`. The encryptor derives the per-file key ONCE inside core from `masterKey` + the final `serverFileId` — do not recombine keys in JS. Pass `getMasterKey()` from `useKeys()` at call sites.
- The encryptor lives INSIDE the crypto worker (a pointer into WASM linear memory; it can't cross Comlink). `crypto.ts` addresses it by an opaque handle via `StreamingEncryptor` / `startEncryptedStream[WithChunkSize]`.
- `crypto.ts` `maybeRestart()` skips the 256 MiB worker recycle while `liveEncryptorCount() > 0`, so an in-flight upload is never orphaned.
- Resume = push-but-don't-upload: already-uploaded chunks are STILL pushed (to keep index/nonce/count aligned with `finish()`), just not re-PUT.
- Wire contract unchanged: `init_upload` sends `size_bytes = file.size` (plaintext) and `chunk_count` from the core plan — the server recomputes from chunks. Do NOT switch the init total to the ciphertext size.

## Critical prop chains

When opening the ShareDialog, ALWAYS pass `isFolder={file.is_folder}`. Folder sharing encrypts all children under the folder's key: reuse the newest openable key among the folder's status-active invites (invited/claimed/approved; expires_at ignored) via `findExistingFolderKey`; exact verification arrives with the server key fingerprint (design K); mint a new one only when the folder has no active invite; active invites with no usable owner blob abort (never mint); only an authentication failure skips a blob (task 2133). Every folder invite and add-folder-keys call also sends `folder_key_id` (base64 of core's `folder_key_id` WASM export, via `buildFolderInvite` / `folderKeyId`) — without this prop, folder shares silently create regular file shares that don't work.

## Brand rules

- Amber ONLY for encryption indicators and primary CTAs · "If you can't read it aloud, it's mono" (hashes, IDs, sizes, timestamps)
- No emojis in UI · Honest copy: "We can't recover this" not "bank-grade security"

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

## How we work (evidence, design, done, parallel agents)

The full rules live in the workspace `CLAUDE.md` → "How we work" (also summarised in the workspace `AGENTS.md`). Read them; they apply here. The repo-specific instantiation:

- **The count-shaped truth line:** `bun test 2>&1 | tee /tmp/bb-web-test.log` → `N pass, 0 fail`; `bunx playwright test 2>&1 | tee /tmp/bb-web-e2e.log` → `N passed` — assert N, not the absence of "failed". A Playwright filter that matched 0 tests is a red. `bunx tsc --noEmit; echo exit=$?`.
- **Unit tests must not depend on file order (task 1590):** bun's `mock.module` is process-global and `mock.restore()` does not undo it. Never call `mock.module` directly — use `mockModuleScoped()` from `test/helpers/scoped-module-mock.ts`. `bun run test:order` (`scripts/test-order-guard.sh`, a CI step) runs the suite reversed, shuffled and every file alone, and fails on a raw `mock.module`.
- **Sign-up rate limit in local e2e (task 1425):** `BB_RATE_LIMIT_DISABLED=1` on the API process lifts the `SignupLimiter` (3 sign-ups/hour/IP) too — several sign-up specs can run back-to-back.
- **UI tasks are verified in a browser** (Playwright screenshots in the task's evidence path), never by curl. A new spec is trusted only after it has been seen to fail against a deliberate mutation.
- **Design before code:** `../../design/hifi/*.jsx` wins over the code; deviations are recorded in the task file before the code changes.
- **`@beebeeb/shared` edits happen in `packages/shared/src/` here, then `make sync-shared`.**

## Graphify

This repo has a knowledge graph at graphify-out/. Before exploring code, read `graphify-out/GRAPH_REPORT.md`; after modifying code, run `graphify update .` and commit. `graphify query "<question>"` / `graphify path "<A>" "<B>"`.

## Keep shared docs in sync

When you add/change/remove endpoints, types, build commands, or dependencies: update the matching skill file in the workspace `.claude/skills/` directory (beebeeb-api.md, beebeeb-designs.md, beebeeb-stack.md, beebeeb-dev.md). Other agents depend on these being accurate.

## Task history

Per-task incident narratives (search index 0871, cli-auth 1734, reset 2FA 1803, stale vault 1810, erase request 1918, version delete 1809, coupon links 1814, exit survey 1920, inactive account 1948, no-card trial 1757, core-1908 readers 1943, sync user_seq 1973, checkout return 1743, region choice 1919/2050): docs/runbook/web-task-history.md
