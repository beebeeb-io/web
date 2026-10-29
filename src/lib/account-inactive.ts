/**
 * Task 1948 (1c) — a login of an account that is no longer active.
 *
 * The server answers `403 {"error":"account_suspended"}` to every signed-in
 * request whose session belongs to a suspended or disabled account. Before
 * this, `auth-context.tsx` set `user = null` on that answer but kept the
 * legacy token and every later request still carried the dead login, so a
 * person who opened /signup on a device that once held such a login saw
 * "You don't have permission to do that." (Guus, 2026-10-17).
 *
 * Now `request()` (@beebeeb/shared) clears the legacy token and fires ONE
 * central handler (`registerAccountSuspendedHandler`), registered by
 * `AuthProvider`, which runs {@link signOutInactiveLocally}: the same local
 * cleanup an explicit sign-out does, WITHOUT calling `/auth/logout` (that
 * endpoint needs a working session and would answer the same 403).
 *
 * What the person then sees (Guus's ruling 1c, 2026-10-17):
 * - public pages (sign-up, sign-in, onboarding: everything drawn in
 *   `AuthShell`): {@link ACCOUNT_INACTIVE_NOTICE}, then the page works as normal;
 * - signed-in pages: `AccountInactiveScreen` (the account is not active,
 *   Sign out, support@beebeeb.io).
 * Neither ever says WHY the account is not active.
 *
 * The `bb_session` cookie is httpOnly (task 0447), so JavaScript cannot remove
 * it; the server expires it on this 403 (server#216, 6d01f177). Against a
 * server without that, a reload sends it again, the server answers the same
 * 403, and this handler runs again.
 *
 * A refusal only signs out the login it was about (web#169 review, Codex P1):
 * see {@link createInactiveLoginGuard}.
 *
 * The flag is a tiny module-level store (not React context) so `AuthShell`
 * can read it on every page without a provider, and so it is scoped to this
 * page load: a reload starts clean.
 */

import { useSyncExternalStore } from 'react'
import { ApiError, bumpAuthGeneration, isCurrentAuthStamp, type AuthStamp } from '@beebeeb/shared'

/** Exact copy, Guus's ruling 1c. Pinned by test/1948-account-inactive.test.ts. */
export const ACCOUNT_INACTIVE_NOTICE =
  'You were signed in to an account that is no longer active, so we signed you out on this device.'

/** The support address the signed-in screen names. */
export const ACCOUNT_INACTIVE_SUPPORT_EMAIL = 'support@beebeeb.io'

export function isAccountSuspendedError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'account_suspended'
}

// ── page-load store ─────────────────────────────────────────────────────────

let signedOutInactive = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function markSignedOutInactive(): void {
  if (signedOutInactive) return
  signedOutInactive = true
  emit()
}

/** The person acknowledged it (Sign out on the signed-in screen) or signed in again. */
export function clearSignedOutInactive(): void {
  if (!signedOutInactive) return
  signedOutInactive = false
  emit()
}

export function isSignedOutInactive(): boolean {
  return signedOutInactive
}

export function subscribeSignedOutInactive(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSignedOutInactive(): boolean {
  return useSyncExternalStore(subscribeSignedOutInactive, isSignedOutInactive, isSignedOutInactive)
}

// ── the local sign-out ──────────────────────────────────────────────────────

export interface SignOutInactiveDeps {
  /** Drops the legacy localStorage bearer (`request()` already did; repeated for the broadcast path). */
  clearToken: () => void
  /** Forgets that a session was confirmed this page load, so a later anonymous 401 is not "expired". */
  clearSessionConfirmed: () => void
  /** Per-account local state a sign-out also clears (coupon hold, dismissed notices, region store). */
  clearAccountLocalState: () => void
  /** KeyProvider's full logout: zero the master key, clear the cached keys and the local vault. */
  logoutCleanup: () => void | Promise<void>
  /** `setUser(null)` in AuthProvider. */
  clearUser: () => void
}

/**
 * Everything an explicit sign-out does on this device, minus the server call.
 * Never calls the API: `/auth/logout` would answer the same 403. Marks the
 * store FIRST so the screen that renders when `user` turns null already knows
 * why, and still marks it when a cleanup step throws.
 */
export async function signOutInactiveLocally(deps: SignOutInactiveDeps): Promise<void> {
  markSignedOutInactive()
  deps.clearToken()
  deps.clearSessionConfirmed()
  deps.clearAccountLocalState()
  try {
    await deps.logoutCleanup()
  } catch {
    /* the in-memory state below must clear regardless */
  }
  deps.clearUser()
}

/**
 * Where ProtectedRoute sends a visitor with no user: the account-inactive
 * screen when this page load signed a dead login out, the sign-in page otherwise.
 */
export function signedOutDestination(inactive: boolean): 'account_inactive' | 'login' {
  return inactive ? 'account_inactive' : 'login'
}

// ── which login a refusal belongs to (web#169 review, Codex P1) ─────────────

/**
 * Cross-tab message: the login of account `userId` turned out to be dead. Only a
 * tab whose CURRENT login is that same account acts on it. A message without a
 * `userId` (the sender did not know which account it was signed in as, or an
 * older bundle sent it) is ignored: its own next request finds out instead.
 */
export interface AccountInactiveBroadcast {
  type: 'account_inactive'
  userId?: string | null
}

export interface InactiveLoginGuardDeps {
  /** The account this tab is signed in as right now (null = none or not known). */
  currentUserId: () => string | null
  /** Posts to the other tabs (AuthProvider's BroadcastChannel). */
  broadcast: (msg: AccountInactiveBroadcast) => void
  /** The local sign-out, see {@link signOutInactiveLocally}. */
  signOutDeps: SignOutInactiveDeps
}

export type InactiveLoginOutcome = 'signed_out' | 'ignored'

/**
 * The one place that decides whether a 403 `account_suspended` (from this tab's
 * `request()`) or an `account_inactive` broadcast (from another tab) signs THIS
 * tab's login out. The sign-out clears the key and the local vault, so it must
 * only ever run for the login the refusal was about:
 * - `onSuspended(stamp)`: `stamp` is what `request()` captured when the refused
 *   request was ISSUED. A later login (here or in another tab) makes it stale.
 * - `onBroadcast(msg)`: only when `msg.userId` is this tab's current account.
 */
export function createInactiveLoginGuard(deps: InactiveLoginGuardDeps) {
  const signOut = async (): Promise<void> => {
    // Requests still in flight from the same dead login are now stale: one
    // sign-out per login, and none later over a login that replaced it.
    bumpAuthGeneration()
    await signOutInactiveLocally(deps.signOutDeps)
  }
  return {
    async onSuspended(stamp: AuthStamp): Promise<InactiveLoginOutcome> {
      // Issued under an earlier login than the current one: the refusal is about
      // a login this tab no longer has. Never touch the current one or its vault.
      if (!isCurrentAuthStamp(stamp)) return 'ignored'
      // Other tabs can only compare an account id with their own login; without
      // one there is nothing they could safely act on.
      if (stamp.userId) deps.broadcast({ type: 'account_inactive', userId: stamp.userId })
      await signOut()
      return 'signed_out'
    },
    async onBroadcast(msg: AccountInactiveBroadcast): Promise<InactiveLoginOutcome> {
      const current = deps.currentUserId()
      if (!msg?.userId || current === null || msg.userId !== current) return 'ignored'
      await signOut()
      return 'signed_out'
    },
  }
}
