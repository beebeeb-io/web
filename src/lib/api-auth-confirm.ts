import { opaqueLoginStart as wasmOpaqueLoginStart, opaqueLoginFinish as wasmOpaqueLoginFinish, toBase64, fromBase64 } from './crypto'
import { ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError, getToken, markSessionConfirmed, readErrorResponse, request, setToken } from '@beebeeb/shared'
import type { AuthUser, LoginResult, TotpSetupResponse } from '@beebeeb/shared'
import { API_URL } from './api-session'
import { serverOptsToGetOptions, credentialToAuthenticationJSON } from './api-passkeys'

// ─── Step-up re-auth ────────────────────────────────

/**
 * What a step-up is FOR (task 1734, round 2). Without a grant the token is the
 * ordinary `password_step_up` every destructive action takes. With
 * `cli_device_approval` the server mints a token that can ONLY approve the
 * device-code login `cliCode`, in THIS session: the generic token is refused by
 * `/auth/cli-session`, and this one is refused by everything else. A server from
 * before this change ignores the extra fields and mints the generic token,
 * which that same older server's `/auth/cli-session` accepts - so the web can
 * ship first.
 */
export interface StepUpGrant {
  purpose: 'cli_device_approval'
  /** The device code the person typed, as shown on their own device (`XXXX-XXXX`). */
  cliCode: string
}

/** The request-body fields for a grant; nothing at all for the ordinary step-up. */
export function stepUpGrantFields(grant?: StepUpGrant): { purpose?: string; cli_code?: string } {
  return grant ? { purpose: grant.purpose, cli_code: grant.cliCode } : {}
}

/**
 * Exchange the user's password for a short-lived confirmation token.
 * Pass that token via the X-Confirm-Token header on destructive endpoints
 * (permanent delete, change password, delete account).
 *
 * OPAQUE step-up (task 0854a): the plaintext password NEVER leaves the browser
 * for OPAQUE-enrolled accounts. We run the SAME OPAQUE login handshake login
 * uses (`opaqueLoginStart` / `opaqueLoginFinish` in WASM) against the
 * authenticated `/auth/confirm-opaque-{start,finish}` endpoints, which mint the
 * byte-identical single-use X-Confirm-Token as the legacy `/auth/confirm`.
 *
 * Branching:
 *   start → 409 { opaque_unavailable: true }  → legacy Argon2-only account:
 *                                                fall back to plaintext /auth/confirm.
 *   start → 200 { server_message, server_state, ksf_version }
 *                                              → opaqueLoginFinish + finish POST.
 *
 * The return shape `{ confirmation_token, expires_at }` is unchanged, so every
 * caller (confirm-password modal, trash, change-password, delete-account,
 * permanent-delete) is untouched. The 401 "wrong password" vs
 * SessionTooOldForConfirmationError distinction is preserved end to end.
 */
export async function confirmAction(
  password: string,
  grant?: StepUpGrant,
): Promise<{ confirmation_token: string; expires_at: string }> {
  const token = getToken()
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) authHeaders['Authorization'] = `Bearer ${token}`

  // 1. OPAQUE login start in WASM — same helper login uses. Yields the client
  //    CredentialRequest message + the opaque client state we round-trip into
  //    finish.
  const loginStart = await wasmOpaqueLoginStart(password)

  // 2. Authenticated POST to confirm-opaque-start. Direct fetch (not request())
  //    so a 401/409 on this step-up path never clears the session and bounces
  //    the user to /login. Mirror the legacy confirm auth: Bearer header AND the
  //    bb_session cookie.
  const startRes = await fetch(`${API_URL}/api/v1/auth/confirm-opaque-start`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ client_message: toBase64(loginStart.message) }),
    credentials: 'include',
  })

  // 3. Legacy Argon2-only account (no opaque_password_file) → distinguishable
  //    409 { opaque_unavailable: true }. Fall back to the plaintext path, which
  //    still works for these accounts (incl. the session-freshness fallback).
  if (startRes.status === 409) {
    const body = (await startRes.json().catch(() => ({}))) as Record<string, unknown>
    if (body.opaque_unavailable === true) {
      return confirmActionPlaintext(password, authHeaders, grant)
    }
    // Some other 409 — surface it rather than silently swallowing.
    throw new ApiError(
      (body.message ?? body.error ?? startRes.statusText) as string,
      startRes.status,
    )
  }

  if (!startRes.ok) {
    const { body, fallbackMessage } = await readErrorResponse(startRes)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      startRes.status,
    )
  }

  const startBody = (await startRes.json()) as {
    server_message: string
    server_state: string
    ksf_version: number
  }
  const serverMsg = fromBase64(startBody.server_message)

  // 4. OPAQUE login finish in WASM — exactly as login.tsx does, threading the
  //    account's KSF version so the client stretches with the matching KSF.
  //    A WRONG password fails HERE, client-side: finish recomputes the session
  //    key from the password and verifies the server MAC, which mismatches for a
  //    bad password (it never reaches the finish POST). Map that to the same
  //    "Incorrect password" UX as the 401 / plaintext paths.
  const loginFinish = await wasmOpaqueLoginFinish(
    loginStart.state,
    password,
    serverMsg,
    startBody.ksf_version,
  ).catch(() => {
    throw new IncorrectPasswordError()
  })

  // 5. Authenticated POST to confirm-opaque-finish with the finish client
  //    message + the round-tripped server state. Same auth + cookie semantics.
  const finishRes = await fetch(`${API_URL}/api/v1/auth/confirm-opaque-finish`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      client_message: toBase64(loginFinish.message),
      server_state: startBody.server_state,
      ...stepUpGrantFields(grant),
    }),
    credentials: 'include',
  })

  if (finishRes.status === 401) {
    // OPAQUE finish 401 = wrong password (the finish is a password-guess oracle
    // like /opaque/login-finish). Map to the same "Incorrect password" UX as the
    // legacy path. (Session-too-old does not arise on the OPAQUE finish — the
    // freshness fallback lives only on the plaintext /auth/confirm.)
    throw new IncorrectPasswordError()
  }
  if (!finishRes.ok) {
    const { body, fallbackMessage } = await readErrorResponse(finishRes)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      finishRes.status,
    )
  }
  return finishRes.json() as Promise<{ confirmation_token: string; expires_at: string }>
}

