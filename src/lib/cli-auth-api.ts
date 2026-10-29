/**
 * API calls behind the /cli-auth approval page (task 1734).
 *
 * The lookup and the session mint go through the shared `request()` client;
 * the relay (`authorizeCliRelay`) does its own fetch with the same headers, for
 * the reason given there. All three carry the session cookie, the
 * writer-provenance headers and — on the two mutating calls —
 * `X-Beebeeb-Expected-User` (server task 1554: refuses a request whose
 * resident key belongs to a different account than the session). None of them
 * needs the raw session token, so this page no longer asks
 * `GET /auth/session-token` for it.
 */

import { ApiError, expectedUserHeaders, getApiUrl, getToken, provenanceHeaders } from '@beebeeb/shared'
import { request } from './api'
import { readRelayResponse } from './cli-auth-relay'
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
 * Hand the encrypted payload to the relay.
 *
 * A server from before task 1734 answers 200 with an EMPTY body, which the
 * shared client's `res.json()` rejects as a SyntaxError even though the relay
 * succeeded, and the web ships before the server (see the 1734 rollout note).
 * So this one call reads the body itself: an EMPTY body is success; anything
 * else must parse as JSON (a malformed body still throws), and any HTTP error
 * becomes an `ApiError` exactly as in `request()` - nothing else is swallowed.
 * It sets the same headers `request()` does (cookie, provenance, expected-user).
 */
export async function authorizeCliRelay(body: CliAuthorizeBody): Promise<void> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...provenanceHeaders(),
    ...expectedUserHeaders(),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${getApiUrl()}/api/v1/auth/cli-authorize`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }
  await readRelayResponse(res)
}
