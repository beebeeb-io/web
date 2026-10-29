/**
 * Task 1610 — TotpSection's FIRST render, by account status.
 *
 * Bug: the component ran its OWN `getMe()` fetch and started `enabled` at
 * `false` while it was in flight — so an ALREADY-enrolled account's first
 * render (before that fetch resolved) showed the "Set up" button, which
 * calls `setup2fa()` with no code/token and 403s `confirmation_required`
 * once 2FA is on (server verified correct, not loosened).
 *
 * `renderToStaticMarkup` runs exactly one synchronous pass and never fires
 * effects — the same as the FIRST paint a real browser would produce before
 * any async work settles. Since the fix reads `user.totp_enabled` straight
 * from `useAuth()` (already resolved by the time this page can mount — see
 * `ProtectedRoute` in app.tsx) instead of a second independent fetch, that
 * first paint must already be correct with no fetch involved at all. This
 * is the exact regression the task's repro item describes, proven at the
 * cheapest possible layer.
 *
 * Plain `.ts` + `React.createElement` (no JSX): this repo's `bun test`
 * (bunfig.toml `[test] root = "test"`) does not pick up `.test.tsx` files at
 * all under a bare `bun test` — confirmed against the two PRE-EXISTING
 * `.test.tsx` files in this directory, neither of which appears in the
 * counted run either. That gap is out of scope for task 1610 to fix
 * repo-wide; sidestepping it here keeps this file inside the real,
 * asserted `N pass` truth line instead of silently rotting unrun.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mockModuleScoped } from './helpers/scoped-module-mock'

// Mutable binding the mocked useAuth() below reads on every call.
let mockUser: { totp_enabled: boolean } | null = null

await mockModuleScoped('../src/lib/auth-context', import.meta.dir, (real) => ({
  useAuth: (): unknown => ({
    user: mockUser,
    loading: false,
    refreshUser: async () => {},
  }),
  // Keep everything else (AuthProvider, isAuthenticated, ...) real in case
  // anything else in the module graph imports them.
  AuthProvider: real.AuthProvider,
  isAuthenticated: real.isAuthenticated,
  registerLogoutCallback: real.registerLogoutCallback,
  registerLoginBroadcastCallback: real.registerLoginBroadcastCallback,
}))

await mockModuleScoped('../src/components/toast', import.meta.dir, {
  useToast: (): unknown => ({ showToast: () => {} }),
})

const { TotpSection } = await import('../src/pages/settings/security')

describe('TotpSection first render (no effects fired) reflects the KNOWN status', () => {
  test('2FA already ON: shows the On state (chip + Turn off + Set up again) — never "Set up"', () => {
    mockUser = { totp_enabled: true }
    const html = renderToStaticMarkup(createElement(TotpSection))

    expect(html).toContain('On')
    expect(html).toContain('Turn off')
    expect(html).toContain('Set up again')
    // The bug: this button, present, calls setup2fa() with nothing — must
    // never render for an enabled account, not even for one frame.
    expect(html).not.toMatch(/>Set up</)
  })

  test('2FA OFF: shows "Set up" and nothing about being on — unchanged, no extra prompt', () => {
    mockUser = { totp_enabled: false }
    const html = renderToStaticMarkup(createElement(TotpSection))

    expect(html).toMatch(/>Set up</)
    expect(html).not.toContain('Turn off')
    expect(html).not.toContain('Set up again')
  })

  test('status not yet resolved (user null, defensive) reads the same as off — never crashes, never shows On', () => {
    mockUser = null
    const html = renderToStaticMarkup(createElement(TotpSection))

    expect(html).toMatch(/>Set up</)
    expect(html).not.toContain('Turn off')
  })
})
