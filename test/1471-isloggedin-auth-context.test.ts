import { describe, expect, test, beforeEach } from 'bun:test'
import type { AuthUser } from '@beebeeb/shared'

/**
 * Task 1471 — `pricing.tsx`'s `isLoggedIn = !!getToken()` read the legacy
 * `bb_session` localStorage slot, which `auth-context.tsx`'s boot effect
 * clears right after the httpOnly-cookie migration (task 0447). For a real
 * cookie-authenticated user that slot is empty, so `isLoggedIn` was
 * effectively always false and `handleSelect` sent a paying-intent click to
 * /signup instead of checkout.
 *
 * The fix: `isAuthenticated(user)` in `auth-context.tsx` derives the
 * logged-in signal from the auth context's cookie-session truth
 * (`useAuth().user`) instead. `pricing.tsx`, `share-view.tsx`, and
 * `ws-context.tsx` all now call this ONE function for the same class of
 * decision (see the sweep table in this task's Notes) — this suite proves
 * the shared primitive itself, including the exact "cookie session, no
 * legacy slot" scenario the pricing page hits.
 *
 * No prior art for mocking `useAuth()`/the auth context via a component
 * render exists in this suite (checked: `grep -rl useAuth test/` before
 * writing this — only non-rendering `mock.module` fixtures for the `token`
 * module in session-expiry-gate.test.ts). There is no React rendering
 * harness (no @testing-library/react, no jsdom) in this repo's `bun test`
 * setup, so this follows the established in-file convention instead
 * (`startPlanCheckout` in pricing.tsx, "Exported ... so it's directly
 * unit-testable without rendering the page") — a plain `AuthUser | null`
 * argument stands in for the mocked auth context value.
 */

// Minimal in-memory localStorage stub — same shape as
// test/pricing-checkout-intent-1469.test.ts and test/export-intent.test.ts.
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}
;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()

const { isAuthenticated } = await import('../src/lib/auth-context')

function cookieUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    user_id: 'u_1471',
    email: 'guus@beebeeb.io',
    email_verified: true,
    created_at: '2026-01-01T00:00:00Z',
    totp_enabled: false,
    ...overrides,
  }
}

beforeEach(() => {
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
})

describe('isAuthenticated() — the pricing page (and share-view, ws-context) logged-in signal (task 1471)', () => {
  test('a cookie-authenticated user with NO bb_session localStorage value resolves as logged in', () => {
    // The exact production scenario: the boot effect already ran and
    // cleared the legacy slot, but the user IS authenticated via the
    // httpOnly cookie — that's what `useAuth().user` being non-null means.
    expect(globalThis.localStorage.getItem('bb_session')).toBeNull()
    expect(isAuthenticated(cookieUser())).toBe(true)
  })

  test('a genuinely logged-out visitor (auth context user: null) resolves as logged out', () => {
    expect(isAuthenticated(null)).toBe(false)
  })
})
