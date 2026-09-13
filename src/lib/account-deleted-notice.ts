/**
 * Cross-navigation handoff for the account_deleted redirect (task 1404).
 *
 * `request()` (@beebeeb/shared) fires a CENTRAL `account_deleted` handler
 * (registered in app.tsx's `ApiErrorWiring`) on ANY authenticated call that
 * gets the typed 403 — not just an active login submit. That handler has no
 * login form to write an inline error into (it may fire from a background
 * `getMe()`, a sync poll, anything), so it formats the exact copy and stashes
 * it here immediately before redirecting to `/login`, where this module's
 * `consumeAccountDeletedNotice()` picks it up on mount. The SAME function is
 * also what a login-page catch block reads for an in-progress login attempt
 * (`user-friendly-error.ts`'s `accountDeletedMessage`) — the central handler
 * stashes the notice synchronously before the `ApiError` it also throws is
 * ever observed by an awaiting caller, so it's always there to read either
 * way.
 *
 * sessionStorage (not an in-memory module var) so it survives the actual
 * navigation to /login.
 */
const KEY = 'bb_account_deleted_notice'

export interface NoticeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): NoticeStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    // Private-browsing / storage-disabled edge cases — degrade to no notice
    // rather than throw during a sign-out flow.
    return null
  }
}

export function stashAccountDeletedNotice(
  message: string,
  storage = browserStorage(),
): void {
  storage?.setItem(KEY, message)
}

/** Reads and clears the stashed notice. Returns null if none is pending. */
export function consumeAccountDeletedNotice(storage = browserStorage()): string | null {
  const value = storage?.getItem(KEY) ?? null
  if (value) storage?.removeItem(KEY)
  return value
}
