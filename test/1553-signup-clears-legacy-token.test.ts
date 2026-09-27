import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Task 1553 — onboarding.tsx's signup flow (opaqueRegisterFinish path)
 * writes the legacy `bb_session` bearer token to localStorage via
 * `opaqueRegisterFinish`'s internal `setToken()` call and never clears it
 * afterwards. login.tsx's password-login path deliberately does the
 * opposite: `opaqueLoginFinish` also calls `setToken()` internally, but
 * login.tsx immediately calls `clearToken()` right after — "server set the
 * bb_session cookie, drop any stale localStorage token so it doesn't get
 * sent as a bearer header that shadows the fresh cookie." A leftover token
 * silently re-authenticates the account on the next boot via
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
 *     clearToken() right after; no fix needed there.
 *   - login.tsx handlePasskeyLogin (passkey login) — LEAKED, fixed here.
 *   - vault-unlock.tsx (passkey step-up unlock while already signed in) —
 *     LEAKED, fixed here.
 *   - recover-with-phrase.tsx (12-word recovery phrase reset) — LEAKED,
 *     fixed here.
 *   - email-code signup (task 1525, web PR #79) — NOT merged into main as
 *     of this task; out of scope per this task's own conditional ("if
 *     merged"). Flagged in the task file's Notes for whoever merges #79.
 */

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
}

describe('onboarding.tsx signup no longer leaves a stale bb_session bearer token (1553)', () => {
  test('imports clearToken from ../lib/api', () => {
    const src = read('src/pages/onboarding.tsx')
    const importBlock = src.slice(0, src.indexOf('\n\n', src.indexOf('from \'../lib/api\'')))
    expect(importBlock).toMatch(/\bclearToken\b/)
  })

  test('calls clearToken() after opaqueRegisterFinish succeeds, before the vault is wrapped', () => {
    const src = read('src/pages/onboarding.tsx')
    const registerCallIdx = src.indexOf('const registerResult = await opaqueRegisterFinish(')
    expect(registerCallIdx).toBeGreaterThan(-1)
    const vaultWrapIdx = src.indexOf('setMasterKey(masterKeyBytes', registerCallIdx)
    expect(vaultWrapIdx).toBeGreaterThan(registerCallIdx)
    const between = src.slice(registerCallIdx, vaultWrapIdx)
    // Mirrors login.tsx's password-login path: server already set the
    // bb_session cookie in the register-finish response, so the localStorage
    // copy opaqueRegisterFinish() just wrote (its own internal setToken()
    // call) is immediately stale and must be dropped.
    expect(between).toContain('clearToken()')
  })
})

describe('login.tsx passkey login also clears the stale bearer (1553 sweep)', () => {
  test('handlePasskeyLogin calls clearToken() after setToken(result.session_token)', () => {
    const src = read('src/pages/login.tsx')
    const setTokenIdx = src.indexOf('setToken(result.session_token)')
    expect(setTokenIdx).toBeGreaterThan(-1)
    const refreshIdx = src.indexOf('await refreshUser()', setTokenIdx)
    expect(refreshIdx).toBeGreaterThan(setTokenIdx)
    const between = src.slice(setTokenIdx, refreshIdx)
    expect(between).toContain('clearToken()')
  })
})

describe('vault-unlock.tsx passkey step-up also clears the stale bearer (1553 sweep)', () => {
  test('imports clearToken and calls it after finishPasskeyLogin succeeds', () => {
    const src = read('src/components/vault-unlock.tsx')
    const importBlock = src.slice(0, src.indexOf('\n\n', src.indexOf('from \'../lib/api\'')))
    expect(importBlock).toMatch(/\bclearToken\b/)

    const finishCallIdx = src.indexOf(
      'const finishResult = await finishPasskeyLogin(credentialData, startRes.auth_state, startRes.user_id)',
    )
    expect(finishCallIdx).toBeGreaterThan(-1)
    const refreshIdx = src.indexOf('await refreshUser()', finishCallIdx)
    expect(refreshIdx).toBeGreaterThan(finishCallIdx)
    const between = src.slice(finishCallIdx, refreshIdx)
    expect(between).toContain('clearToken()')
  })
})

describe('recover-with-phrase.tsx also clears the stale bearer (1553 sweep)', () => {
  test('imports clearToken and calls it after recoverWithPhraseFinalize succeeds', () => {
    const src = read('src/pages/recover-with-phrase.tsx')
    const importBlock = src.slice(0, src.indexOf('\n\n', src.indexOf('from \'../lib/api\'')))
    expect(importBlock).toMatch(/\bclearToken\b/)

    const finalizeCallIdx = src.indexOf('const finalizeResult = await recoverWithPhraseFinalize(')
    expect(finalizeCallIdx).toBeGreaterThan(-1)
    const wrapIdx = src.indexOf('setMasterKey(derivedMasterKey', finalizeCallIdx)
    expect(wrapIdx).toBeGreaterThan(finalizeCallIdx)
    const between = src.slice(finalizeCallIdx, wrapIdx)
    expect(between).toContain('clearToken()')
  })
})
