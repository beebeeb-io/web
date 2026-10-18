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

// ── Round 3: the verification link (Guus 2026-10-18, "Verify link + 72 h") ──────────────────

/** What the confirmation page learned from the server. */
export type LinkVerifyResult =
  /** Confirmed now. `cancelToken` cancels it (the same second token the confirmation email holds). */
  | { kind: 'verified'; dueAt: string; itemCount: number; retentionDays: number | null; cancelToken: string | null }
  /** Confirmed before; nothing changed. */
  | { kind: 'already'; dueAt: string | null; itemCount: number; retentionDays: number | null }
  /** The 24-hour window closed: the request lapsed, nothing will move. */
  | { kind: 'expired' }
  /** Cancelled, finished, or never valid. */
  | { kind: 'invalid' }
  /** No answer we could read: the outcome is unknown. */
  | { kind: 'unavailable'; rateLimited: boolean }

/** Never throws. The token travels in the JSON body, without credentials. */
export async function verifyByLink(token: string, deps: LinkDeps = {}): Promise<LinkVerifyResult> {
  if (!TOKEN_SHAPE.test(token)) return { kind: 'invalid' }
  const doFetch = deps.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(`${deps.apiUrl ?? getApiUrl()}/api/v1/account/erase-request/verify-by-token`, {
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
  if (res.status === 404) return { kind: 'invalid' }
  if (res.status === 410) return { kind: 'expired' }
  if (res.status === 429) return { kind: 'unavailable', rateLimited: true }
  if (res.status !== 200) return { kind: 'unavailable', rateLimited: false }
  let body: Record<string, unknown> | null = null
  try {
    const raw: unknown = await res.json()
    body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  } catch {
    body = null
  }
  const request = body && typeof body.request === 'object' && body.request ? (body.request as Record<string, unknown>) : null
  const dueAt = request && typeof request.due_at === 'string' ? request.due_at : null
  const itemCount = request && typeof request.item_count === 'number' ? request.item_count : 0
  const retentionDays = body && typeof body.trash_retention_days === 'number' ? body.trash_retention_days : null
  if (!body || body.verified !== true) return { kind: 'unavailable', rateLimited: false }
  if (body.already === true) return { kind: 'already', dueAt, itemCount, retentionDays }
  if (!dueAt) return { kind: 'unavailable', rateLimited: false }
  const cancelToken = typeof body.cancel_token === 'string' && TOKEN_SHAPE.test(body.cancel_token) ? body.cancel_token : null
  return { kind: 'verified', dueAt, itemCount, retentionDays, cancelToken }
}

