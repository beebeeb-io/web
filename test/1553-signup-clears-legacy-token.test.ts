import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Task 1553 — onboarding.tsx's signup flow (opaqueRegisterFinish path)
 * writes the legacy `bb_session` bearer token to localStorage via
 * `opaqueRegisterFinish`'s internal `setToken()` call and never clears it
 * afterwards. login.tsx's password-login path deliberately does the
 * opposite: `opaqueLoginFinish` also calls `setToken()` internally, but
 * login.tsx immediately calls a token-clearing call right after — "server
 * set the bb_session cookie, drop any stale localStorage token so it
 * doesn't get sent as a bearer header that shadows the fresh cookie." A
 * leftover token silently re-authenticates the account on the next boot via
 * `POST /auth/upgrade-session` (auth-context.tsx's `boot()`) even after the
 * httpOnly session cookie itself is gone.
 *
 * This repo's `bun test` harness has no @testing-library/react / jsdom (see
 * test/1531-account-binding.test.ts and test/1545-share-nudge-false-claim.test.ts
 * for the established precedent of source-level structural assertions in
 * lieu of rendering), so these are structural/ordering checks on the source
 * — the actual runtime behavior (no bb_session in localStorage after
 * signup; a reload after the cookie is deleted does NOT silently
 * re-authenticate) is proven by the real-stack e2e spec
 * e2e/1553-signup-clears-legacy-token.spec.ts.
 *
 * Sweep (per the task's Verification line): every OTHER client auth entry
 * point that completes a fresh server session and thus receives a
 * `session_token` was checked for the identical shape of leak (the server
 * sets the SET_COOKIE `bb_session` cookie itself on every one of these
 * endpoints — beebeeb-api/src/routes/opaque_auth.rs, passkeys.rs,
 * recovery.rs — so the client-side localStorage copy is always redundant
 * once the response returns):
 *   - login.tsx handleSubmit / handle2faVerify / handlePasskeyFallback (OPAQUE
 *     password login, 2FA, passkey-fallback-password) — already called
 *     clearToken() right after; no fix needed there ***at the time***.
 *   - login.tsx handlePasskeyLogin (passkey login) — LEAKED, fixed here.
 *   - vault-unlock.tsx (passkey step-up unlock while already signed in) —
 *     LEAKED, fixed here.
 *   - recover-with-phrase.tsx (12-word recovery phrase reset) — LEAKED,
 *     fixed here.
 *   - email-code signup (task 1525, web PR #79) — NOT merged into main as
 *     of this task; out of scope per this task's own conditional ("if
 *     merged"). Flagged in the task file's Notes for whoever merges #79.
 *
 * ── PR #109 review round 2 (2026-09-27, Codex P2) ──────────────────────
 * `clearToken()` does more than drop the localStorage token: it also fires
 * the registered `onTokenCleared` callback, which `src/lib/api.ts` wires to
 * `clearEmail()` (removing `bb_email`). Every one of the ABOVE call sites —
 * including the three that "already called clearToken() right after" and
 * were declared no-fix-needed — completes a fresh server session and, in
 * four of the seven cases, itself just wrote `bb_email` via an internal
 * `setEmail()` call (`opaqueRegisterFinish`, `opaqueLoginFinish` ×3 call
 * sites in login.tsx). Calling `clearToken()` right after immediately wipes
 * the `bb_email` that call just wrote — the user has NOT logged out, so
 * `VaultUnlock.handlePasskeyUnlock()` (which reads `bb_email` via
 * `getEmail()`) breaks the next time the vault locks.
 *
 * Fix: `packages/shared/src/api/token.ts` gets a new `clearLegacyBearer()`
 * that drops only the localStorage token and never fires `onTokenCleared`.
 * ALL SEVEN call sites below now use it instead of `clearToken()` —
 * `clearToken()` stays reserved for an ACTUAL logout / session-expiry path,
 * where clearing `bb_email` alongside the token is correct.
 *
 * Separate finding from the same review pass: recoverWithPhraseFinalize()
 * (unlike opaqueRegisterFinish/opaqueLoginFinish) never called setEmail()
 * internally at all — recover-with-phrase.tsx now stamps `bb_email` itself
 * right after the finalize call succeeds (see its own describe block below).
 */

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
}

/** A real statement calling `name()` on its own line — not a comment
 *  mentioning it in prose (this file's own source comments, and the
 *  production code's review-trail comments, both say things like "NOT
 *  clearToken()" without ever intending that as a call). */
function callsBareStatement(src: string, name: string): boolean {
  return indexOfBareStatement(src, name) !== -1
}

/** Index of the real `name()` statement line (see callsBareStatement) — -1
 *  if it only appears inside a `//` comment, or not at all. Needed because
 *  this task's own review-trail comments say things like "clearLegacyBearer()
 *  drops only the redundant..." ahead of the real statement, and a plain
 *  `indexOf('clearLegacyBearer()')` would find that prose first. */
function indexOfBareStatement(src: string, name: string): number {
  const m = new RegExp(`^[ \\t]*${name}\\(\\)[ \\t]*$`, 'm').exec(src)
  return m ? m.index : -1
}

describe('onboarding.tsx signup no longer leaves a stale bb_session bearer token (1553)', () => {
  test('imports clearLegacyBearer (not clearToken) from ../lib/api', () => {
    const src = read('src/pages/onboarding.tsx')
    const importBlock = src.slice(0, src.indexOf('\n\n', src.indexOf('from \'../lib/api\'')))
    expect(importBlock).toMatch(/\bclearLegacyBearer\b/)
  })

  test('calls clearLegacyBearer() (never clearToken()) after opaqueRegisterFinish succeeds, before the vault is wrapped', () => {
    const src = read('src/pages/onboarding.tsx')
    const registerCallIdx = src.indexOf('const registerResult = await opaqueRegisterFinish(')
    expect(registerCallIdx).toBeGreaterThan(-1)
    const vaultWrapIdx = src.indexOf('setMasterKey(masterKeyBytes', registerCallIdx)
    expect(vaultWrapIdx).toBeGreaterThan(registerCallIdx)
    const between = src.slice(registerCallIdx, vaultWrapIdx)
    // clearLegacyBearer(), NOT clearToken() — opaqueRegisterFinish's own
    // internal setEmail() call, a few lines above, just wrote bb_email;
    // clearToken() would immediately wipe it via the onTokenCleared →
    // clearEmail() callback even though this account is not logging out.
    expect(callsBareStatement(between, 'clearLegacyBearer')).toBe(true)
    expect(callsBareStatement(between, 'clearToken')).toBe(false)
  })
})

describe('login.tsx passkey login also clears the stale bearer (1553 sweep)', () => {
  test('handlePasskeyLogin calls clearLegacyBearer() (never clearToken()) after setToken(result.session_token)', () => {
    const src = read('src/pages/login.tsx')
    const setTokenIdx = src.indexOf('setToken(result.session_token)')
    expect(setTokenIdx).toBeGreaterThan(-1)
    const refreshIdx = src.indexOf('await refreshUser()', setTokenIdx)
    expect(refreshIdx).toBeGreaterThan(setTokenIdx)
    const between = src.slice(setTokenIdx, refreshIdx)
    expect(callsBareStatement(between, 'clearLegacyBearer')).toBe(true)
    expect(callsBareStatement(between, 'clearToken')).toBe(false)
  })
})

describe('vault-unlock.tsx passkey step-up also clears the stale bearer (1553 sweep)', () => {
  test('imports clearLegacyBearer (not clearToken) and calls it after finishPasskeyLogin succeeds', () => {
    const src = read('src/components/vault-unlock.tsx')
    const importBlock = src.slice(0, src.indexOf('\n\n', src.indexOf('from \'../lib/api\'')))
    expect(importBlock).toMatch(/\bclearLegacyBearer\b/)

    const finishCallIdx = src.indexOf(
      'const finishResult = await finishPasskeyLogin(credentialData, startRes.auth_state, startRes.user_id)',
    )
    expect(finishCallIdx).toBeGreaterThan(-1)
    const refreshIdx = src.indexOf('await refreshUser()', finishCallIdx)
    expect(refreshIdx).toBeGreaterThan(finishCallIdx)
    const between = src.slice(finishCallIdx, refreshIdx)
    expect(callsBareStatement(between, 'clearLegacyBearer')).toBe(true)
    expect(callsBareStatement(between, 'clearToken')).toBe(false)
  })
})

describe('recover-with-phrase.tsx also clears the stale bearer (1553 sweep)', () => {
  test('imports clearLegacyBearer (not clearToken) and calls it after recoverWithPhraseFinalize succeeds', () => {
    const src = read('src/pages/recover-with-phrase.tsx')
    const importBlock = src.slice(0, src.indexOf('\n\n', src.indexOf('from \'../lib/api\'')))
    expect(importBlock).toMatch(/\bclearLegacyBearer\b/)

    const finalizeCallIdx = src.indexOf('const finalizeResult = await recoverWithPhraseFinalize(')
    expect(finalizeCallIdx).toBeGreaterThan(-1)
    const wrapIdx = src.indexOf('setMasterKey(derivedMasterKey', finalizeCallIdx)
    expect(wrapIdx).toBeGreaterThan(finalizeCallIdx)
    const between = src.slice(finalizeCallIdx, wrapIdx)
    expect(callsBareStatement(between, 'clearLegacyBearer')).toBe(true)
    expect(callsBareStatement(between, 'clearToken')).toBe(false)
  })

  test('review-round-2 finding: recoverWithPhraseFinalize never sets bb_email itself, so recover-with-phrase.tsx now stamps it explicitly with the recovered account\'s own email', () => {
    const src = read('src/pages/recover-with-phrase.tsx')
    const importBlock = src.slice(0, src.indexOf('\n\n', src.indexOf('from \'../lib/api\'')))
    expect(importBlock).toMatch(/\bsetEmail as setStoredEmail\b/)

    const finalizeCallIdx = src.indexOf('const finalizeResult = await recoverWithPhraseFinalize(')
    const wrapIdx = src.indexOf('setMasterKey(derivedMasterKey', finalizeCallIdx)
    const between = src.slice(finalizeCallIdx, wrapIdx)
    expect(between).toContain('setStoredEmail(email')
    // Must be stamped BEFORE the redundant localStorage token is dropped —
    // order doesn't change behavior here (clearLegacyBearer never touches
    // bb_email), but matches every other auth-completing flow's ordering.
    expect(between.indexOf('setStoredEmail(email')).toBeLessThan(
      indexOfBareStatement(between, 'clearLegacyBearer'),
    )
  })
})

describe('login.tsx password / 2FA / passkey-fallback paths (1553 review round 2 — same latent issue)', () => {
  test('handleSubmit (OPAQUE password login) calls clearLegacyBearer(), never clearToken()', () => {
    const src = read('src/pages/login.tsx')
    // opaqueLoginFinish's own internal setEmail(email) fires inside this
    // call — the very next token-clearing call must not undo it.
    const finishIdx = src.indexOf('const loginResult = await apiOpaqueLoginFinish(email, toBase64(loginFinish.message), serverResp.server_state)')
    expect(finishIdx).toBeGreaterThan(-1)
    const refreshIdx = src.indexOf('await refreshUser()', finishIdx)
    expect(refreshIdx).toBeGreaterThan(finishIdx)
    const between = src.slice(finishIdx, refreshIdx)
    expect(callsBareStatement(between, 'clearLegacyBearer')).toBe(true)
    expect(callsBareStatement(between, 'clearToken')).toBe(false)
  })

  test('handle2faVerify calls clearLegacyBearer(), never clearToken()', () => {
    const src = read('src/pages/login.tsx')
    const verifyIdx = src.indexOf('verifyResult = await verify2fa(partialToken, code)')
    expect(verifyIdx).toBeGreaterThan(-1)
    const checkIdx = src.indexOf('if (!verifyResult.user_id)', verifyIdx)
    expect(checkIdx).toBeGreaterThan(verifyIdx)
    const between = src.slice(verifyIdx, checkIdx)
    expect(callsBareStatement(between, 'clearLegacyBearer')).toBe(true)
    expect(callsBareStatement(between, 'clearToken')).toBe(false)
  })

  test('handlePasskeyFallback calls clearLegacyBearer(), never clearToken()', () => {
    const src = read('src/pages/login.tsx')
    const finishIdx = src.indexOf('const fallbackLoginResult = await apiOpaqueLoginFinish(email, toBase64(loginFinish.message), serverResp.server_state)')
    expect(finishIdx).toBeGreaterThan(-1)
    const refreshIdx = src.indexOf('await refreshUser()', finishIdx)
    expect(refreshIdx).toBeGreaterThan(finishIdx)
    const between = src.slice(finishIdx, refreshIdx)
    expect(callsBareStatement(between, 'clearLegacyBearer')).toBe(true)
    expect(callsBareStatement(between, 'clearToken')).toBe(false)
  })

  test('login.tsx no longer imports clearToken at all — every call site was converted', () => {
    const src = read('src/pages/login.tsx')
    const importLine = src.split('\n').find((l) => l.includes('from \'../lib/api\''))
    expect(importLine).toBeDefined()
    expect(importLine).not.toMatch(/\bclearToken\b/)
    expect(importLine).toMatch(/\bclearLegacyBearer\b/)
  })
})

describe('packages/shared/src/api/token.ts — clearLegacyBearer() drops the token WITHOUT the onTokenCleared side effect (1553 review round 2)', () => {
  test('clearLegacyBearer is exported and removes the token from localStorage', () => {
    const src = read('packages/shared/src/api/token.ts')
    const fnIdx = src.indexOf('export function clearLegacyBearer(): void {')
    expect(fnIdx).toBeGreaterThan(-1)
    const closeIdx = src.indexOf('\n}', fnIdx)
    const body = src.slice(fnIdx, closeIdx)
    expect(body).toContain('localStorage.removeItem(tokenStorageKey)')
  })

  test('clearLegacyBearer never references onTokenCleared — clearToken still does', () => {
    const src = read('packages/shared/src/api/token.ts')

    const clearTokenIdx = src.indexOf('export function clearToken(): void {')
    const clearLegacyIdx = src.indexOf('export function clearLegacyBearer(): void {')
    expect(clearTokenIdx).toBeGreaterThan(-1)
    expect(clearLegacyIdx).toBeGreaterThan(clearTokenIdx)

    const clearTokenBody = src.slice(clearTokenIdx, clearLegacyIdx)
    expect(clearTokenBody).toContain('onTokenCleared')

    const clearLegacyBody = src.slice(clearLegacyIdx)
    expect(clearLegacyBody).not.toContain('onTokenCleared')
  })

  test('clearLegacyBearer is re-exported from the api barrel and from src/lib/api.ts', () => {
    const barrel = read('packages/shared/src/api/index.ts')
    expect(barrel).toMatch(/\bclearLegacyBearer\b/)

    const apiTs = read('src/lib/api.ts')
    // Imported from '@beebeeb/shared' AND re-exported so app code can use it.
    const importBlock = apiTs.slice(0, apiTs.indexOf('} from \'@beebeeb/shared\''))
    expect(importBlock).toMatch(/\bclearLegacyBearer\b/)
    const reExportBlock = apiTs.slice(apiTs.indexOf('export {'), apiTs.indexOf('}', apiTs.indexOf('export {')))
    expect(reExportBlock).toMatch(/\bclearLegacyBearer\b/)
  })
})
