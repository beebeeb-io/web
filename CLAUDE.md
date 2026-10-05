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

Every request through the shared `request()` client (`packages/shared/src/api/request.ts`) carries `X-Beebeeb-Client: web` and `X-Beebeeb-Client-Version: <package.json version>` once `setClientInfo('web', __APP_VERSION__)` runs at startup (`src/lib/api.ts`, task 1436) — the server records both on every `object_versions` row (server PR #23 / task 1369) for writer-provenance queries. The raw-`fetch()` chunk-PUT path (`uploadChunkRequest`) attaches the same pair by hand via `provenanceHeaders()`, since it bypasses `request()` to stream binary. `setClientInfo()` is opt-in per consuming app — admin does not call it, so admin traffic through the same shared package stays untagged.

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
- `/choose-plan` — trial with a payment mandate (task 1037). Every new account lands here after
  onboarding; `account_state: "needs_plan"` redirects every other protected route here (see
  `src/lib/account-state.ts` `planGateRedirect`); Mollie returns to `/choose-plan?returned=1`.
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

## Device approval page (`/cli-auth`, task 1734)

`bb login` and the desktop app are approved here. The page NEVER reads a code from the URL (a `?code=` link is ignored and the page says so — an attacker who started their own device flow can send any link): the person types the code their own device shows (`src/lib/cli-auth-code.ts`), the page then shows what the server measured about the asker (address, country when known, time) next to what the device merely claims (`src/lib/cli-auth-api.ts` → `GET /auth/cli-pubkey`), and Approve opens `StepUpAuth` (password or passkey). Nothing is minted, encrypted or sent until the step-up succeeds (`mintCliSession` needs the `X-Confirm-Token`). Specs that approve a device must use `e2e/helpers/cli-approve.ts`; the phishing proof is `e2e/1734-cli-auth-phishing.spec.ts`. Deploy order: web first, server second.

## Reset ends at 2FA (`/set-password/:token`, `/recover-with-phrase`, task 1803)

A password reset or a recovery-phrase recovery never bypasses 2FA (server task 1730, Guus ruling A). Both finalize calls (`setPasswordFinalize`, `recoverWithPhraseFinalize` in `src/lib/api.ts`) send `X-Beebeeb-Capabilities: reset-2fa`. For an account with 2FA the server then answers `{requires_2fa: true, partial_token}` with NO session and NO cookie, and the page shows the sign-in code step (`ResetTwoFactorStep`, which reuses `TwoFactorPrompt` and `classifyTwoFactorFailure`) and finishes through `/auth/2fa/verify`. Recovery keeps the derived master key and the new password in component state across that step and re-wraps the vault only after the code is accepted (`finishWithSession`). Accounts without 2FA are unchanged (session at finalize). A 409 `password_set_sign_in_required` (an older cached bundle without the header: the password WAS rotated) renders `ResetSignInRequired`: "Your new password is set. Sign in to continue." with a link to `/login`; the same screen shows when the code step closes (timeout or attempt cap). A reset deletes every earlier session, so when finalize answers a challenge (or the typed 409) `endObsoleteSession()` in `src/lib/api.ts` drops the legacy bearer and the page-load session-confirmed flag: a signed-in user with a locked vault reaches this page with that flag set (getMe), and without clearing it the first WRONG code (an expected 401) would fire the global session-expired handler and bounce to `/login` before the step could say "incorrect code" (Codex P2 on web#139; proof `e2e/1803-reset-2fa-signed-in.spec.ts`). Other requests keep the unchanged 401 expiry handling. Proof: `e2e/1803-reset-2fa.spec.ts` (needs an API with the `reset-2fa` capability; `E2E_MAILPIT_URL` reads the real email, otherwise `e2e/helpers/reset-link.ts` mints the token in the DB) and `test/1803-reset-2fa-client.test.ts`.

## After a password change: the local vault (task 1810)

A reset or a change leaves the master key UNCHANGED (set-once) but the copy this browser holds in IndexedDB (`beebeeb_vault` / `master`, `src/lib/vault.ts`) stays sealed under the OLD password. Rules:

- **Sign-in** (`login.tsx` `unlockProvenVault`, three OPAQUE-proven sites): any resident/cached key is cleared first (`lock()`), then `unlockVault(password)`. A `wrong_password` outcome here cannot be a typo (the server just proved the password), so `resolveSignInUnlock` (`src/lib/sign-in-unlock.ts`) says `discard_then_provision`: `discardStalePasswordVault()` (key-context) zeroes the key, clears the tab/persisted caches and deletes the password vault (`clearPasswordVault()`; a passkey-sealed vault is left alone), then the recovery-phrase screen re-seals the key under the new password. Never apply this to `VaultUnlock`'s form: there the password is not server-proven.
- **After `/set-password`** the next screen is the phrase screen (`LoginProvisionBranch`, `src/components/login-provision-branch.tsx`) with the proven new password in hand, not "Continue" into the locked-vault screen. "I've lost my recovery phrase" opens the self-service exits (`VaultLockedNoKey`). `VaultLockedNoKey`'s "Unlock with recovery phrase" never links to `/recover-with-phrase` (that page is a password RESET): in place it shows the phrase screen, from `ProtectedRoute` it signs out and sends the person to sign in, where the proven password plus the phrase re-seal the vault.
- A login TOTP code works once per 30-second step (server task 1728), so the code just used for a reset is refused at the next sign-in; `TWO_FACTOR_INCORRECT_MESSAGE` says so.
- Proof: `e2e/1810-after-password-change.spec.ts` (needs the isolated harness; helpers in `e2e/helpers/after-password-change.ts` hand out fresh TOTP steps and probe which password unwraps the browser's vault) and `test/1810-stale-vault-signin.test.ts`.

## Deleting a kept version (file details Versions tab + version-history drawer, task 1809)

Both surfaces list a file's history from `GET /api/v1/files/:id/versions` and offer **Delete** on every kept version, never on the current one. The server decides: each item carries `deletable` / `is_current` / `source` (`object_version` = v2, `file_version` = legacy) and the response `versions_count_toward_quota` (true only while the account has no plan). `src/lib/version-delete-copy.ts` is the pure core (`canDeleteVersion`, `versionContentBytes`, `versionDeleteCopy`, pinned by `test/1809-version-delete-copy.test.ts`); `src/components/version-delete.tsx` is the shared hook (`useVersionDelete`: calls `deleteVersion`, toasts, refreshes the shared usage so the storage meter moves) and the inline two-step `VersionDeleteConfirm` (no native `confirm()`). The size on a row is the CONTENT size: a v2 row's `size_bytes` is the encrypted total (28 bytes per chunk more), so `versionContentBytes` subtracts them, which makes the figure on screen equal the bytes the server's quota counts and a delete gives back. The confirmation says "We can't recover it" always, promises space back only when `versions_count_toward_quota`, and says plainly that a plan's storage total will not change otherwise. A 404 on delete is "already gone" (the row is dropped), any other failure keeps the confirmation open with the server's message. Proof: `e2e/1809-version-delete.spec.ts` (needs the isolated harness with an API built from the 1809 server branch and `BB_ENTRY_ALLOWANCE_BYTES=770` for its second test). Known gap, not this task: an allowance account's legacy `account_state` is `needs_plan`, which `planGateRedirect` sends to `/choose-plan`, so such an account cannot open the web drive at all yet; the second e2e test rewrites only that one field of the `/billing/subscription` response to reach it (declared in the spec header).

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

`encryptThumbnailBlob` / `decryptThumbnailBlob` (both exported) run AES-256-GCM directly via WebCrypto, independently of core's `beebeeb-wasm` build — wire format `nonce(12) || ciphertext`, no AAD, raw 32-byte FileKey. Proven byte-compatible with core's `encrypt_chunk`/`decrypt_chunk` (audit item K3, task 1383) by `test/thumbnail-kat.test.ts` against the pinned `thumbnail_encrypt` vector in `repos/core/test-vectors/vectors.json`, plus a live cross-check through the committed WASM build in both directions.

## Share-key wrapping

`wrapKeyForShare` / `unwrapKeyFromShare` (`src/lib/crypto.ts`) also run AES-256-GCM directly via WebCrypto, independently of core — wire format `nonce(12) || ciphertext(48)` = 60 bytes, no AAD, raw 32-byte wrap key. Used for share links (`share-dialog.tsx`, `share-link.ts`, `share-view.tsx`) to double-encrypt a file key or bundle-item key under a client-side key that lives only in the URL fragment. Proven byte-compatible with core's `encrypt_chunk`/`decrypt_chunk` (audit item K3, task 1383) by `test/share-wrap-kat.test.ts` against the pinned `share_key_wrap` vector in `repos/core/test-vectors/vectors.json`, plus a live cross-check through the committed WASM build in both directions.

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

## How we work (evidence, design, done, parallel agents)

The full rules live in the workspace `CLAUDE.md` → "How we work" (also summarised in the workspace `AGENTS.md`). Read them; they apply here. The repo-specific instantiation:

- **The count-shaped truth line:** `bun test 2>&1 | tee /tmp/bb-web-test.log` → `N pass, 0 fail`;
  `bunx playwright test 2>&1 | tee /tmp/bb-web-e2e.log` → `N passed` — assert N, not the absence of
  "failed". A Playwright filter that matched 0 tests is a red. `bunx tsc --noEmit; echo exit=$?`.
- **Unit tests must not depend on file order (task 1590, 2026-09-27):** bun's `mock.module` is
  process-global and `mock.restore()` does not undo it, so a mock leaks into every later file.
  Never call `mock.module` directly — use `mockModuleScoped()` from `test/helpers/scoped-module-mock.ts`
  (real exports spread under the overrides, restored after the file). `bun run test:order`
  (`scripts/test-order-guard.sh`, a CI step) runs the suite reversed, shuffled (`--randomize`, seed
  printed; replay with `TEST_ORDER_SEED=<n>`) and every file alone, and fails on a raw `mock.module`.
- **Sign-up rate limit in local e2e (task 1425, 2026-09-17):** `BB_RATE_LIMIT_DISABLED=1` on the API
  process now also lifts the `SignupLimiter` (3 sign-ups/hour/IP), not just the generic per-IP/user
  middleware — several sign-up specs can run back-to-back against one dev API without hitting `429`.
- **UI tasks are verified in a browser** (Playwright screenshots in the task's evidence path), never
  by curl. A new spec is trusted only after it has been seen to fail against a deliberate mutation.
- **Live-region rung is opt-in (task 1416 step 3, `e2e/1416-live-region-picker.spec.ts`):** the
  default e2e run has no Helsinki pool seeded, so the spec is gated behind
  `test.skip(!process.env.E2E_LIVE_REGION, ...)`. To run it for real: seed a region +
  datacenter + a `provider:"local"` storage pool with `continent:"helsinki"` and
  `is_active:true` through the admin API, restart the API (new pools need one restart;
  `is_active` toggles apply live), then
  `E2E_LIVE_REGION=1 bunx playwright test e2e/1416-live-region-picker.spec.ts`. Screenshots land
  under `E2E_EVIDENCE_DIR` (default `test-results/1416-step3/`, override to point at the
  workspace's tracked `docs/_qa-evidence/1416/step3/` for the real evidence capture).
- **Design before code:** `../../design/hifi/*.jsx` wins over the code; deviations are recorded in
  the task file before the code changes.
- **`@beebeeb/shared` edits happen in `packages/shared/src/` here, then `make sync-shared`** — the
  mirror guard exists precisely because a silently drifting copy is an unreviewed number.

## Graphify

This repo has a knowledge graph at graphify-out/.
- Before exploring code, read graphify-out/GRAPH_REPORT.md for module structure and relationships
- After modifying code, run `graphify update .` and commit the updated graphify-out/
- The graph tracks modules, functions, types, and their relationships (calls, imports, inherits)
- Use `graphify query "<question>"` to ask questions about the codebase
- Use `graphify path "<A>" "<B>"` to find connections between two concepts

## Keep shared docs in sync

When you add/change/remove endpoints, types, build commands, or dependencies: update the matching skill file in the beebeeb workspace's `.claude/skills/` directory (beebeeb-api.md, beebeeb-designs.md, beebeeb-stack.md, beebeeb-dev.md). Other agents depend on these being accurate.
