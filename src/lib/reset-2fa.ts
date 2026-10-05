import { ApiError } from '@beebeeb/shared'
import {
  TWO_FACTOR_TIMED_OUT_MESSAGE,
  type TwoFactorFailure,
} from './two-factor-login'

/**
 * Client half of "a reset ends at the 2FA challenge" (task 1803, server 1730).
 *
 * A password reset (emailed link) or a recovery-phrase recovery on an account
 * with 2FA does not mint a session at the finalize call: the server answers
 * `{ requires_2fa, partial_token }` and the person finishes through the usual
 * 2FA code step. Pure helpers only — the React step lives in
 * `components/reset-two-factor-step.tsx`.
 */

/** Server error code: the credential WAS rotated, but this client cannot finish a 2FA reset. */
export const PASSWORD_SET_SIGN_IN_REQUIRED = 'password_set_sign_in_required'

/** The one sentence shown whenever the new password is set but no session was opened. */
export const SIGN_IN_REQUIRED_MESSAGE = 'Your new password is set. Sign in to continue.'

/** True for the server's typed 409 after a reset by a client that cannot finish the 2FA step. */
export function isPasswordSetSignInRequired(err: unknown): boolean {
  return err instanceof ApiError && err.code === PASSWORD_SET_SIGN_IN_REQUIRED
}

/**
 * Why the 2FA step closed without a session, for the sign-in-required screen.
 * The generic login copy ("Enter your password again") would be wrong here: the
 * password is already set, so the honest next step is a normal sign-in.
 */
export function describeResetTwoFactorClosed(failure: Extract<TwoFactorFailure, { kind: 'restart' }>): string {
  return failure.message === TWO_FACTOR_TIMED_OUT_MESSAGE
    ? 'The code step timed out before a valid code was entered.'
    : 'The code step was closed after too many incorrect codes.'
}
