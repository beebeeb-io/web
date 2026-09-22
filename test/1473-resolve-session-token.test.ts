import { describe, expect, test } from 'bun:test'

/**
 * Task 1473 — `key-context.tsx`'s `handoffToTauri` read the legacy
 * `bb_session` localStorage slot for the raw session token
 * (`const token = getToken(); if (!token) return`) and silently gave up
 * when it was null. Post-cookie-migration (task 0447) that slot is empty
 * for every ordinary cookie-session user, so the desktop auto-unlock
 * handoff never fired for them — only for the narrow window where a
 * legacy localStorage token still happened to exist. `cli-auth.tsx:219`
 * already has the correct fallback: `getToken()` first, then
 * `GET /auth/session-token` (cookie-authenticated) when null.
 *
 * `resolveSessionToken()` is the extracted, shared implementation (now the
 * ONE place both `handoffToTauri` and `cli-auth.tsx` get the raw token
 * from). Deliberately takes injectable `getTokenFn` / `requestFn` deps
 * rather than `mock.module()`-ing `packages/shared/src/api/token` —
 * `mock.module` is process-global in bun and this exact module is already
 * mocked by test/rate-limit-retry.test.ts and
 * test/1471-ws-context-auth-gate.test.ts; a second, differently-shaped
 * mock of the same path in a full-suite run is "last-registered wins, can't
 * relink" (documented in test/helpers/upload-share-mocks.ts and repeated in
 * test/pricing-checkout-intent-1469.test.ts's header comment) — DI sidesteps
 * it entirely, same convention as
 * test/1471-privacy-export-download-credentials.test.ts's
 * `buildDataExportRequestInit(getTokenFn)`.
 */

const { resolveSessionToken } = await import('../packages/shared/src/api/request')

describe('resolveSessionToken() — the shared raw-token resolver (task 1473)', () => {
  test('legacy bb_session slot present → returns it directly, NO network call', async () => {
    let requestCalls = 0
    const token = await resolveSessionToken({
      getTokenFn: () => 'legacy-token-xyz',
      requestFn: async () => {
        requestCalls++
        return { token: 'should-not-be-used' }
      },
    })
    expect(token).toBe('legacy-token-xyz')
    expect(requestCalls).toBe(0)
  })

  test('legacy slot null, cookie session → falls back to GET /auth/session-token and resolves the token', async () => {
    const calls: string[] = []
    const token = await resolveSessionToken({
      getTokenFn: () => null,
      requestFn: async (path: string) => {
        calls.push(path)
        return { token: 'resolved-from-cookie-session' }
      },
    })
    expect(token).toBe('resolved-from-cookie-session')
    expect(calls).toEqual(['/api/v1/auth/session-token'])
  })

  test('legacy slot null, endpoint 401s (no session) → resolves to null, never throws', async () => {
    const token = await resolveSessionToken({
      getTokenFn: () => null,
      requestFn: async () => {
        throw new Error('401 Unauthorized')
      },
    })
    expect(token).toBeNull()
  })

  test('legacy slot null, endpoint 403s (not a cookie session — PAT/Bearer-only caller) → resolves to null', async () => {
    const token = await resolveSessionToken({
      getTokenFn: () => null,
      requestFn: async () => {
        throw new Error('403 Forbidden')
      },
    })
    expect(token).toBeNull()
  })
})
