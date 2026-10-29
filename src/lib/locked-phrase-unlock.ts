/**
 * Task 1810 round 2 (security review P2-3) — what the "Unlock with recovery
 * phrase" button on the signed-in locked surface (VaultLockedNoKey, reached via
 * ProtectedRoute after a reset) does.
 *
 * It used to call logout(), which runs fullLogout -> clearVault and wipes the
 * WHOLE local vault store, including a passkey-sealed vault that does not depend
 * on the password and survives the reset. A button labelled as an unlock must not
 * silently sign the person out and destroy that.
 *
 * Now: drop ONLY the password-sealed entry that belongs to this account (it is
 * sealed under the previous password and can never open again), leave the passkey
 * vault and the session alone, and let the caller show the phrase screen in
 * place. No logout is involved.
 */
export interface LockedPhraseUnlockDeps {
  userId: string | null
  discardStalePasswordVault: (userId: string) => Promise<boolean>
}

export async function prepareInPlacePhraseUnlock(deps: LockedPhraseUnlockDeps): Promise<void> {
  if (deps.userId) await deps.discardStalePasswordVault(deps.userId)
}
