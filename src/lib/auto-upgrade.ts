/**
 * auto-upgrade — NON-DESTRUCTIVE OPAQUE credential upgrade to the current KSF.
 *
 * Background
 * ----------
 * ~20 legacy accounts were enrolled in OPAQUE under the OLD Identity KSF
 * (`opaque_ksf_version = 0`). The current web client links against
 * `Argon2idKsf` (V1). Under the COEXIST fix, the WASM `client_login_finish`
 * accepts the account's `ksf_version` (returned by `/opaque/login-start`) so a
 * v0 account can STILL complete a fresh login. Immediately after such a login
 * succeeds, we silently re-register the account's OPAQUE password file as V1 so
 * it converges onto the current standard — no user-facing step, no button.
 *
 * The mechanism
 * -------------
 * Re-register the OPAQUE password file via the already-built silent-upgrade
 * endpoints (`/opaque/register-start-existing` + `/opaque/register-finish-existing`).
 * Server-side this is non-destructive: `register_finish_existing` preserves
 * `password_hash`/`salt` and all existing sessions, stamps
 * `opaque_ksf_version = 1`, and COALESCE-updates `recovery_check` +
 * `x25519_public_key` (so re-sending the existing values is a no-op write).
 *
 * Safety invariants (load-bearing — do not break)
 * ----------------------------------------------
 *  - The master key is NEVER derived from `password`. It is the IN-MEMORY vault
 *    master passed in via `masterKey` (from `useKeys().getMasterKey()`, valid
 *    only once the vault is unlocked). `password` is fed ONLY into the OPAQUE
 *    registration (the server-side KSF input) — exactly as onboarding /
 *    recover-with-phrase / email-change do.
 *  - The vault is NEVER cleared, re-wrapped, or otherwise touched here. No
 *    session is logged out. This only refreshes a server-side credential.
 *  - Best-effort: this runs as a fire-and-forget step after login. It must
 *    NEVER throw into the login flow — a failure just leaves the account on v0
 *    until the next successful login retries the upgrade.
 */

import {
  opaqueRegisterStartExisting,
  opaqueRegisterFinishExisting,
} from './api'
import {
  opaqueRegistrationStart,
  opaqueRegistrationFinish,
  computeRecoveryCheck,
  deriveX25519Public,
  toBase64,
  fromBase64,
} from './crypto'

/**
 * Silently re-register the current account's OPAQUE credential at the current
 * KSF version (V1 Argon2id), non-destructively. Best-effort — swallows all
 * errors and resolves to a boolean so a caller can fire-and-forget it after a
 * successful login.
 *
 * MUST be called only when AUTHENTICATED (the silent-upgrade endpoints require
 * a valid session) and only when the vault is UNLOCKED (so `masterKey` is the
 * real in-memory vault master).
 *
 * @param password   The user's account password — the same one just used to
 *                    log in. Fed ONLY into OPAQUE registration; never used to
 *                    derive the master key.
 * @param masterKey  The in-memory vault master key (`getMasterKey()`). Used
 *                    ONLY to recompute `recovery_check` + `x25519_public_key`
 *                    so they continue to match the existing vault.
 * @returns `true` if the upgrade completed, `false` if it failed (safe to
 *          ignore — the account stays on its current KSF until next login).
 */
export async function autoUpgradeToV1(
  password: string,
  masterKey: Uint8Array,
): Promise<boolean> {
  try {
    // 1. OPAQUE registration start (client) — request bytes + opaque state.
    const regStart = await opaqueRegistrationStart(password)

    // 2. Hand the client message to the server over the authenticated session.
    const { server_message } = await opaqueRegisterStartExisting(
      toBase64(regStart.message),
    )

    // 3. OPAQUE registration finish (client) — RegistrationUpload bytes.
    const serverMsg = fromBase64(server_message)
    const regUpload = await opaqueRegistrationFinish(
      regStart.state,
      password,
      serverMsg,
    )

    // 4. Recompute recovery_check + x25519 public key from the EXISTING
    //    in-memory vault master key (never from the password). COALESCE-updated
    //    server-side, so re-sending existing values leaves the vault untouched.
    const recoveryCheck = await computeRecoveryCheck(masterKey)
    const x25519Pub = await deriveX25519Public(masterKey)

    // 5. Finish on the server: writes the V1 OPAQUE password file, preserves
    //    password_hash/salt + sessions, stamps opaque_ksf_version = 1.
    await opaqueRegisterFinishExisting(
      toBase64(regUpload),
      toBase64(recoveryCheck),
      toBase64(x25519Pub),
    )
    return true
  } catch (err) {
    // Never surface to the user — the account simply stays on its current KSF
    // and the next successful login will retry the upgrade.
    if (import.meta.env.DEV) {
      console.warn('[auto-upgrade] silent OPAQUE V1 upgrade failed:', err)
    }
    return false
  }
}
