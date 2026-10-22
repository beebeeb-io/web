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
- `/c/:code` — coupon link (task 1814, public; see "Coupon links" below)
- `/surveys/:id?token=` — exit survey from the trial-ended follow-up email (task 1920, public, vault-free; see "Exit survey" below)
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

## The locked screen's "Erase all files" is a request, never a delete (task 1918)

Guus, 2026-10-17: "Files should NEVER go missing" / "the code and all apps should just not delete random stuff". This supersedes the 1704 open-question #7 default ("explicit confirmation, no time delay"): `VaultLockedNoKey` used to trash everything and then call `/files/permanent` per 500 ids from the browser after one checkbox. Now:

- `src/lib/erase-request.ts` (pure): `parseEraseStatus`, `typedCountMatches` (the person types the SERVER's live item count; "1,240" / "1 240" accepted), `eraseCard` (ask / empty / awaiting / pending / moving / done), `requestErase` and `cancelErase` (typed outcomes from `ApiError`). `src/components/erase-request-card.tsx` draws it; `vault-locked-no-key.tsx` wires it to `getEraseRequest` / `createEraseRequest` (with the step-up token) / `cancelEraseRequest` in `api.ts`.
- Server contract (server task 1918): `GET/POST /api/v1/account/erase-request`, `POST .../cancel`, `POST .../cancel-by-token`, `POST .../verify-by-token`. The server emails the account address at once with a confirmation link and a one-click cancel link. Round 3 (Guus, 2026-10-18: "Mm erase all files then requires email verify" / "Verify link + 72 h"): a new request has `verified: false` and `due_at: null`, and nothing counts down until the owner opens the confirmation link; 72 h after that the server moves every file to the TRASH (normal retention) and emails that it did. Unconfirmed for 24 h, the request lapses (`last_expired` in the status). The card shows `awaiting` ("check your email to confirm"), then `pending` with the due time and Cancel, or the expired note on `ask`.
- `/erase-request/cancel#t=<token>` (`src/pages/erase-request-cancel.tsx`, `src/lib/erase-request-link.ts`): vault-free like the survey page (no providers, `AuthShellFrame`, plain `fetch` with `credentials: 'omit'`). The token is in the URL fragment, read once, removed from the address bar and posted in a JSON body. Round 4: it waits for ONE click on "Cancel the erase" and never acts on load (the cancel link shares an email with the confirmation link, and mail scanners run pages; cancelling on load let a scanner cancel every request and use up the 3-a-day limit).
- `/erase-request/verify#t=<token>` (`src/pages/erase-request-verify.tsx`, `verifyByLink` in the same lib): vault-free the same way. It does NOT act on load: confirming is the dangerous direction and mail scanners run JavaScript, so the page says what will happen and waits for a click on "Confirm the erase". After confirming it shows the due time, the trash retention, and a Cancel button (the second cancel token the server returns, the same one the confirmation email holds).
- Round 4 (web#174 / server#232 review, 2026-10-18):
  - Both link pages: a reload after the token was read (or a cut-off link) shows "Open the link from your email again" (`reopen`), never a claim about the request; the token is kept in memory only.
  - `createEraseRequest` is sent exactly once through `src/lib/erase-request-transport.ts` (plain `fetch`, same headers and cookies as `request()`): the shared client's retries would re-send the spent `X-Confirm-Token`. A 429 shows the server's daily-cap words; an unknown outcome says "We couldn't confirm whether it was scheduled" and reads the status; 409 `erase_request_in_progress` is an unknown outcome with "Check again". Do not move it back onto `request()`.
  - Cancelling works in exactly three places, and the copy names them: the locked screen, the email link, and the unlocked web app (`src/components/erase-request-banner.tsx`, mounted in `DriveLayout`: awaiting / confirmed / past due with Cancel, moving without). Never write "any device". A confirmed request past its due time stays cancellable until the move starts (the server's `cancellable` follows `started_at`).
  - `cancelErase(deps, shownRequestId)`: a 404 (or no answer) reads the status again and returns `already_executed` / `nothing_pending` (with the fresh status) / `still_pending` / `unknown`; `cancelNote()` has the words. Never "Nothing will be moved" without that read.
  - The confirmation page honours `confirmation_email_sent: false` (no promise of an email).
  - "Restore everything from the erase on <date>" (`src/components/restore-from-erase.tsx`, `restoreEverything` / `restoreOffer` in the lib): `POST /api/v1/account/erase-request/{id}/restore` (200 all back, 202 continuing), progress "<n> restored, <m> still in the trash" polled every 5 s, "Everything from the erase is back." Drawn on the locked screen (the card's `restore` slot), in Trash, and on the empty drive (`EmptyDrive notice`). `restoreFile()` returns `{ complete, remaining }`; a 202 folder restore says it continues in the background.
  - Accessibility: each surface has one `role="status" aria-live="polite"` region for outcomes (mounted in every state), the result takes the focus after an action (`AuthShellFrame titleRef`, the card's `focusTick`), every error line is `role="alert"`.
  - Status reads are sequenced (`createLatestGate`): only the newest read may apply, and an applied action supersedes older reads. "Check again" stays until the request shows up or the follow-up read (`FOLLOW_UP_MS`, 10 s) ran (`keepCheckAgain`).
  - `parseTypedCount` accepts digits or real thousands grouping with one separator kind only ("12.40", "1,2,4,0", "1.5" → null).
  - Self-review rounds 4b–4e: one sequencing authority (the screen's `LatestGate` is shared with the restore block); `src/lib/erase-status-store.ts` is the unlocked app's shared status read (30 s TTL for the banner's pending state only, newer read wins, `invalidate()` drops in-flight reads and notifies subscribers; forced reads within 1 s share one GET). No count is ever shown from a read older than the person's own action: restore offers read fresh and re-read after every own trash action and live trash event (`watchLastExecuted`). The restore block and the banner are plain controllers (`src/lib/restore-controller.ts`, `src/lib/erase-banner-controller.ts`, bound with `useSyncExternalStore`) so their behaviour is unit-tested without a DOM. After an unknown outcome, "Check again" and the note follow `createCheckAgainTracker`: a read right after the failure never hides the doubt; a later read replaces the note with the truth (it ran / the move started / it is gone / still pending). Restore copy uses counts ("<n> items from this erase are still in the trash", "Nothing from this erase is left in the trash."), never "everything is back".
- `src/lib/locked-state-exits.ts` (the old wipe) is gone; the locked screen has no path to `/files/permanent` (`test/1918-erase-request.test.tsx` checks the sources and the import graph).
- Proof: `test/1918-erase-request.test.tsx`, `test/1918-erase-request-r2.test.tsx`, `test/1918-erase-request-r3.test.tsx`, `test/1918-erase-request-r4.test.tsx` … `-r4e.test.tsx`, `test/1704-vault-locked-no-key.test.tsx`, and `e2e/1918-erase-request.spec.ts` (`--config=e2e/1918-erase-request.config.ts`, real stack; the header lists the environment).

## Deleting a kept version (file details Versions tab + version-history drawer, task 1809)

Both surfaces list a file's history from `GET /api/v1/files/:id/versions` and offer **Delete** on every kept version, never on the current one. The server decides: each item carries `deletable` / `is_current` / `source` (`object_version` = v2, `file_version` = legacy) and the response `versions_count_toward_quota` (true only while the account has no plan). `src/lib/version-delete-copy.ts` is the pure core (`canDeleteVersion`, `versionContentBytes`, `versionDeleteCopy`, pinned by `test/1809-version-delete-copy.test.ts`); `src/components/version-delete.tsx` is the shared hook (`useVersionDelete`: calls `deleteVersion`, toasts, refreshes the shared usage so the storage meter moves) and the inline two-step `VersionDeleteConfirm` (no native `confirm()`). The size on a row is the CONTENT size: a v2 row's `size_bytes` is the encrypted total (28 bytes per chunk more), so `versionContentBytes` subtracts them, which makes the figure on screen equal the bytes the server's quota counts and a delete gives back. The confirmation says "We can't recover it" always, promises space back only when `versions_count_toward_quota`, and says plainly that a plan's storage total will not change otherwise. A 404 on delete is "already gone" (the row is dropped), any other failure keeps the confirmation open with the server's message. Proof: `e2e/1809-version-delete.spec.ts` (needs the isolated harness with an API built from the 1809 server branch and `BB_ENTRY_ALLOWANCE_BYTES=770` for its second test). Known gap, not this task: an allowance account's legacy `account_state` is `needs_plan`, which `planGateRedirect` sends to `/choose-plan`, so such an account cannot open the web drive at all yet; the second e2e test rewrites only that one field of the `/billing/subscription` response to reach it (declared in the spec header).

## Coupon links (`/c/:code`, task 1814 slice A: free grants)

A link `https://app.beebeeb.io/c/<code>` gives one plan away for a set time, free (server: `coupon.rs`, admin: Plans -> Promo codes -> Coupon links). `src/pages/coupon.tsx` is public: it reads the pitch (`GET /api/v1/coupons/{code}`; every failure is `{valid:false}`, one "does not work any more" screen) and shows what the coupon grants in the server's own terms (`pitchTerms`: plan and storage, months, EUR 0 and no card, read-only for 60 days afterwards, reminders at 14, 7 and 1 days, nothing renews by itself). Signed out: "Create your account" holds the code in `sessionStorage` (`bb.coupon`, `src/lib/coupon.ts`) and goes to `/signup` (the document-driven flow or the legacy page: both end in a `needs_plan` account); "Log in" goes to `/login?next=/c/<code>` (`sanitizeRedirect` allowlists exactly `/c/<code>`). `PlanGate` (`app.tsx`) sends a `needs_plan` account that holds a coupon to `/c/<code>?from=signup`, which claims it once on arrival (`POST /api/v1/billing/coupon/redeem`) and dispatches `beebeeb:plan-changed` so the subscription cache re-reads and the gate lifts. A signed-in visitor who merely opens a link always clicks "Claim" first (a claim spends that email address's one use). A final refusal (`coupon_not_applicable`, `coupon_already_used`, `coupon_unavailable`) or a dead link clears the hold, otherwise PlanGate would keep sending the account back instead of to `/choose-plan`; `email_unverified` keeps it (verify, then come back). Settings -> Billing shows `CouponCard` (paste the code or the whole link) for an account with no plan or on legacy Free. The web never sends `X-Beebeeb-Coupon` (spec 5.9: web sends no new onboarding headers); native clients may, and the document answers with `offers.coupon` only where `purchase.cta_allowed` is true. Copy and the typed-error mapping are pure (`src/lib/coupon.ts`, `test/1814-coupon.test.ts`). Proof: `e2e/1814-coupon-links.spec.ts` (admin creates the coupon in the admin UI and copies the link, a new user signs up through it, an existing user redeems from Settings, the same mailbox as a +tag alias is refused, the admin revokes the link; needs the stack in the spec header). Round 2: `?from=signup` claims by itself ONLY when this tab held the code (`shouldAutoClaim`, so a crafted link never spends someone's one use); the hold is cleared on sign-in, 2FA, logout and another tab's logout (`auth-context.tsx`); "Try again" on a failed LOOKUP re-runs the lookup; the lapsed banner, billing card heading and upload notice follow `subscription.lapse_kind` (`lapsedHeading`: "Your free period has ended" for a gift, "Your trial has ended" otherwise) and the `account_lapsed` refusal toast no longer names a trial. After merge run `make sync-shared` at the workspace root (the `lapse_kind` field in `packages/shared/src/types/index.ts` is mirrored there).

## Exit survey (`/surveys/:id?token=...`, task 1920, server PR #213)

The follow-up email after an unpaid trial ended links here. The invitation id + 32-byte token in the link are the credential, so the page needs no session. `src/pages/survey.tsx` draws everything from `GET /api/v1/surveys/{id}?token=` (title, intro, privacy note, questions, thank-you copy; nothing is hard-coded except the error and "already answered" screens), `src/lib/survey.ts` is the pure core + transport (`parseSurvey`, `firstProblem`, `buildAnswers`, `loadSurvey`, `submitSurvey`).

- **Vault-free:** `VaultFreePages` in `app.tsx` renders `/surveys/:id` (exact shape, `src/lib/vault-free-paths.ts`) OUTSIDE AuthProvider / KeyProvider / SyncProvider, so no crypto worker, WASM instantiation or local vault starts for it (every other route mounts them: KeyProvider calls `initCrypto()` on mount). A production build's `index.html` still carries one static `<link rel=preload>` for the WASM bytes on every route (`preloadWasmPlugin`); that cache warm is not removed for this page. The page's own files import nothing from key/crypto/vault/api modules, and the transport is a plain `fetch` with `credentials: 'omit'` (no cookies, no bearer, no global error toast). It still sits in `PUBLIC_ROUTE_PATTERNS` as defence in depth.
- **No credentialed request at all (web#168 review):** the survey says an answer is not linked to the person unless they tick the box, so a signed-in visitor's bearer token or session cookie never travels from this page. It draws `AuthShellFrame` (`src/components/auth-shell-frame.tsx`, the card without the network), not `AuthShell` (= frame + `AnnouncementBanner`, which fetches `/api/v1/announcements` through the shared `request()` client with credentials). So the page shows no admin announcement. `test/1920-survey-review.test.tsx` walks the page's import graph and fails if it reaches `lib/api.ts`, the banner or `auth-shell.tsx`; an e2e test holds a bearer token and an API cookie and checks every request from load to thank-you (only the survey GET and POST reach the API, 0 carry Authorization or Cookie, plus a positive control that a credentialed fetch would carry the cookie).
- **Token hygiene:** read once into component state, then removed from the address bar with `navigate(..., { replace: true })` (i.e. `history.replaceState`); a reload therefore needs the email link again, and the invalid screen says so. The POST carries it in the JSON body, never the URL.
- **One refusal screen:** unknown id, malformed id, wrong or missing token, another invitation's token, expired: the server answers one identical 404 and so does the page ("This survey link is not valid or has expired."), never naming an account or an address. A missing token is that screen without a request. 429 / 5xx / network are "We could not load this" with Try again (not "invalid"). A GET with `answered: true` and a POST 409 both land on "You already answered this".
- **Form rules** mirror the server so the person hears early: required reason, text limits counted in code points (the inputs carry NO `maxLength`, which counts UTF-16 units and would stop 500 emoji at 250; `firstProblem` is the one limit), a detail field only for the selected option (its value goes in `answers[detail.id]`), blank optionals left out, `contact_ok` always sent explicitly. A server 400 `invalid_answers {field, message}` is shown at that field and keeps what was typed.
- **Proof:** `test/1920-survey.test.ts` (26 tests, six mutated and seen red), `test/1920-survey-review.test.tsx` (8 tests: import graph, no Authorization on GET/POST, 500 emoji accepted / 501 refused, no `maxLength`) and `e2e/1920-survey.spec.ts` (11 tests, also run green against `vite preview` of a production build with `E2E_PROD_BUILD=1`; needs a local API from the server's `feat/1920-exit-survey` branch on a scratch DB, invitations seeded into `survey_invitations` with `sha256("beebeeb-survey-token-v1:" + token)`; header lists the environment). The app-wide cookie notice is not mounted there (the page sets no cookies; asserted by a spec test), so nothing fixed sits over the phone-sized form.

## A login of an account that is no longer active (task 1948)

The server answers `403 {"error":"account_suspended"}` to a session whose account is suspended or disabled. `request()` (shared) handles it centrally like `account_deleted`: it clears the legacy bearer, forgets the confirmed session, and fires `registerAccountSuspendedHandler`. `AuthProvider` registers it and runs `signOutInactiveLocally` (`src/lib/account-inactive.ts`): the same local cleanup as `logout()` (coupon hold, dismissed notices, region store, KeyProvider's key + vault clear, `user = null`) WITHOUT `/auth/logout`, which would answer the same 403; other tabs get an `account_inactive` broadcast and do the same locally. Every `AuthShell` page (sign-up, sign-in, onboarding) then shows exactly "You were signed in to an account that is no longer active, so we signed you out on this device." and works as normal; `ProtectedRoute` renders `AccountInactiveScreen` (not active, Sign out, support@beebeeb.io) instead of bouncing to `/login`. Neither surface says why. `userFriendlyError` maps the code to the same sentence. The `bb_session` cookie is httpOnly, so the web cannot remove it: until the server expires it on that 403, a reload sends it again and the notice shows again. A refused trial (`trial_already_used`) reads "This email inbox has already had a free trial, so this account starts without one. You can pick a plan now." everywhere (`TRIAL_ALREADY_USED_COPY`, one trial per inbox, task 1756). Proof: `test/1948-account-inactive.test.tsx`, `e2e/1948-stale-session.spec.ts` (real stack, header lists the environment). After merge run `make sync-shared` at the workspace root (`registerAccountSuspendedHandler` lives in `packages/shared/src/api/`).

## The no-card trial (task 1757, server task 1755)

With the server's `no_card_trial_enabled` switch on, `GET /onboarding` carries `offers.trial` and the web follows it (`src/lib/no-card-trial.ts`, pure; `src/components/no-card-trial.tsx`, drawn; `useDriveData().accountDocument` is the cached document):

- **Start**: `TrialStartCard` (plan picker, "Start 14-day trial, no card", no payment method anywhere) on `/choose-plan`, the billing page and `/account-status`. `POST <offers.trial.start_endpoint>` MUST carry `{plan, billing_cycle}` (`startNoCardTrial` in `api.ts`; the old port posted `{}`). With the switch off the document has no offer and `/choose-plan` is the unchanged card-mandate chooser; with an offer present (available or not) the mandate flow is not drawn.
- **Running**: `TrialBanner` draws `NoCardTrialStatusCard` (end date, days left, cap meter on the drive's LIVE usage, one sentence on the end; the server's `copy.trial_end_over_allowance` wins while it still describes the account). Subscribe goes to paid checkout (`/billing?view=change`); the legacy "Add payment method" / "Pay now" controls are not drawn for a no-card trial (server 409 `trial_convert_unavailable`).
- **Ended**: over the allowance, `BillingBanner` draws `TrialEndedCard` (deletion date, "Free up X, the trash counts", Subscribe where a purchase is allowed) and the generic "Storage full" nudges stay quiet; within it, the account is an allowance account and `TrialEndedAllowanceNotice` says once "Your 2 GB stays".
- **Refusals**: every new 409 has its own words (`userFriendlyError`, `startTrialErrorCopy`, `shareRefusalCopy`, `trialBillingRefusalCopy`); the 413 `is_trial_cap` message names the cap it came with; a typed refusal is never retried as a share-token collision.
- **Proof**: `e2e/1757-no-card-trial.spec.ts` (real stack; header lists the environment; `E2E_1757_ONLY=UNDER,OVER` runs a subset) and `test/1757-no-card-trial.test.tsx`.

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

## File content, names and notes: core 1908 readers (task 1943)

Core chunk format v2 (core#28) binds every content frame to its file id, its upload and its position, and records the file's format INSIDE its encrypted name ("the pin": `chunk_format` 0 = unrecorded, 2 = v2). Web reads every file through core (WASM from core dd7bd76; `WRITE_FORMAT` is still v1, so web writes v1 for new files):

- `src/lib/content-crypto.ts` (`createContentOps`) is the one place content and notes are opened; the crypto worker runs it, and unit tests run the same functions over the committed WASM (`test/helpers/wasm-crypto-mirror.ts`).
- Content: `encrypted-download.ts` reads the metadata FIRST with `readFileMetadata` (core `decrypt_file_metadata_with_key`: name, MIME, pin; it refuses a plaintext or foreign name, and then nothing is fetched: `UnverifiedFileMetadataError`), then opens the frames with a `StreamingDecryptor` (`startDecryptStream(fileKey, fileId, pin)`) and calls `finish()` (v2 truncation). Any error discards the plaintext; the streaming download is aborted. `decryptEncryptedBytes` / `pipeDecryptedChunks` take `{ fileId, pin }`; `decryptVersionToBlob` takes the file's `name_encrypted` (versions share the file's pin).
- The generic `decryptChunk` is for key unwrapping only; `test/1943-no-generic-content-decrypt.test.ts` lists the files allowed to call it and fails on any new content or raw-key name use.
- Names for display: `decryptFileMetadata`, `decryptManyNames` (listing), trash, shares and activity use core's `readNameMetadata` (name subkey first, then the legacy raw key).
- Notes: `src/lib/file-note.ts` (`openFileNote` = core `decrypt_note`; `sealFileNote` = core `encrypt_note_for` with the pin of THIS file or folder, always from `readFileMetadata`: the server's `is_folder` flag never picks the reader, or a server could flag a v2 file as a folder with a plaintext name and get a raw-key note). A plaintext (legacy) name gets no note: `UnverifiedFileMetadataError`, and the details panel says so. Notes of unrecorded files are still raw-key sealed until the gated switch, so older tabs open them.
- Replace (a new version of an existing file id): pass `{ replaceOf: { nameEncrypted } }` to `encryptedUpload`; it reads the pin, calls `applyRecordedPin` before the first chunk, and sends the replaced file's own `name_encrypted` unchanged on init (never a fresh, unpinned name). A NEW file never passes it and never applies a pin (`test/1943-writer-pin.test.ts`).
- Resume obeys core's rule: the IndexedDB resume record carries `chunk_format` (the frames the session holds, recorded before the first PUT) and `replace_pin`; before continuing stored frames the upload asks `resumePolicy`, and anything but a recorded v1 session resumed by a v1 writer (a pre-1943 record included) uploads from chunk 0 into a fresh session, never into the old one (`test/1943-resume-rule.test.ts`). The restart never calls the file-wide `POST /files/{id}/upload/abandon` (it would revert another tab's or device's live upload of the same file; the server has no session-scoped abandon): the fresh init takes over an expired lease and answers 409 to a live one, and the old resume record is kept until the fresh init succeeds (`test/1943-restart-no-file-abandon.test.ts`).
- Proof in a browser: `e2e/1943-v1-compat.spec.ts` (own config; two web origins, origin/main and this code, against one local API; see its header): what the current web wrote downloads byte-identical here (streamed and buffered), previews, opens by share link and keeps its note, and the note and version written here open in the current web.
- Not yet on core (before the v2 write switch): thumbnails (`thumbnail.ts`, WebCrypto raw key), new-file names (`encryptFilename`), renames (drop the pin; core's name writer takes only the master key, so file-request files need a key-based variant first), the file-request uploader (`encryptChunk`), and the single-file share link (the server's share view carries no `file_id`, so a v2-pinned file is refused there with an honest message).

## Sync ordering: the per-user `user_seq` (task 1973, server#233)

`src/lib/sync-client.ts` orders remote ops and detects missed ones. `seq_id` is ONE global sequence, so another user's op sits between any two of yours; checking `seq_id === lastSeq + 1` made nearly every live op look missed and cost a full `/sync/snapshot` (O(vault)) per op per tab (scale audit R3). A server with server#233 numbers each user's ops 1, 2, 3, ... with no gaps (`user_seq` on every op, snapshot, page and POST `applied[]`; `GET /sync/ops?since_user_seq=N` with `head_user_seq`).
- **Feature detection:** a snapshot with a numeric `user_seq` switches the client to user_seq mode (`adoptSnapshotCursors`); one without it keeps the global-seq behaviour exactly. The mode only changes inside a snapshot merge, so a server upgrade or rollback costs exactly one snapshot.
- **Cursor:** in user_seq mode contiguity is `user_seq === lastUserSeq + 1`. A real hole is paged in by `catchUpByUserSeq` (`?since_user_seq=<cursor>` until `head_user_seq`); only a failed, contradictory (no/low `head_user_seq`, no progress) or over-long (20 pages) catch-up falls back to a snapshot. Duplicates and older `user_seq`s are ignored.
- **Persisted cursor:** `bb_sync_last_seq` stays a GLOBAL cursor (kept as a forward-only floor for a rollback). It is never read as a user_seq: `lastUserSeq` is in memory and seeded only from a snapshot (every boot merges one first, task 1700; the storage key is not per account).
- **POST `applied[]`** with a `user_seq` goes through the same ordered path as the stream echo, so the cursor moves without waiting for the echo. An op with `user_seq` null/absent in user_seq mode (an old node mid rolling deploy) is applied at once and re-delivered with its number by the next catch-up.
- **Pending ops are confirmed by IDENTITY, never by sequence (PR #173 round 2, both modes).** Any server-applied op carrying a pending `client_op_id` (stream echo, catch-up page, POST `applied[]`, an op found in the op log, a held op a snapshot covers) clears that pending entry, whatever its number relative to the cursor; only the tree application of an op at or below the cursor is skipped (`confirmPending`). The POST answer's position is persisted on the entry (`applied_seq_id` / `applied_user_seq`): a snapshot that covers it confirms it before the merge (`confirmPendingCoveredBy`), so the op is neither re-applied over the snapshot nor resubmitted, also after a reload. A pending op whose answer never arrived is looked up by `client_op_id` in `GET /sync/ops?since=<cursor at submit>` before the next snapshot merges (`locateOrphanedPending`, at most 5 pages). Reason: the server does NOT deduplicate a resubmitted `client_op_id` (`apply_one_op` re-executes it and records a new op), so a resubmitted stale rename re-wrote another device's newer value. `flushPending` never resubmits an op with a recorded position.
- **Every pending entry is either resubmitted or clearable by a snapshot (PR #173 round 3).** One predicate, `hasRecordedPosition` (a finite `applied_seq_id`), decides both: `flushPending` resubmits exactly the entries without one, and `pendingCoveredBy` clears every entry with one. Coverage compares `user_seq` only when BOTH the snapshot and the entry carry one; otherwise it compares the entry's `applied_seq_id` with the snapshot's global `seq_id`, which every snapshot carries. That fallback is for a POST `applied[]` answered by a node that predates server#233 (no `user_seq`) while the client is in user_seq mode, and for a legacy-mode entry when the next snapshot is numbered. Without it such an entry was cleared by no numbered snapshot and never resubmitted: with its echo missed it stayed pending for good and was re-applied over every snapshot (Codex P2 at 04ad1c89). An entry with only `applied_user_seq` (never written by this client) counts as unrecorded: it is looked up in the op log and resubmitted only if it is not found there. Proof: the r3 tests in `test/1973-sync-pending-confirm.test.ts`. The file's `afterEach` checks this invariant after every test: any pending entry in memory or storage that has a recorded position must be cleared by a numbered snapshot that is far enough ahead AND by an unnumbered one.
- **Deploy order:** web AFTER server#233. Proof: `test/1973-sync-user-seq.test.ts` (FakeServer with other users writing in between; red on main, one mutation per test) and `test/1973-sync-pending-confirm.test.ts` (round 2: overtaken POST, held echo, reload after commit, in both modes, plus over-clearing guards).

## Critical prop chains

When opening the ShareDialog, ALWAYS pass `isFolder={file.is_folder}`. Folder sharing encrypts all children under the folder's key: reuse the newest openable key among the folder's status-active invites (invited/claimed/approved; expires_at ignored) via `findExistingFolderKey`; exact verification arrives with the server key fingerprint (design K), mint a new one only when the folder has no active invite (task 2133) — without this prop, folder shares silently create regular file shares that don't work.

For full component reference: use `/beebeeb:components` skill.

## Checkout return page for native apps (task 1743)

`/return-to-app` (`src/pages/return-to-app.tsx`) is where a native app's Mollie checkout returns the SYSTEM browser: the server sends `redirectUrl = {APP_URL}/return-to-app` when the app asks `POST /billing/checkout` for `return_kind: "app"` (server `checkout_return::APP_RETURN_PATH`; the client never supplies a URL). The path is a contract with the server: do not rename it. The page is public (it is in `PUBLIC_ROUTE_PATTERNS`, so a stale session's 401 cannot bounce it to `/login`), makes no API call, and does not claim the payment succeeded, because Mollie redirects here after a cancel or a failure too; the app learns the real state by polling `GET /onboarding`. Proof: `e2e/1743-return-to-app.spec.ts` (`--config=e2e/1743-return-to-app.config.ts`; test 1 needs only a dev server, the opt-in real rung needs a local API with the mock Mollie and a seeded session, see the spec header).

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
- **Region choice (task 1919, by COUNTRY since task 2050, `/settings/data-residency`):** "Europe" is the
  DEFAULT (any of our European data centers, the server places the data); below it the person pins new
  uploads to one COUNTRY, a country that is not live is listed "Coming soon", not selectable, and a
  pinned country has an off-by-default "Only store in <country>" toggle (strict, task 1952). A CITY is
  never shown, sent or read (Guus 2026-10-19: the cities together identify the provider;
  `docs/canon/data-residency.md`). The list is the SERVER'S: `choices` of `GET /api/v1/me/region` (same
  array as the public `GET /api/v1/storage-regions`: `id` `europe`|`de`|`fi`..., `kind` `region`|`country`),
  parsed by `src/lib/storage-regions.ts` (pure) and held in `src/lib/use-region-choices.ts` (one store
  for the page, the sidebar's region row and nothing else). No source file keeps a city, country, id or
  provider (`test/1919-storage-regions.test.ts` greps for it) and `test/2050-no-city-in-copy.test.ts`
  fails on a city name in any code in `src/` (comments and `lib/timezones.ts` excepted). `PUT /me/region`
  sends a choice's `id` verbatim plus `region_strict` (PUT replaces the whole choice; `null` clears; a
  failed list fetch is an honest error with Retry, never an invented list). A server older than 2050
  (one `kind: "datacenter"` entry per city) is folded into one row per country by `parseChoices`; a
  datacenter with no country is dropped, never shown by its city. A file's location on the drive row and
  in the encryption-details panel is the server's `storage_location.country` (`fileStorageCountry`, never
  the deprecated `city`), "Europe" when absent. The upload init only says `region: "europe"`, so the
  upload card names no country. A 409 `region_unavailable_strict` upload refusal is worded by
  `strictRefusalMessage` (reads `country`, never the `city` alias). Mocked-API Playwright spec:
  `bunx playwright test --config=e2e/2050-location-by-country.config.ts` (no server; screenshots in
  `E2E_EVIDENCE_DIR`). The opt-in real-stack spec `e2e/1919-region-choice.spec.ts` still asserts the
  per-datacenter model and needs a rewrite against the 2050 server (follow-up).
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
