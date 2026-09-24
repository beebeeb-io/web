/**
 * Errors shared between web and admin clients.
 */

export class ApiError extends Error {
  status: number
  /**
   * Machine-readable error code from the server response body's `error` field.
   * Set when the server returns a structured `{ error: "<code>", message: "<human>" }`
   * payload (e.g. `confirmation_required`, `quota_exceeded`, `opaque_ksf_outdated`).
   * Callers branch on this instead of pattern-matching the human-readable
   * `message` field, which can change without notice.
   */
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Parse a non-2xx JSON error body into a clean `{ code, message }` pair.
 *
 * The normal shape is `{ "error": "<code>", "message": "<human text>" }` (or
 * just `{ "error": "<code>" }` for endpoints that use the code itself as the
 * human-readable slug, e.g. `already_redeemed`). Task 1517 found a class of
 * server error paths that double-encode instead: the top-level `error` field
 * is itself a JSON-stringified `{ error, message }` object rather than a bare
 * code (root cause: `beebeeb-api`'s `ApiError::Conflict(String)` was given a
 * pre-`json!(...).to_string()`-ed payload at a few call sites — e.g. the
 * trial endpoints — but the generic `Conflict` render path wraps whatever
 * string it gets in ANOTHER `{ "error": <string> }`, so the inner JSON never
 * gets unwrapped server-side). Without this, `.code` ends up being the whole
 * JSON string (never matching a caller's `===` check) and `.message` ends up
 * being that same raw JSON blob — which was surfacing verbatim in toasts.
 *
 * Detects that shape and unwraps it so callers still get a clean `.code` /
 * `.message`. Falls through to the plain shape when `error` isn't itself
 * parseable JSON, so this is a no-op for every normal response.
 */
export function parseErrorBody(
  body: Record<string, unknown>,
  fallbackMessage: string,
): { code: string | undefined; message: string } {
  let code = typeof body.error === 'string' ? body.error : undefined
  let message = (body.message ?? body.error ?? fallbackMessage) as string

  if (code && code.startsWith('{')) {
    try {
      const inner = JSON.parse(code) as Record<string, unknown>
      if (typeof inner.error === 'string') {
        code = inner.error
        message = typeof inner.message === 'string' ? inner.message : message
      }
    } catch {
      // Not actually JSON after all — leave code/message as the raw string;
      // still better than throwing here.
    }
  }

  return { code, message }
}

/**
 * Thrown by `confirmAction` (and similar step-up flows) when the server
 * rejects the password during step-up re-auth. Distinct from `ApiError(401)`
 * because a wrong password during step-up must NOT clear the user's session
 * — they're still logged in, they just mistyped. Callers (e.g.
 * ConfirmPasswordModal) catch this to show an inline error instead of
 * bouncing the user to /login.
 */
export class IncorrectPasswordError extends Error {
  constructor(message = 'Incorrect password.') {
    super(message)
    this.name = 'IncorrectPasswordError'
  }
}

/**
 * Thrown by `confirmAction` when the server rejects step-up because the
 * current session is too old (>15 min for OPAQUE-only accounts) and the
 * user must log out and log back in to mint a fresh session before
 * performing the destructive action. Distinct from IncorrectPasswordError:
 * re-typing the password cannot fix this — the user has to start a new
 * session. UI should surface a clear "please log back in" message rather
 * than letting the user keep retrying.
 */
export class SessionTooOldForConfirmationError extends Error {
  constructor(
    message = 'For security, please log out and log back in before performing this action.',
  ) {
    super(message)
    this.name = 'SessionTooOldForConfirmationError'
  }
}
