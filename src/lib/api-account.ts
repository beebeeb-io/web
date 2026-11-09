// Account-recovery API calls: password change, forgot/reset, and opaque set-password.
import { resetFinalizeRequest } from './api-reset-finalize'
import { clearToken, request, setToken } from '@beebeeb/shared'
import { postEraseRequestOnce } from './erase-request-transport'
import { setEmail } from './api-session'
import { ResetFinalizeResult } from './api-auth-opaque'

// ─── Password / Account endpoints ───────────────

/**
 * Change password — OPAQUE re-registration, leg 1 (task 0854b).
 *
 * The server rotates the OPAQUE credential as a FRESH registration bound to the
 * caller's email (resolved from the session — we never send the email). This is
 * the start leg: hand the server a base64 OPAQUE `RegistrationRequest` for the
 * NEW password (from `client_registration_start(newPassword)` in WASM), get back
 * the base64 `RegistrationResponse`.
 *
 * Authenticated + step-up gated: the session travels via `request()` (Bearer +
 * bb_session cookie); the X-Confirm-Token is a SEPARATE single-use OPAQUE
 * step-up token (the `ConfirmedAction` extractor consumes one per gated request,
 * so the start and finish legs each need their OWN confirm token).
 */
export async function changePasswordOpaqueStart(
  clientMessage: string,
  confirmToken: string,
): Promise<{ server_message: string }> {
  return request<{ server_message: string }>('/api/v1/auth/change-password-start', {
    method: 'POST',
    headers: { 'X-Confirm-Token': confirmToken },
    body: JSON.stringify({ client_message: clientMessage }),
  })
}

/**
 * Change password — OPAQUE re-registration, leg 2 (task 0854b).
 *
 * Sends the base64 OPAQUE `RegistrationUpload` (from
 * `client_registration_finish(state, newPassword, server_message)`). The server
 * rotates `opaque_password_file`, clears the legacy password_hash/salt (no
 * downgrade), stamps `opaque_ksf_version=1`, INVALIDATES all prior sessions, and
 * mints a fresh session for this device — returned as `session_token` (and set
 * as the bb_session httpOnly cookie). We `setToken` it so this tab stays logged
 * in.
 *
 * `recoveryCheck` / `x25519Pub` are OPTIONAL (server COALESCEs — omitting keeps
 * the existing values). On a plain password change the master key is UNCHANGED,
 * so we re-send the existing recovery_check + x25519 public key derived from the
 * in-memory master key (a no-op write that keeps the row self-consistent).
 *
 * NOTE: `salt` in the response is now ALWAYS an empty string for an OPAQUE
 * account — do NOT use it.
 */
export async function changePasswordOpaqueFinish(
  clientMessage: string,
  confirmToken: string,
  recoveryCheck?: string,
  x25519Pub?: string,
): Promise<{ message: string; salt: string; session_token: string }> {
  const body: Record<string, string> = { client_message: clientMessage }
  if (recoveryCheck !== undefined) body.recovery_check = recoveryCheck
  if (x25519Pub !== undefined) body.x25519_public_key = x25519Pub

  const data = await request<{
    message: string
    salt: string
    session_token: string
  }>('/api/v1/auth/change-password-finish', {
    method: 'POST',
    headers: { 'X-Confirm-Token': confirmToken },
    body: JSON.stringify(body),
  })
  setToken(data.session_token)
  return data
}

export async function forgotPassword(
  email: string,
): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/**
 * Task 1704 — email-based self-service password reset (the /set-password page).
 *
 * The emailed one-time link is the entry proof; the password is chosen
 * client-side via OPAQUE re-registration and is never transmitted. ZERO key
 * material on the wire: unlike recoverWithPhraseFinalize, the client does NOT
 * send recovery_check / x25519_public_key — those bindings are set-once
 * (1554/1556) and an email-only reset keeps them untouched server-side. The
 * vault stays locked until the user re-enters their recovery phrase / vault
 * key (the /recover-with-phrase re-wrap ceremony).
 */

/** OPAQUE registration start authorized by the one-time set-password token. */
export async function setPasswordOpaqueRegister(
  token: string,
  clientMessage: string,
): Promise<{ server_message: string }> {
  return request<{ server_message: string }>('/api/v1/auth/set-password-opaque-register', {
    method: 'POST',
    body: JSON.stringify({ token, client_message: clientMessage }),
  })
}