/**
 * Legacy plaintext step-up fallback (`POST /api/v1/auth/confirm`). Kept intact
 * for Argon2-only accounts that have no OPAQUE credential — those accounts
 * return 409 { opaque_unavailable: true } from confirm-opaque-start. Mobile/CLI
 * also still use this endpoint. The password leaves the browser here; that is
 * the documented, account-specific exception OPAQUE cannot yet cover.
 */
async function confirmActionPlaintext(
  password: string,
  authHeaders: Record<string, string>,
  grant?: StepUpGrant,
): Promise<{ confirmation_token: string; expires_at: string }> {
  // Direct fetch instead of request() — a 401 from /auth/confirm means the
  // user mistyped their password during step-up, NOT that their session
  // expired. Routing it through request() would clear the token and bounce
  // them to /login on every wrong attempt.
  const res = await fetch(`${API_URL}/api/v1/auth/confirm`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ password, ...stepUpGrantFields(grant) }),
    // task 0447 — send cookie + accept Set-Cookie back. The confirm endpoint
    // is authenticated and may set a refreshed bb_session cookie.
    credentials: 'include',
  })

  if (res.status === 401) {
    // Two distinct 401s are possible here:
    //   - "session_too_old_for_confirmation": session is OK but older than the
    //     step-up freshness window — re-typing the password cannot fix it.
    //   - everything else: the password was wrong.
    // Read the body (best-effort) so the UI can surface the right message.
    const body = (await res
      .json()
      .catch(() => ({}))) as Record<string, unknown>
    if (body.error === 'session_too_old_for_confirmation') {
      throw new SessionTooOldForConfirmationError(
        (body.message as string | undefined) ?? undefined,
      )
    }
    throw new IncorrectPasswordError()
  }
  if (!res.ok) {
    const { body, fallbackMessage } = await readErrorResponse(res)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      res.status,
    )
  }
  return res.json() as Promise<{ confirmation_token: string; expires_at: string }>
}

/**
 * Passkey-assertion step-up confirmation (task 1493). The counterpart to
 * `confirmAction(password)` for accounts that have no password/OPAQUE
 * credential to re-prove — a passkey-only account (`pending_signup_complete`)
 * has `password_hash = ''` and no `opaque_password_file`, so BOTH
 * `confirm_password` and `confirm_opaque_start` are permanently unable to
 * re-verify it. This runs a FRESH WebAuthn assertion against the account's
 * own passkeys via the server's `/auth/confirm-passkey-start` +
 * `/auth/confirm-passkey-finish`, which mint the byte-identical single-use
 * X-Confirm-Token every other step-up path does — so the return shape
 * (`{ confirmation_token, expires_at }`) and every downstream call site are
 * unchanged.
 *
 * Direct fetch (not request()), same reasoning as `confirmAction`: a
 * cancelled/failed WebAuthn ceremony here must never clear the session or
 * bounce the user to /login — they are still logged in.
 */
