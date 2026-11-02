# beebeeb-io/web

React web client for Beebeeb: encrypted file management in the browser (PUBLIC repo).
React 19 + Vite 6 + Tailwind 4 + react-router-dom 7. Package manager: **bun**.
Moved detail (regenerating beebeeb-wasm, search index, thumbnails, share-key wrapping, streaming upload, routes, design tokens,
how-to recipes): `docs/agent-notes.md`. Per-task incident narratives: `docs/runbook/web-task-history.md`.

## Commands

```sh
bun install
bun dev                       # localhost:5173 (API on :3001)
bun run build                 # tsc --noEmit && vite build && gen-wasm-sri.mjs
bunx tsc --noEmit; echo exit=$?
bun test 2>&1 | tee /tmp/bb-web-test.log             # unit tests
bun run test:order                                   # CI guard: suite reversed, shuffled, every file alone
bunx playwright test 2>&1 | tee /tmp/bb-web-e2e.log  # e2e (bun run test:e2e:isolated for the isolated stack)
make wasm-sync                                       # from the workspace root: regenerate packages/beebeeb-wasm from core
```

Truth lines: `bun test` → `N pass, 0 fail`; Playwright → `N passed`; `tsc` exit 0. Assert N, not the absence of "failed";
a Playwright filter that matched 0 tests is a RED. UI tasks are verified in a browser (screenshots in the task's evidence path),
never by curl. A new spec is trusted only after it has been seen to fail against a deliberate mutation.

## Module map

```
src/main.tsx, app.tsx      entry; routes (ProtectedRoute; pages render inside DriveLayout); WasmGuard blocks until crypto is ready
src/pages/                 one file per route (drive, login, signup, choose-plan, settings/*, share recipient, ...)
src/components/            UI: bb-* primitives, drive-layout (navItems), share-dialog, preview/*, settings/*, billing/*, onboarding/*
src/lib/api.ts             the API client, one function per endpoint, via the shared request()
src/lib/crypto.ts          main-thread facade to the crypto worker (opaque handles: StreamingEncryptor, wrap/unwrap share keys)
src/workers/crypto.worker.ts   core WASM lives here (also raw-preview, tiff-decode workers)
src/lib/encrypted-upload.ts / encrypted-download.ts   streaming chunk encrypt/decrypt via core's WasmChunkEncryptor
src/lib/search-index-{shards,core,context}.tsx   sharded encrypted name search (useSearchIndex); search-index.ts is LEGACY
src/lib/thumbnail.ts       client-side WebP thumbnails, encrypted with the file key
src/lib/account-state.ts   planGateRedirect: account_state "needs_plan" sends every protected route to /choose-plan
src/lib/auth-context.tsx, drive-data-context.tsx, display-context.tsx   app-wide state
src/hooks/, src/locales/, src/contracts/, src/types/
packages/shared            @beebeeb/shared SOURCE OF TRUTH (Icon, BBButton, request(), tokens.css)
packages/beebeeb-wasm      committed WASM package: the only wasm every build (local, CI, prod image) uses
test/ (bun test, KAT vectors)   e2e/ (Playwright)   scripts/ (test-order-guard, prod-smoke)   DEVIATIONS.md   design/
```

## Traps

- **beebeeb-wasm is committed.** When core's WASM surface changes you MUST regenerate it (`make wasm-sync`) and commit it naming the
  core SHA, or web will not see it. An EXISTING export with a changed signature in the `.d.ts` diff means core drifted: STOP and verify.
  Steps: `docs/agent-notes.md` → "Regenerating beebeeb-wasm".
- **`@beebeeb/shared` is edited here** (`packages/shared/src/`), then `make sync-shared`; never edit the workspace-root or admin mirrors.
- **Never call `mock.module` directly** (process-global, `mock.restore()` does not undo it): use `mockModuleScoped()` from
  `test/helpers/scoped-module-mock.ts`. Tests must not depend on file order; `test:order` fails on a raw `mock.module`.
- **Local e2e sign-ups:** run the API with `BB_RATE_LIMIT_DISABLED=1` or the 3 sign-ups/hour/IP limiter blocks back-to-back specs.
- **Provenance headers:** the shared `request()` sends `X-Beebeeb-Client: web` + version after `setClientInfo('web', __APP_VERSION__)`;
  the raw-`fetch()` chunk PUT adds them by hand via `provenanceHeaders()`. Admin does not call `setClientInfo`.
- **Uploads:** `encryptedUpload` takes BOTH `fileKey` and `masterKey` (from `useKeys().getMasterKey()`); the per-file key is derived once
  inside core, do not recombine keys in JS. Resume pushes already-uploaded chunks without re-PUTting them. `init_upload` sends the
  plaintext `size_bytes`; do NOT switch it to the ciphertext size. The encryptor lives in the worker; `maybeRestart()` skips the recycle while one is live.
- **ShareDialog: ALWAYS pass `isFolder={file.is_folder}`**; folder invites also send `folder_key_id` (`buildFolderInvite` / `folderKeyId`),
  or folder shares silently become regular file shares that do not work. Reuse an existing key (`findExistingFolderKey`); never mint one while an active invite has no usable owner blob.
- **Search index:** `DEFAULT_NUM_SHARDS = 64` MUST match core; add no callers to the legacy single-blob `search-index.ts`.
- **Crypto wire formats** (thumbnails, share-key wrap: `nonce(12) || ciphertext`, no AAD) are byte-proven against core by the KAT tests
  (`test/thumbnail-kat.test.ts`, `share-wrap-kat.test.ts`, `search-index-kat.test.ts`); keep them green.
- Brand: amber ONLY for encryption state and primary CTAs; mono for machine text; no emojis in UI; honest copy ("We can't recover this").

## Never break

The rules whose breakage costs data, a key, a credential or a user. One line each; the detail is in `docs/agent-notes.md`.

- When core's WASM surface changes you MUST regenerate + commit this package or web won't see it (`packages/beebeeb-wasm`, `make wasm-sync`).
- `maybeRestart()` skips the 256 MiB worker recycle while `liveEncryptorCount() > 0`, so an in-flight upload is never orphaned.
- Folder shares: active invites with no usable owner blob abort (never mint); only an authentication failure skips a blob (task 2133).

## How we work

Workspace `CLAUDE.md` → "How we work" is the rule set. Here: the truth lines above; design before code (`../../design/hifi/*.jsx` wins over
the code, deviations go in `DEVIATIONS.md`/the task file before the code changes); UI verified with Playwright screenshots.
Recipes (new page, new API function) and route list: `docs/agent-notes.md`.

## Graphify and shared docs

Knowledge graph at `graphify-out/`. Architecture question: `graphify query "<question>"` / `graphify explain <symbol>` /
`graphify path "<A>" "<B>"`; overview: `graphify-out/GRAPH_SUMMARY.md` (at most 3k tokens); never read `GRAPH_REPORT.md` whole.
Run `graphify update .` for your own navigation; never commit `graphify-out/` on a feature branch (the lead regenerates it on main).
When you add/change/remove endpoints, types, build commands or dependencies, update the matching skill in the workspace
`.claude/skills/` (beebeeb-api.md, beebeeb-designs.md, beebeeb-stack.md, beebeeb-dev.md).

- **Design files** live in the workspace root `../../design/hifi/` — never copy them into this public repo (a snapshot once published a false external-audit claim).
