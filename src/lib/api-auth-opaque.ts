// OPAQUE signup and login endpoints: the client half of the password-authenticated key exchange.
import { resetFinalizeRequest, type ResetFinalizeResult } from './api-reset-finalize'
import { ApiError, clearToken, clearSessionConfirmed, request, setToken } from '@beebeeb/shared'
import type { LoginResult } from '@beebeeb/shared'
import { setEmail } from './api-session'

// ─── Task 1525: verify the email with a code BEFORE the account exists ────

/**
 * `POST /api/v1/auth/signup/email-start` — ALWAYS resolves with the same
 * `202 {"message": ...}` body regardless of whether `email` already has an
 * account (server-side anti-enumeration, task 0706b's invariant applied a
 * step earlier). New email → an 8-digit code email. Existing email → a
 * "you already have an account" email with a sign-in link — no code, and
 * the caller has no way to tell the two apart from this response alone.
 *
 * The route is unconditionally mounted (`beebeeb-api/src/routes/auth.rs`
 * doc comment: "the routes themselves are always reachable so the web
 * client can roll out the new screen ahead of the flag flip") — so this
 * call either succeeds or throws a `404 ApiError` on a server that predates
 * task 1525. Callers use that 404 as the capability signal; see
 * `src/lib/signup-email-code.ts`'s `isLegacyFallbackError`.
 */
