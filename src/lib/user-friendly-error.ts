/**
 * userFriendlyError() — turns any thrown value into a short, actionable
 * message a real user can understand. Replaces the generic
 * `err instanceof Error ? err.message : 'Something went wrong'` pattern
 * that leaked raw HTTP/JSON fragments into the UI.
 *
 * Match order: ApiError status code → network/offline heuristic → existing
 * short message → generic fallback. Keep strings ≤ 8 words where possible.
 */

import { ApiError } from './api'

/** Maximum length below which we trust the existing message as user-facing. */
const SHORT_MESSAGE_MAX = 80

/**
 * Look at the error's status (if any) and decide whether the underlying
 * message is opaque server output (a JSON fragment, a "404", a stack frame)
 * that we should swap for a friendlier one. We accept short, plain-prose
 * messages straight through.
 */
function looksUserFriendly(message: string): boolean {
  if (!message) return false
  if (message.length > SHORT_MESSAGE_MAX) return false
  // Raw JSON / object fragments
  if (message.startsWith('{') || message.includes('": "')) return false
  // Bare numeric or "404: ..." status leaks
  if (/^\d{3}\b/.test(message)) return false
  // Anything still looking like an HTTP status name
  if (/^(Not Found|Forbidden|Unauthorized|Bad Request|Internal Server Error)$/i.test(message)) {
    return false
  }
  return true
}

function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (err instanceof ApiError && err.status === 0) return true
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return true
  if (err instanceof Error && /network|fetch failed|failed to fetch/i.test(err.message)) {
    return true
  }
  return false
}

export function userFriendlyError(err: unknown): string {
  // Network / offline takes priority — a 5xx during a flaky connection is
  // really "you have no connection", not "the server is down".
  if (isNetworkError(err)) {
    return 'Check your connection and try again.'
  }

  if (err instanceof ApiError) {
    const status = err.status
    // Typed quota errors come back with a machine-readable `code` so we don't
    // pattern-match the human message. Branch on these BEFORE the generic
    // status handling, otherwise the 403/413 fall-throughs swallow them with
    // "You don't have permission to do that." (server task 0670).
    if (err.code === 'object_budget_exceeded') {
      // Object-COUNT cap, distinct from the byte/storage quota below.
      return "File limit reached. This account has hit its maximum number of files — delete some files or contact support to raise the limit."
    }
    if (err.code === 'quota_exceeded') {
      return 'Storage full. Free up space or upgrade your plan to keep uploading.'
    }
    // Email-verification gate (task 0762): upload / share / file-request return a
    // typed 403 when the account is unverified. Point at the always-present
    // verify-email banner (which carries the code entry + Resend) instead of the
    // generic "You don't have permission" 403 fall-through below.
    if (err.code === 'email_unverified') {
      return 'Verify your email to upload or share. Use the banner at the top to enter your code or resend it.'
    }
    if (status === 401) return 'Your session expired. Sign in again.'
    if (status === 403) return "You don't have permission to do that."
    if (status === 404) return 'Not found.'
    if (status === 429) return 'Too many requests. Try again in a moment.'
    if (status >= 500 && status <= 599) {
      return 'Beebeeb is having trouble. Try again in a moment.'
    }
    if (looksUserFriendly(err.message)) return err.message
    return 'Something went wrong. Try again.'
  }

  if (err instanceof Error && looksUserFriendly(err.message)) {
    return err.message
  }

  return 'Something went wrong. Try again.'
}

/**
 * True for errors where retrying the same action might succeed without user
 * intervention — network blips, transient 5xx, rate limits. 4xx other than
 * 429 means the request itself was wrong, so no retry button.
 */
export function errorRetryable(err: unknown): boolean {
  if (isNetworkError(err)) return true
  if (err instanceof ApiError) {
    if (err.status === 429) return true
    if (err.status >= 500 && err.status <= 599) return true
    if (err.status === 0) return true
  }
  return false
}

/**
 * True when the server refused the action because the account's email isn't
 * verified yet (typed `403 {"error":"email_unverified"}`, task 0762). Call sites
 * can use this to nudge toward the verify-email banner instead of a dead-end
 * error — the human-facing string comes from userFriendlyError above.
 */
export function isEmailUnverified(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code === 'email_unverified'
}
