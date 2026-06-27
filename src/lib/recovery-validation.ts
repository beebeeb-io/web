import { ApiError } from '@beebeeb/shared'

/**
 * Dependencies for {@link recoveredKeyMatchesAccount}, injected so the security
 * gate can be unit-tested without the Comlink crypto worker (which can't load
 * under `bun test`). In production the caller wires the real worker-backed
 * `computeRecoveryCheck` + the authed `verifyRecoveryCheck` API call.
 */
export interface RecoveryValidationDeps {
  /**
   * Compute the account-binding `recovery_check` (HMAC-SHA256 of the master key
   * over `"beebeeb-recovery-check"`) and return it base64-encoded — the same
   * value stored server-side at signup.
   */
  computeRecoveryCheckB64: (masterKey: Uint8Array) => Promise<string>
  /**
   * Authed server-side constant-time compare of `recoveryCheckB64` against the
   * current account's stored check. Resolves on match; throws
   * `ApiError(400, 'invalid_recovery_phrase')` on mismatch.
   */
  verifyRecoveryCheck: (recoveryCheckB64: string) => Promise<boolean>
}

/**
 * Validate that a master key derived from a recovery phrase actually belongs to
 * the CURRENT authenticated account.
 *
 * `recoverFromPhrase` derives *a* master key from ANY checksum-valid BIP39
 * phrase — it does not prove the phrase is the account's. Persisting an
 * unvalidated key (vault.ts `wrapAndStore` → IndexedDB) would poison the device
 * into a can't-decrypt-anything state (task 0874). This gate computes the
 * key's `recovery_check` and asks the server to compare it (constant-time)
 * against the account's stored check.
 *
 * @returns `true` when the phrase matches the account; `false` ONLY on a
 * server-confirmed mismatch (400 / `invalid_recovery_phrase`). Any other error
 * (network / server) is re-thrown — an unreachable verifier must NEVER be read
 * as "valid", so the caller never persists or unlocks an unvalidated key.
 */
export async function recoveredKeyMatchesAccount(
  masterKey: Uint8Array,
  deps: RecoveryValidationDeps,
): Promise<boolean> {
  const recoveryCheck = await deps.computeRecoveryCheckB64(masterKey)
  try {
    await deps.verifyRecoveryCheck(recoveryCheck)
    return true
  } catch (err) {
    if (
      err instanceof ApiError &&
      (err.status === 400 || err.code === 'invalid_recovery_phrase')
    ) {
      return false
    }
    throw err
  }
}