/**
 * Consume the one-time token and replace the account credential. For an
 * account without 2FA the server deletes ALL sessions and mints a fresh one
 * for this device (returned as `session_token` and set as the bb_session
 * httpOnly cookie).
 *
 * Task 1730 / 1803: for an account WITH 2FA the reset ends at the challenge —
 * `{ requires_2fa: true, partial_token }`, no session, no cookie — and the page
 * finishes through `verify2fa`. Always declares `reset-2fa` so the server uses
 * that path; an old cached bundle that does not gets 409
 * `password_set_sign_in_required` (see `isPasswordSetSignInRequired`).
 */
export async function setPasswordFinalize(
  token: string,
  opaqueRegistration: string,
): Promise<ResetFinalizeResult> {
  const data = await resetFinalizeRequest('/api/v1/auth/set-password-finish', {
    token,
    opaque_registration: opaqueRegistration,
  })
  if (!data.requires_2fa) setToken(data.session_token)
  if (data.email) setEmail(data.email)
  return data
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ message: string; session_token: string; salt: string }> {
  const data = await request<{ message: string; session_token: string; salt: string }>(
    '/api/v1/auth/reset-password',
    {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    },
  )
  setToken(data.session_token)
  return data
}

export async function deleteAccountPermanently(
  confirmation: string,
  confirmToken?: string,
  code?: string,
): Promise<{ message: string; shred_after: string }> {
  const trimmed = code?.trim()
  const data = await request<{ message: string; shred_after: string }>(
    '/api/v1/auth/account',
    {
      method: 'DELETE',
      headers: confirmToken ? { 'X-Confirm-Token': confirmToken } : undefined,
      body: JSON.stringify(trimmed ? { confirmation, code: trimmed } : { confirmation }),
    },
  )
  clearToken()
  return data
}

// Task 1918: "Erase all files" from the locked screen is a server-side request with a
// cooldown that only ever moves files to the trash (pure logic: `./erase-request.ts`).

/** `GET /api/v1/account/erase-request`: the pending request (or null) and the live item count. */
export async function getEraseRequest(): Promise<unknown> {
  return request<unknown>('/api/v1/account/erase-request')
}

/**
 * `POST /api/v1/account/erase-request`: `confirmCount` must equal the server's live item count.
 * Sent exactly once (task 1918 round 4): the step-up token is single-use, so a retry could only
 * ever be refused, and would hide the real outcome. See `erase-request-transport.ts`.
 */
export async function createEraseRequest(confirmCount: number, confirmToken: string): Promise<unknown> {
  return postEraseRequestOnce(confirmCount, confirmToken)
}

/** `POST /api/v1/account/erase-request/cancel`: any signed-in session of the account. */
export async function cancelEraseRequest(): Promise<unknown> {
  return request<unknown>('/api/v1/account/erase-request/cancel', { method: 'POST' })
}

/**
 * `POST /api/v1/account/erase-request/{id}/restore` (task 1918 round 4): restore everything that
 * erase moved to the trash. 200 = all back; 202 = the server continues in the background.
 */
export async function restoreEraseRequest(requestId: string): Promise<unknown> {
  return request<unknown>(`/api/v1/account/erase-request/${encodeURIComponent(requestId)}/restore`, { method: 'POST' })
}

export async function changeEmail(
  newEmail: string,
  password: string,
): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/account/email', {
    method: 'PUT',
    body: JSON.stringify({ new_email: newEmail, password }),
  })
}

export async function emailChangeStart(
  newEmail: string,
  opaqueClientMessage: string,
  confirmToken: string,
): Promise<{ server_message: string; email_change_token: string }> {
  return request('/api/v1/me/email/start', {
    method: 'POST',
    headers: { 'X-Confirm-Token': confirmToken },
    body: JSON.stringify({ new_email: newEmail, opaque_client_message: opaqueClientMessage }),
  })
}

export async function emailChangeFinish(
  emailChangeToken: string,
  opaqueRegistration: string,
  recoveryCheck: string,
  x25519PublicKey: string,
): Promise<{ email: string }> {
  return request('/api/v1/me/email/finish', {
    method: 'POST',
    body: JSON.stringify({
      email_change_token: emailChangeToken,
      opaque_registration: opaqueRegistration,
      recovery_check: recoveryCheck,
      x25519_public_key: x25519PublicKey,
    }),
  })
}
