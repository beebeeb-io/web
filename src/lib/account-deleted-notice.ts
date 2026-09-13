/**
 * Cross-navigation handoff for the account_deleted redirect (task 1404).
 *
 * The login page's own submit handlers catch `AccountDeletedError` directly
 * and show the copy inline — no handoff needed there. This file exists for
 * the OTHER case: an already-authenticated tab whose account gets deleted
 * elsewhere (another device, an admin action). That tab's next `getMe()`
 * call (auth-context.tsx boot) 403s with no login form to write an inline
 * error into — `ProtectedRoute` just redirects to `/login` because `user`
 * stays null. We stash the formatted message here immediately before that
 * redirect, and the login page picks it up on mount.
 *
 * sessionStorage (not an in-memory module var) so it survives the actual
 * navigation to /login.
 */
const KEY = 'bb_account_deleted_notice'

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    // Private-browsing / storage-disabled edge cases — degrade to no notice
    // rather than throw during a sign-out flow.
    return null
  }
}

export function stashAccountDeletedNotice(message: string): void {
  storage()?.setItem(KEY, message)
}

/** Reads and clears the stashed notice. Returns null if none is pending. */
export function consumeAccountDeletedNotice(): string | null {
  const s = storage()
  const value = s?.getItem(KEY) ?? null
  if (value) s?.removeItem(KEY)
  return value
}
