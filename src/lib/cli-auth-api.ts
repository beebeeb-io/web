/**
 * API calls behind the /cli-auth approval page (task 1734).
 *
 * All three go through the shared `request()` client, so they carry the
 * session cookie, the writer-provenance headers and — on the two mutating
 * calls — `X-Beebeeb-Expected-User` (server task 1554: refuses a request whose
 * resident key belongs to a different account than the session). None of them
 * needs the raw session token, so this page no longer asks
 * `GET /auth/session-token` for it.
 */

import { request } from './api'
import type { CliRequestFacts } from './cli-auth-code'

export interface CliPubkeyLookup {
  ecdh_public_key_b64: string
  /** Null when the API node that took the request predates the requester facts. */
  request: CliRequestFacts | null
}

/** Ask the server what is waiting under a code the person TYPED. 404 = nothing (unknown, expired or used). */
export async function lookupCliRequest(code: string): Promise<CliPubkeyLookup> {
  const res = await request<{ ecdh_public_key_b64: string; request?: CliRequestFacts | null }>(
    `/api/v1/auth/cli-pubkey?code=${encodeURIComponent(code)}`,
  )
  return { ecdh_public_key_b64: res.ecdh_public_key_b64, request: res.request ?? null }
}

/**
 * Mint the device its OWN session and claim the code. The server refuses
 * without a fresh single-use step-up token (`confirmation_required`), so this
 * is only reachable after the person re-proved their password or passkey.
 */
export async function mintCliSession(
  code: string,
  confirmationToken: string,
): Promise<{ session_id: string; session_token: string; expires_at: string }> {
  return request<{ session_id: string; session_token: string; expires_at: string }>(
    '/api/v1/auth/cli-session',
    {
      method: 'POST',
      headers: { 'X-Confirm-Token': confirmationToken },
      body: JSON.stringify({ user_code: code }),
    },
  )
}

export interface CliAuthorizeBody {
  user_code: string
  nonce_b64: string
  encrypted_payload_b64: string
  browser_ecdh_public_b64: string
}

/**
 * Hand the encrypted payload to the relay. A server from before task 1734
 * answers 200 with an EMPTY body, which the shared client's `res.json()`
 * rejects as a SyntaxError even though the relay succeeded; the web ships
 * before the server (see the 1734 rollout note), so that one case is
 * accepted. Any HTTP error is an `ApiError` thrown before the body is read and
 * is NOT swallowed.
 */
export async function authorizeCliRelay(body: CliAuthorizeBody): Promise<void> {
  try {
    await request<unknown>('/api/v1/auth/cli-authorize', { method: 'POST', body: JSON.stringify(body) })
  } catch (err) {
    if (err instanceof SyntaxError) return
    throw err
  }
}
