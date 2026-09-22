import { describe, expect, test } from 'bun:test'

/**
 * Task 1471 sweep — `settings/privacy.tsx`'s `downloadExport` fetched the
 * GDPR data-export download URL with ONLY a conditional `Authorization:
 * Bearer <token>` header — no `credentials: 'include'` at all, unlike every
 * other raw-fetch call site in this codebase (api.ts, thumbnail.ts,
 * encrypted-download.ts all ship the cookie via `credentials: 'include'`
 * AND an optional Bearer header). For a cookie-only user (the legacy
 * `bb_session` localStorage slot cleared post-migration, task 0447) that
 * left the request with NO auth at all — worse than the pricing.tsx bug,
 * which at least redirected somewhere; this one 401s and the download
 * silently fails for basically every real user hitting "Download" on their
 * GDPR export.
 *
 * This page is behind `ProtectedRoute`, so no auth-context gating is
 * needed here (unlike pricing.tsx/share-view.tsx/ws-context.tsx) — the fix
 * is just always shipping the cookie, exactly like every other download
 * call site in `api.ts`. `buildDataExportRequestInit` is the extracted,
 * directly-testable `RequestInit` builder (same no-render-harness
 * convention as the rest of this task's tests) — takes an injectable
 * `getTokenFn` rather than reading real localStorage through the shared
 * `token` module: a FULL-SUITE run showed `test/session-expiry-gate.test.ts`'s
 * `mock.module('.../token', ...)` leaking into this file (bun's
 * `mock.module` is process-global — same hazard
 * test/pricing-checkout-intent-1469.test.ts's header comment already
 * documents for exactly this reason), which silently made `getToken()`
 * return null here regardless of what localStorage held. Passing a stub
 * function sidesteps the module registry entirely.
 */

const { buildDataExportRequestInit } = await import('../src/pages/settings/privacy')

describe('buildDataExportRequestInit() — the export download always ships the session cookie (task 1471)', () => {
  test('a cookie-only user (no bb_session localStorage value) still gets credentials: "include"', () => {
    const init = buildDataExportRequestInit(() => null)
    expect(init.credentials).toBe('include')
    // No legacy token → no Bearer header, but the cookie must still travel.
    expect((init.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined()
  })

  test('a legacy bearer token, if still present, is forwarded ADDITIONALLY (not instead of) the cookie', () => {
    const init = buildDataExportRequestInit(() => 'legacy-token-abc')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer legacy-token-abc')
  })
})
