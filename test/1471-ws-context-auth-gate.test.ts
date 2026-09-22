import { describe, expect, test } from 'bun:test'
import type { AuthUser } from '@beebeeb/shared'

/**
 * Task 1471 sweep — `ws-context.tsx` gated the leader tab's WebSocket
 * connection attempt with `enabled: isLeader` alone, relying on
 * `use-websocket.ts`'s internal `if (!getToken()) return` to skip opening a
 * socket for a logged-out visitor. That internal check reads the SAME
 * legacy `bb_session` localStorage slot pricing.tsx did — so for a real
 * cookie-authenticated user (slot cleared by the boot effect) it ALSO
 * silently returned early, and the leader tab's WebSocket never connected
 * for any ordinary signed-in user. Same root cause as the pricing bug, same
 * fix: gate on the auth context's `user`, not the legacy slot.
 *
 * `shouldOpenWs` is the extracted, directly-testable connect condition
 * (mirrors `isAuthenticated` in auth-context.tsx / `startPlanCheckout` in
 * pricing.tsx — no React rendering harness in this repo's `bun test`
 * setup, see 1471-isloggedin-auth-context.test.ts's header comment).
 */

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

const { shouldOpenWs } = await import('../src/lib/ws-context')

describe('shouldOpenWs() — the WS leader tab only connects for a real auth-context user (task 1471)', () => {
  test('leader tab + cookie-authenticated user (no bb_session slot) → connects', () => {
    expect(shouldOpenWs(true, cookieUser())).toBe(true)
  })

  test('leader tab + logged-out visitor (user: null) → does NOT attempt to connect', () => {
    expect(shouldOpenWs(true, null)).toBe(false)
  })

  test('follower tab (not leader), even if authenticated → does NOT connect (unrelated to auth)', () => {
    expect(shouldOpenWs(false, cookieUser())).toBe(false)
  })
})
