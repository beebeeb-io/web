/**
 * Task 1704 SLICE 2 — the post-reset locked-device signal.
 *
 * The state (decision doc D-2026-10-02, Amendment + §4c): after the SLICE-1
 * email password reset, the account credential is new but the device's
 * IndexedDB vault is still wrapped under the OLD password — `unlockVault`
 * reports `wrong_password` for every password the user knows (the fresh one
 * provably cannot unwrap the old wrap; the old one is the one they lost), and
 * VaultUnlock's password form is a dead end.
 *
 * WHY A MARKER AND NOT AN UNLOCK OUTCOME: `VaultUnlockOutcome.wrong_password`
 * is indistinguishable from a typo at the crypto layer — no key-context change
 * can honestly turn it into "unlock impossible". What IS a fact is the reset
 * itself: the /set-password completion (SLICE 1) proves the credential was
 * just replaced on this device, so the device's wrapped vault cannot open
 * under anything the user just set. The set-password page therefore stamps a
 * non-destructive sessionStorage marker (the wrapped vault is NEVER cleared —
 * the user may still recall the old password, and destroying the only local
 * wrap would be a data-loss bug), and ProtectedRoute reads it to route to the
 * honest locked-state surface (`VaultLockedNoKey`) instead of VaultUnlock.
 *
 * Scope (sessionStorage, tab-scoped): the marker is a statement about THIS
 * browsing session's reset flow. It deliberately does NOT shadow the password
 * form in future visits or other tabs — there the old password might still
 * work, and VaultUnlock stays the honest default. Cross-device resets get the
 * same surface through their own set-password completion.
 *
 * Pure logic only — no crypto, no key-context changes (SLICE 2 scope guard).
 */

/** The sessionStorage key. Exported for tests + the set-password page. */
export const POST_RESET_LOCK_KEY = 'beebeeb_password_reset_completed'

/** The exact value the marker must carry to count (never a bare truthy junk value). */
export const MARKER_VALUE = 'set_password_completed'

/** True when the marker is present in this tab's sessionStorage. */
export function isPostResetLockedDevice(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(POST_RESET_LOCK_KEY) === MARKER_VALUE
  } catch {
    // Privacy modes / storage denial — read as "no signal", never throw.
    return false
  }
}

/** Stamp the marker. Called by the /set-password page after a successful
 *  finalize (the credential was replaced; the local wrap is now stale). */
export function markPasswordResetCompleted(): void {
  try {
    sessionStorage.setItem(POST_RESET_LOCK_KEY, MARKER_VALUE)
  } catch {
    // Best-effort: without storage the surface falls back to VaultUnlock,
    // which is today's behavior — never block the reset itself.
  }
}

/** Clear the marker. Called by the locked-state surface's escape hatch
 *  ("I remember my previous password") and by ProtectedRoute once the vault
 *  actually unlocks (the phrase ceremony re-wrapped under the new password). */
export function clearPostResetLock(): void {
  try {
    sessionStorage.removeItem(POST_RESET_LOCK_KEY)
  } catch {
    // Nothing to do — the marker simply outlives the tab.
  }
}

export type LockedVaultSurface = 'impersonated' | 'no_key' | 'unlock_form'

/**
 * The locked-with-existing-vault branch of ProtectedRoute, as a pure decision
 * (mirrors `shouldReconcileLock()` in impersonation-context.tsx):
 *  - impersonation FIRST, exactly as 1693 shipped it — an impersonated session
 *    renders VaultLockedImpersonated regardless of any marker (support view
 *    semantics are untouched by this slice);
 *  - a post-reset marker (and no explicit user request for the password form)
 *    → the honest no-key surface with re-entry + exits;
 *  - everything else → the normal VaultUnlock password form, byte-for-byte
 *    unchanged for users who simply locked their vault.
 */
export function resolveLockedVaultSurface(opts: {
  impersonating: boolean
  postResetMarker: boolean
  unlockFormRequested: boolean
}): LockedVaultSurface {
  if (opts.impersonating) return 'impersonated'
  if (opts.postResetMarker && !opts.unlockFormRequested) return 'no_key'
  return 'unlock_form'
}