export async function confirmPasskey(
  grant?: StepUpGrant,
): Promise<{ confirmation_token: string; expires_at: string }> {
  const token = getToken()
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) authHeaders['Authorization'] = `Bearer ${token}`

  const startRes = await fetch(`${API_URL}/api/v1/auth/confirm-passkey-start`, {
    method: 'POST',
    headers: authHeaders,
    credentials: 'include',
  })

  if (!startRes.ok) {
    const { body, fallbackMessage } = await readErrorResponse(startRes)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      startRes.status,
    )
  }

  const startBody = (await startRes.json()) as { publicKey: unknown; auth_state: string }
  const getOptions = serverOptsToGetOptions(startBody.publicKey)

  const credential = (await navigator.credentials.get({
    publicKey: getOptions,
  }).catch(() => null)) as PublicKeyCredential | null

  if (!credential) {
    throw new ApiError('Passkey confirmation was cancelled', 0)
  }

  const credentialData = credentialToAuthenticationJSON(credential)

  const finishRes = await fetch(`${API_URL}/api/v1/auth/confirm-passkey-finish`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      credential: credentialData,
      auth_state: startBody.auth_state,
      ...stepUpGrantFields(grant),
    }),
    credentials: 'include',
  })

  if (finishRes.status === 401) {
    // Mirrors confirmAction's OPAQUE-finish 401 handling: the assertion
    // didn't verify against this account's own credentials. The session
    // itself is still fine — do not clear it or bounce to /login.
    throw new ApiError('Passkey confirmation failed', 401)
  }
  if (!finishRes.ok) {
    const { body, fallbackMessage } = await readErrorResponse(finishRes)
    throw new ApiError(
      (body.message ?? body.error ?? fallbackMessage) as string,
      finishRes.status,
    )
  }
  return finishRes.json() as Promise<{ confirmation_token: string; expires_at: string }>
}

export async function verifyEmail(
  code: string,
): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

/**
 * Redeem a single-use account-unlock token (task 0764A). The account is locked
 * after too many failed sign-ins; the user gets an emailed `/unlock/{token}`
 * link. Returns `{unlocked: true}` if the token was valid + redeemed, `false`
 * if expired/already-used. The server never reveals which account it mapped to.
 */
export async function unlockAccount(token: string): Promise<{ unlocked: boolean }> {
  return request<{ unlocked: boolean }>('/api/v1/auth/unlock', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function resendVerification(): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/resend-verification', { method: 'POST' })
}

export async function getMe(): Promise<AuthUser> {
  const user = await request<AuthUser>('/api/v1/auth/me')
  // Record that an authenticated session was confirmed this page-load, so a
  // LATER 401 (genuine expiry) is treated as expiry and bounces to /login —
  // while an anonymous boot 401 (no session ever) does not (task 0741).
  markSessionConfirmed()
  return user
}

/**
 * POST /api/v1/auth/2fa/setup — start (or restart) TOTP enrollment.
 *
 * When the account has NO 2FA enabled yet, call with no arguments — the
 * server issues a fresh secret unconditionally (this is the original,
 * unchanged behavior).
 *
 * When 2FA is ALREADY enabled, the server requires step-up before it will
 * replace the live secret (`routes/totp.rs` `setup_step_up_validated_if_required`
 * — task 1610): either the account's CURRENT 6-digit TOTP/backup code as
 * `opts.code`, or a step-up `X-Confirm-Token` (password/passkey re-auth via
 * `confirmAction`/`<StepUpAuth>`) as `opts.confirmToken`. Passing neither
 * against an enabled account throws `ApiError(403, ..., 'confirmation_required')` —
 * callers MUST offer one of the two paths before calling this for
 * "set up again", never call it bare.
 */
export async function setup2fa(opts?: { code?: string; confirmToken?: string }): Promise<TotpSetupResponse> {
  const headers: Record<string, string> = {}
  if (opts?.confirmToken) headers['X-Confirm-Token'] = opts.confirmToken
  return request<TotpSetupResponse>('/api/v1/auth/2fa/setup', {
    method: 'POST',
    ...(opts?.code ? { body: JSON.stringify({ code: opts.code }) } : {}),
    ...(opts?.confirmToken ? { headers } : {}),
  })
}

export async function enable2fa(code: string): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/2fa/enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function disable2fa(code: string): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function verify2fa(
  partialToken: string,
  code: string,
): Promise<LoginResult> {
  const data = await request<LoginResult>('/api/v1/auth/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ partial_token: partialToken, code }),
  })
  if (data.session_token) {
    setToken(data.session_token)
  }
  return data
}
