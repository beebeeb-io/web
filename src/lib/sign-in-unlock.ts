/**
 * Task 1810 (P0) — what a sign-in does with this device's local vault, once the
 * server has PROVEN the password (OPAQUE finish succeeded).
 *
 * The local vault is the master key sealed under the password the person had
 * WHEN THE DEVICE WAS SET UP. A password reset or change made elsewhere leaves
 * it sealed under a password the account no longer has: the new password,
 * proven by the server a moment ago, cannot open it. Before this fix that read
 * as "Could not unlock vault. Try logging in again." with no way out.
 *
 * Because the password is server-proven here, a `wrong_password` outcome cannot
 * be a typo — it means the local copy is stale. It is discarded (never opened
 * again) and the person re-enters the recovery phrase, which re-seals the key
 * under the new password. Pure so the decision is unit-testable; the callers
 * (login.tsx) do the clearing.
 *
 * MUST NOT be applied to a password the server has not proven (VaultUnlock's
 * form, where "wrong password" is usually a typo).
 */
export type SignInUnlockOutcome = 'unlocked' | 'wrong_password' | 'needs_provisioning'

export type SignInUnlockStep =
  /** The key is resident; carry on into the app. */
  | 'proceed'
  /** The entry could not be proven to be this account's; set the device up with the phrase. */
  | 'provision'
  /** The entry is stale: delete it, then set the device up with the phrase. */
  | 'discard_then_provision'

export function resolveSignInUnlock(outcome: SignInUnlockOutcome): SignInUnlockStep {
  switch (outcome) {
    case 'unlocked':
      return 'proceed'
    case 'needs_provisioning':
      return 'provision'
    case 'wrong_password':
      return 'discard_then_provision'
  }
}

/** Shown on the phrase screen when the sign-in found a stale local vault. */
export const STALE_VAULT_NOTICE =
  'This device still held your vault sealed under your previous password, so it was removed. ' +
  'Enter your recovery phrase to unlock it and seal it under your new password.'
