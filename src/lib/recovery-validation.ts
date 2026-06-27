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

/**
 * Dependencies for {@link backfillRecoveryCheckIfAbsent}, injected so the
 * backfill can be unit-tested without the Comlink crypto worker.
 */
export interface RecoveryCheckBackfillDeps {
  /** Compute the account-binding `recovery_check`, base64-encoded. */
  computeRecoveryCheckB64: (masterKey: Uint8Array) => Promise<string>
  /**
   * Authed `POST /api/v1/auth/recovery-check` — sets the current account's
   * `recovery_check` ONLY if it is currently NULL (set-once-if-absent; the
   * server never overwrites a non-NULL value). Resolves `{ updated }`.
   */
  setRecoveryCheckIfAbsent: (
    recoveryCheckB64: string,
  ) => Promise<{ updated: boolean }>
}

/**
 * Best-effort backfill of the account's server-stored `recovery_check` from a
 * master key that has ALREADY been proven correct (task 0875).
 *
 * A handful of legacy accounts predate the signup-time `recovery_check`. Task
 * 0874 made device-provision REJECT a recovery phrase whose `recovery_check`
 * doesn't match the stored one — but for a NULL-stored account that rejects the
 * CORRECT phrase too, locking it out of recovery-phrase provisioning. The
 * server can never compute the check itself (it never sees the master key), so
 * the client backfills it on a proven-correct-key unlock. The server only sets
 * it when currently NULL, so this is safe + idempotent.
 *
 * CRITICAL: the caller MUST pass a key proven to be the account's (local-vault
 * keyCheck, passkey/escrow AEAD-decrypt, fresh signup key, password-change
 * re-wrap, or a 0874-validated recovery phrase). NEVER call this with an
 * unvalidated key — that could set a WRONG check into the empty slot.
 *
 * NEVER throws: this is fire-and-forget and must never block or break an
 * unlock. Returns `true` only when the server actually set the value.
 */
export async function backfillRecoveryCheckIfAbsent(
  masterKey: Uint8Array,
  deps: RecoveryCheckBackfillDeps,
): Promise<boolean> {
  try {
    const recoveryCheck = await deps.computeRecoveryCheckB64(masterKey)
    const res = await deps.setRecoveryCheckIfAbsent(recoveryCheck)
    return res.updated === true
  } catch {
    // Best effort — a network/server failure must never surface to the unlock.
    return false
  }
}
