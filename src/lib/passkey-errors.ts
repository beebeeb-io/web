/**
 * Human copy for a failed "add passkey" ceremony.
 *
 * Two sources of error text reach `useAddPasskeyFlow`'s catch block, and
 * neither is fit for a toast as-is:
 *
 *  - the SERVER, whose register-finish maps webauthn-rs's `WebauthnError`
 *    straight into a 400 body (`ApiError::BadRequest(e.to_string())`), so the
 *    user saw e.g. "The clients relying party origin does not match our
 *    servers information";
 *  - the BROWSER, whose `navigator.credentials.create` rejects with a
 *    DOMException (`NotAllowedError` on cancel/timeout, `InvalidStateError`
 *    when this authenticator is already registered) in the browser's wording.
 *
 * Messages we wrote ourselves (e.g. "registration session not found, … start
 * over") are already plain language and pass through unchanged.
 */

const FALLBACK = 'Failed to add passkey'

const RP_MISMATCH =
  "This passkey was created for a different web address than the one you're on. Open Beebeeb at its usual address and try again."

const ALREADY_REGISTERED = 'This device already has a passkey for your account.'

const GENERIC_VERIFY = "We couldn't verify this passkey. Please try again."

/** webauthn-rs `WebauthnError` Display strings (webauthn-rs-core error.rs). */
const RP_MISMATCH_RE = /relying party (origin|id)/i
const ALREADY_EXISTS_RE = /^The credential already exists/i
const LIBRARY_RE =
  /^(The (client|clients|JSON from the client|user (present|verified) bit|extensions|required attestation|attestation|configuration|credential|COSEKey|TPM|X5C|trust|leaf certificate|SSH|requested|provided)\b|There are no challenges|An extension for this identifier|A failure occurred in persisting|ED25519|This key has an)/i

export function passkeyErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return FALLBACK
  if (err.name === 'NotAllowedError') return 'Passkey creation was cancelled or timed out.'
  if (err.name === 'InvalidStateError') return ALREADY_REGISTERED
  const msg = err.message.trim()
  if (!msg) return FALLBACK
  if (RP_MISMATCH_RE.test(msg)) return RP_MISMATCH
  if (ALREADY_EXISTS_RE.test(msg)) return ALREADY_REGISTERED
  if (LIBRARY_RE.test(msg)) return GENERIC_VERIFY
  return msg
}

/**
 * Task 1865 — the SIGN-IN ceremony. Since server 1784 `/auth/passkey/login-start`
 * answers 200 with a decoy challenge for an unknown email, a locked account, or
 * an account without a passkey (enumeration-safe). The browser then shows its
 * own "no passkey for this site" sheet and a cancel rejects `credentials.get`
 * with NotAllowedError. The sentence below must stay account-neutral: it may
 * not say the account is missing or has no passkey, or it undoes that.
 */
export const PASSKEY_LOGIN_NEUTRAL =
  'No passkey was used. If you have not set one up on this device, sign in with your password.'

const LOGIN_FALLBACK = 'Passkey sign-in failed. Please try again.'

export function passkeyLoginErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return LOGIN_FALLBACK
  if (err.name === 'NotAllowedError' || err.name === 'AbortError' || err.name === 'TimeoutError') {
    return PASSKEY_LOGIN_NEUTRAL
  }
  return err.message.trim() || LOGIN_FALLBACK
}