export async function signupEmailStart(email: string): Promise<{ message: string }> {
  return request('/api/v1/auth/signup/email-start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/**
 * `POST /api/v1/auth/signup/email-verify` — exchanges the 8-digit code for a
 * short-lived, single-use `signup_ticket` bound to `email`. Wrong/expired/
 * reused/cap-exhausted code all render as the SAME `400` (deliberately
 * undifferentiated — no signal about which) with message "invalid or
 * expired code"; surface `err.message` as-is, it's already honest and
 * user-facing.
 */
export async function signupEmailVerify(
  email: string,
  code: string,
): Promise<{ signup_ticket: string }> {
  return request('/api/v1/auth/signup/email-verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}


// ─── OPAQUE auth endpoints ─────────────────────────

/**
 * OPAQUE registration, round 1. The server CAN gate this endpoint behind a
 * shared pilot access key (`BB_REQUIRE_PILOT_KEY`) — OFF by default at
 * launch (task 1520, phase 2; prod runs gate-off on both nodes). When it's
 * on, pass the user-entered key as `pilotKey` and it rides as the
 * `X-Beebeeb-Pilot-Key` header; a missing/wrong key is rejected HERE with a
 * typed 403 (`error: "pilot_key_required"`) BEFORE anything is created
 * server-side. When the gate is off (the default), omit `pilotKey` — no
 * header is sent at all. See src/lib/signup-pilot-gate.ts for how
 * signup.tsx decides whether to even show the field.
 *
 * The server RE-ENFORCES the same gate on register-finish (the OPAQUE flow is
 * stateless across the two round trips, so a finish that skipped a gated
 * start must not slip through) — see `opaqueRegisterFinish` below. Both
 * requests must carry the header when a key is present (task 1411; a prior
 * version of this comment claimed only start needed it, which was wrong and
 * let the header get dropped on finish).
 *
 * `signupTicket` (task 1525): the `signup_ticket` from a successful
 * `signupEmailVerify`, sent as a BODY field (not a header — the server's
 * `RegisterFinishReq::signup_ticket` doc comment: chosen so no CORS
 * `Access-Control-Allow-Headers` change is needed). Only enforced
 * server-side when `BB_SIGNUP_EMAIL_CODE=1`; harmless to omit or include
 * otherwise. `register-start` validates the ticket WITHOUT consuming it (a
 * client may retry start before finish).
 */
export async function opaqueRegisterStart(
  email: string,
  clientMessage: string,
  pilotKey?: string,
  signupTicket?: string,
): Promise<{ server_message: string }> {
  const body: Record<string, unknown> = { email, client_message: clientMessage }
  if (signupTicket) body.signup_ticket = signupTicket
  const headers: Record<string, string> = {}
  if (pilotKey) headers['X-Beebeeb-Pilot-Key'] = pilotKey
  return request('/api/v1/opaque/register-start', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

/**
 * OPAQUE registration, round 2 — creates the account row. Carries the SAME
 * pilot access key as `opaqueRegisterStart` (task 1411): the server
 * re-checks the gate here too (it's also where `is_pilot` gets stamped), so
 * omitting the header makes an otherwise-successful signup 403 with
 * `pilot_key_required` on the very last step.
 *
 * `signupTicket` (task 1525): same ticket as `opaqueRegisterStart`, sent
 * again here. This is the call that CONSUMES it atomically (`UPDATE ...
 * WHERE consumed_at IS NULL RETURNING`, before the `INSERT INTO users`) when
 * `BB_SIGNUP_EMAIL_CODE=1` — a missing/wrong-email/expired/consumed ticket
 * renders as `403 {"error": "signup_ticket_invalid"}`.
 */
export async function opaqueRegisterFinish(
  email: string,
  clientMessage: string,
  x25519PublicKey?: string,
  recoveryCheck?: string,
  referralSource?: string,
  referralSharerId?: string,
  referralCode?: string,
  pilotKey?: string,
  signupTicket?: string,
): Promise<{ user_id: string; session_token: string }> {
  const headers: Record<string, string> = {}
  if (pilotKey) headers['X-Beebeeb-Pilot-Key'] = pilotKey
  const data = await request<{ user_id: string; session_token: string }>('/api/v1/opaque/register-finish', {
    method: 'POST',
    body: JSON.stringify({
      email,
      client_message: clientMessage,
      x25519_public_key: x25519PublicKey,
      recovery_check: recoveryCheck,
      ...(referralSource && { referral_source: referralSource }),
      ...(referralSharerId && { referral_sharer_id: referralSharerId }),
      ...(referralCode && { referral_code: referralCode }),
      ...(signupTicket && { signup_ticket: signupTicket }),
    }),
    headers,
  })
  setToken(data.session_token)
  setEmail(email)
  return data
}

export async function opaqueLoginStart(
  email: string,
  clientMessage: string,
): Promise<{ server_message: string; server_state: string; ksf_version: number }> {
  return request('/api/v1/opaque/login-start', {
    method: 'POST',
    body: JSON.stringify({ email, client_message: clientMessage }),
  })
}

export async function opaqueLoginFinish(
  email: string,
  clientMessage: string,
  serverState: string,
): Promise<{ user_id: string; session_token: string; requires_2fa?: boolean; partial_token?: string }> {
  const data = await request<{ user_id: string; session_token: string; requires_2fa?: boolean; partial_token?: string }>('/api/v1/opaque/login-finish', {
    method: 'POST',
    body: JSON.stringify({ email, client_message: clientMessage, server_state: serverState }),
  })
  if (!data.requires_2fa && data.session_token) {
    setToken(data.session_token)
    setEmail(email)
  }
  return data
}

// ─── OPAQUE migration for existing (legacy) accounts ─────────────────────
// These endpoints require a valid Bearer session and allow a user who is
// currently authenticated via legacy Argon2id to silently enroll in OPAQUE.
// Called fire-and-forget after a successful legacy login; failure is safe to
// ignore — the account stays on legacy until the next successful migration.

/**
 * POST /api/v1/opaque/register-start-existing
 *
 * Initiates OPAQUE registration for a session that was authenticated via the
 * legacy password path. The caller must already have a valid Bearer token.
 * Returns the server-side OPAQUE message needed to complete registration.
 */
export async function opaqueRegisterStartExisting(
  clientMessage: string,
): Promise<{ server_message: string }> {
  return request('/api/v1/opaque/register-start-existing', {
    method: 'POST',
    body: JSON.stringify({ client_message: clientMessage }),
  })
}

/**
 * POST /api/v1/opaque/register-finish-existing
 *
 * Completes OPAQUE enrollment for an existing session. Persists the OPAQUE
 * password file alongside the recovery_check and x25519 public key so the
 * account can use OPAQUE on next login.
 */
export async function opaqueRegisterFinishExisting(
  clientMessage: string,
  recoveryCheck: string,
  x25519PublicKey: string,
): Promise<{ migrated: true }> {
  return request('/api/v1/opaque/register-finish-existing', {
    method: 'POST',
    body: JSON.stringify({
      client_message: clientMessage,
      recovery_check: recoveryCheck,
      x25519_public_key: x25519PublicKey,
    }),
  })
}

export {
  CAPABILITIES_HEADER,
  RESET_2FA_CAPABILITY,
  type ResetFinalizeResult,
} from './api-reset-finalize'

// ─── Recovery-phrase auth endpoints (server task 0034) ────────────────────
// These endpoints don't exist yet. Returns null on 404 so the UI can show a
// "service unavailable" message rather than crashing.

/**
 * POST /api/v1/auth/recover-with-phrase-start
 *
 * Client sends: email + recovery_check (HMAC-SHA256 of master_key over
 * "beebeeb-recovery-check", base64-encoded). Server verifies the check
 * matches the stored value, then initiates an OPAQUE re-registration and
 * returns a short-lived recovery_token plus the OPAQUE server message for
 * the client to complete registration.
 */
export async function recoverWithPhraseStart(
  email: string,
  recoveryCheck: string,
): Promise<{ recovery_token: string } | null> {
  try {
    return await request<{ recovery_token: string }>(
      '/api/v1/auth/recover-with-phrase-start',
      { method: 'POST', body: JSON.stringify({ email, recovery_check: recoveryCheck }) },
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/**
 * POST /api/v1/auth/verify-recovery-check
 *
 * Authed (Bearer session): validates that a `recovery_check` (HMAC-SHA256 of a
 * master key derived from a recovery phrase) belongs to the CURRENT account,
 * WITHOUT issuing any password-recovery token. The server compares constant-time
 * against the caller's stored `recovery_check` and returns `{valid:true}` on a
 * match, or 400 `invalid_recovery_phrase` on a mismatch / no stored check.
 *
 * Used on device-provision to REJECT a wrong-but-checksum-valid recovery phrase
 * BEFORE the derived key is persisted to the local IndexedDB vault — without it
 * `recoverFromPhrase` derives *a* key from any valid BIP39 phrase and poisons
 * the device. Returns `true` on match; throws `ApiError` (status 400, code
 * `invalid_recovery_phrase`) on mismatch.
 */
export async function verifyRecoveryCheck(recoveryCheck: string): Promise<boolean> {
  const res = await request<{ valid: boolean }>(
    '/api/v1/auth/verify-recovery-check',
    { method: 'POST', body: JSON.stringify({ recovery_check: recoveryCheck }) },
  )
  return res.valid === true
}

/**
 * POST /api/v1/auth/recovery-check  (set-once-if-absent backfill — task 0875)
 *
 * Authed (Bearer session): sets the CURRENT account's `recovery_check` ONLY if
 * it is currently NULL. A handful of legacy accounts predate the signup-time
 * check; task 0874 made device-provision REJECT a recovery phrase whose
 * `recovery_check` doesn't match the stored one, so a NULL-stored account is
 * wrongly locked out of recovery-phrase provisioning. We backfill it on a
 * PROVEN-correct-key unlock (the only time the client holds a key it KNOWS is
 * the account's). The server never overwrites a non-NULL value, so this can
 * never poison an existing verifier. Idempotent → `{ updated: boolean }`.
 *
 * MUST be called only with a key proven correct (vault keyCheck / escrow
 * AEAD-decrypt / 0874-validated phrase) — never from an unvalidated key.
 */
export async function setRecoveryCheckIfAbsent(
  recoveryCheck: string,
): Promise<{ ok: boolean; updated: boolean }> {
  return request<{ ok: boolean; updated: boolean }>(
    '/api/v1/auth/recovery-check',
    { method: 'POST', body: JSON.stringify({ recovery_check: recoveryCheck }) },
  )
}

export async function recoverOpaqueRegister(
  recoveryToken: string,
  clientMessage: string,
): Promise<{ server_message: string }> {
  return request<{ server_message: string }>(
    '/api/v1/auth/recover-opaque-register',
    {
      method: 'POST',
      body: JSON.stringify({ recovery_token: recoveryToken, client_message: clientMessage }),
    },
  )
}

/**
 * POST /api/v1/auth/recover-with-phrase-finalize
 *
 * Client sends the OPAQUE upload message (output of opaqueRegistrationFinish)
 * plus the recovery_token obtained from the start endpoint. Server finalises
 * the OPAQUE password file update and returns a fresh session token.
 *
 * Task 1730 / 1803: for an account with 2FA enabled the server ends the
 * recovery at the 2FA challenge instead of minting a session — it answers
 * `{ requires_2fa: true, partial_token }` (no session, no cookie) and the
 * caller finishes through `verify2fa`. The server only does this for clients
 * that declare `X-Beebeeb-Capabilities: reset-2fa`, which this call always
 * does; without the header it answers 409 `password_set_sign_in_required`
 * (the credential WAS rotated) — see `isPasswordSetSignInRequired`.
 */
export async function recoverWithPhraseFinalize(
  recoveryToken: string,
  opaqueRegistration: string,
  recoveryCheck: string,
  x25519PublicKey: string,
): Promise<ResetFinalizeResult> {
  const data = await resetFinalizeRequest('/api/v1/auth/recover-with-phrase-finalize', {
    recovery_token: recoveryToken,
    opaque_registration: opaqueRegistration,
    recovery_check: recoveryCheck,
    x25519_public_key: x25519PublicKey,
  })
  if (!data.requires_2fa) setToken(data.session_token)
  return data
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const data = await request<LoginResult>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!data.requires_2fa && data.session_token) {
    setToken(data.session_token)
    setEmail(email)
  }
  return data
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/api/v1/auth/logout', { method: 'POST' })
  } finally {
    clearToken()
    // Forget the page-load session marker so a post-logout anonymous 401 (e.g.
    // landing on a public route) does not bounce to /login (task 0741).
    clearSessionConfirmed()
  }
}
