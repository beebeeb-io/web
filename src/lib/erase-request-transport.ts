/**
 * Task 1918 round 4 (web#174 review): the erase request is POSTed exactly ONCE.
 *
 * The shared `request()` client retries a POST once after a network failure, and retries a 429
 * whose Retry-After is short. Both re-send the same `X-Confirm-Token`, which the server spent on
 * the first attempt (single-use password step-up). The retry then gets 403
 * `confirmation_required`, and the screen used to say "Nothing was scheduled" although the first
 * attempt may have created the request and sent the email; a capped 4th request never showed
 * its daily-cap message either.
 *
 * This module sends the same request `request()` would (session cookie, legacy bearer, the
 * provenance and expected-user headers, JSON) with plain `fetch`, once. It does not retry.
 * Round 4b: `request()`'s global handlers (session expired, account deleted, suspended or
 * mismatched) are reached by ONE status read through `request()` right after such an answer
 * (a 401, or the codes in `AUTH_STATE_CODES`); the POST itself is never sent again.
 * `packages/shared` is left untouched (another session owns it).
 */
import {
  ApiError,
  expectedUserHeaders,
  getApiUrl,
  getToken,
  provenanceHeaders,
  readErrorResponse,
  request,
} from '@beebeeb/shared'

/** Answers that mean the LOGIN is gone or wrong, not this request (`request()` handles them). */
export const AUTH_STATE_CODES: ReadonlySet<string> = new Set(['account_deleted', 'account_suspended', 'account_mismatch'])

/** One read through the shared client, so its global handlers see the state. */
const readThroughSharedClient = () => request<unknown>('/api/v1/account/erase-request')

export interface OnceDeps {
  fetchImpl?: typeof fetch
  apiUrl?: string
  /** The legacy bearer token, if any (default: the shared token store). */
  token?: string | null
  /** Extra headers the shared client would add (default: provenance + expected user). */
  extraHeaders?: Record<string, string>
  /** After a 401 or an `AUTH_STATE_CODES` answer (default: a status read through `request()`). */
  afterAuthFailure?: () => Promise<unknown>
}

/**
 * `POST /api/v1/account/erase-request`, sent once. Resolves to the parsed body of a 2xx; throws
 * an `ApiError` with the server's status, code, message and body for any other answer, and an
 * `ApiError` with status 0 when no answer arrived (the outcome is then unknown: the caller asks
 * the server with a status read, it never re-sends).
 */
export async function postEraseRequestOnce(
  confirmCount: number,
  confirmToken: string,
  deps: OnceDeps = {},
): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch
  const token = deps.token === undefined ? getToken() : deps.token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Confirm-Token': confirmToken,
    ...(deps.extraHeaders ?? { ...provenanceHeaders(), ...expectedUserHeaders() }),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await doFetch(`${deps.apiUrl ?? getApiUrl()}/api/v1/account/erase-request`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirm_count: confirmCount }),
      credentials: 'include',
    })
  } catch {
    throw new ApiError('Could not reach the server.', 0)
  }

  if (!res.ok) {
    const { body, code, message } = await readErrorResponse(res)
    if (res.status === 401 || (code !== undefined && AUTH_STATE_CODES.has(code))) {
      await (deps.afterAuthFailure ?? readThroughSharedClient)().catch(() => undefined)
    }
    throw new ApiError(message, res.status, code, body)
  }
  return res.json()
}
