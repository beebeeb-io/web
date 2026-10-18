/**
 * Task 1918 — the one-click cancel link from the erase-request email.
 *
 * Link: `<APP_URL>/erase-request/cancel#t=<token>`. The token rides in the URL FRAGMENT, which
 * a browser never sends to a server, so it is in no access log; the page reads it, removes it
 * from the address bar, and sends it in a JSON body to
 * `POST /api/v1/account/erase-request/cancel-by-token`.
 *
 * The link is the credential, so the page works without a session (it is vault-free, see
 * `vault-free-paths.ts`) and this module uses a plain `fetch`: no cookies, no bearer token,
 * no global error toasts, and no import of `./api` (which pulls in the crypto worker).
 * Cancelling is the safe direction, so the page cancels on load: a mail scanner that runs it
 * can only ever stop an erase, never start one.
 */
import { getApiUrl } from '@beebeeb/shared'

/** 32 random bytes, base64url without padding = 43 characters; accept a little slack. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/

/** The token from a location hash (`#t=<token>`), or `null` when there is none that fits. */
export function readCancelToken(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const token = new URLSearchParams(raw).get('t')
  return token && TOKEN_SHAPE.test(token) ? token : null
}

export type LinkCancelResult =
  | { kind: 'cancelled' }
  /** Used already, expired at the due time, or never valid: the server says one thing for all. */
  | { kind: 'invalid' }
  | { kind: 'unavailable'; rateLimited: boolean }

export interface LinkDeps {
  fetchImpl?: typeof fetch
  apiUrl?: string
}

/** Never throws. */
export async function cancelByLink(token: string, deps: LinkDeps = {}): Promise<LinkCancelResult> {
  if (!TOKEN_SHAPE.test(token)) return { kind: 'invalid' }
  const doFetch = deps.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(`${deps.apiUrl ?? getApiUrl()}/api/v1/account/erase-request/cancel-by-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return { kind: 'unavailable', rateLimited: false }
  }
  if (res.status === 200) return { kind: 'cancelled' }
  if (res.status === 404) return { kind: 'invalid' }
  if (res.status === 429) return { kind: 'unavailable', rateLimited: true }
  return { kind: 'unavailable', rateLimited: false }
}
