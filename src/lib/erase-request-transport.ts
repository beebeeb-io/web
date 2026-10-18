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
 * provenance and expected-user headers, JSON) with plain `fetch`, once. It does not retry, and it
 * does not run `request()`'s global handlers (session expired, account deleted or suspended):
 * the next status read, which goes through `request()`, does that. `packages/shared` is left
 * untouched (another session owns it).
 */
import {
  ApiError,
  expectedUserHeaders,
  getApiUrl,
  getToken,
  parseErrorBody,
  provenanceHeaders,
} from '@beebeeb/shared'

export interface OnceDeps {
  fetchImpl?: typeof fetch
  apiUrl?: string
  /** The legacy bearer token, if any (default: the shared token store). */
  token?: string | null
  /** Extra headers the shared client would add (default: provenance + expected user). */
  extraHeaders?: Record<string, string>
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
    const body = (await res.json().catch(() => ({ error: 'Server returned an invalid response' }))) as Record<string, unknown>
    const { code, message } = parseErrorBody(body, res.statusText)
    throw new ApiError(message, res.status, code, body)
  }
  return res.json()
}
