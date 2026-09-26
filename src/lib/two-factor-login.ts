import { ApiError } from '@beebeeb/shared'

/**
 * Sign-in 2FA step: turn a failed `POST /api/v1/auth/2fa/verify` into what the
 * user should be told.
 *
 * The server deliberately answers EVERY rejection with the same generic 401 —
 * wrong code, expired challenge, challenge at its attempt cap, locked account
 * (beebeeb-api/src/routes/totp.rs `verify`, no enumeration). So the client can
 * only tell "timed out" apart from "wrong code" by what it knows itself: when
 * the challenge was issued and how many codes it has already sent against it.
 * Both limits mirror the server's `login_2fa_challenge.rs`
 * (`CHALLENGE_TTL_MINUTES = 5`, `MAX_CHALLENGE_ATTEMPTS = 10`).
 */
export const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000
export const TWO_FACTOR_MAX_ATTEMPTS = 10

export const TWO_FACTOR_INCORRECT_MESSAGE = 'Incorrect code. Try again, or use a backup code.'
export const TWO_FACTOR_TIMED_OUT_MESSAGE = 'Your sign-in timed out. Enter your password again.'
export const TWO_FACTOR_TOO_MANY_MESSAGE = 'Too many incorrect codes. Enter your password again.'
export const TWO_FACTOR_UNREACHABLE_MESSAGE =
  "We couldn't check the code. Check your connection and try again."

export type TwoFactorFailure =
  /** Stay on the code step; show `message` in the prompt and clear the field. */
  | { kind: 'retry'; message: string }
  /** The challenge is spent; drop the partial token and show `message` on the password step. */
  | { kind: 'restart'; message: string }

export interface TwoFactorFailureContext {
  /** `Date.now()` when the partial token was issued. */
  issuedAt: number
  /** Codes sent against this partial token, INCLUDING the one that just failed. */
  attempts: number
  now?: number
}

export function classifyTwoFactorFailure(err: unknown, ctx: TwoFactorFailureContext): TwoFactorFailure {
  const now = ctx.now ?? Date.now()
  // Anything that is not an HTTP rejection (network down, 5xx) says nothing
  // about the code — do not call it incorrect, and do not burn the challenge.
  if (!(err instanceof ApiError) || err.status !== 401) {
    return { kind: 'retry', message: TWO_FACTOR_UNREACHABLE_MESSAGE }
  }
  if (now - ctx.issuedAt >= TWO_FACTOR_CHALLENGE_TTL_MS) {
    return { kind: 'restart', message: TWO_FACTOR_TIMED_OUT_MESSAGE }
  }
  if (ctx.attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
    return { kind: 'restart', message: TWO_FACTOR_TOO_MANY_MESSAGE }
  }
  return { kind: 'retry', message: TWO_FACTOR_INCORRECT_MESSAGE }
}
