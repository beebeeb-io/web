/**
 * Errors shared between web and admin clients.
 */

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
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
