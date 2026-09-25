/**
 * Task 1525 — verify the email with a code BEFORE the account is created.
 *
 * Pure decision/formatting functions for the /onboarding "check your inbox"
 * code step, extracted so they're unit-testable without React (this repo's
 * `bun test` harness has no @testing-library/react / jsdom — see
 * test/1471-isloggedin-auth-context.test.ts's header comment, same pattern
 * as src/lib/signup-pilot-gate.ts).
 */

import { ApiError } from './api'

/** The server's code length (`beebeeb-api::routes::auth::generate_verification_code` —
 * widened 6→8 digits, task 1525's server-side "Deviation flagged" note). */
export const EMAIL_CODE_LENGTH = 8

/**
 * Strip everything but digits and truncate to `maxLength`. Used on every
 * keystroke AND on paste — a pasted code often carries surrounding
 * whitespace, dashes, or the word "Code:" copied along with it from the
 * email, so this is deliberately permissive about the input shape as long
 * as the digits themselves are intact and in order.
 */
export function sanitizeCode(raw: string, maxLength: number = EMAIL_CODE_LENGTH): string {
  return raw.replace(/\D/g, '').slice(0, maxLength)
}

/** `code` padded to `length` with spaces, split into one char per visual box. */
export function codeDigitsForDisplay(code: string, length: number = EMAIL_CODE_LENGTH): string[] {
  return code.padEnd(length, ' ').split('')
}

/**
 * Whether `err` means "this server predates task 1525 and has no
 * `/signup/email-start` route at all" — the capability-detection signal
 * `signup.tsx` uses to fall back to the pre-1525 flow (generate the phrase
 * immediately, register with no ticket) rather than showing a code screen
 * a rolling-deploy-stale server can never satisfy. Every OTHER error
 * (400 bad email, 429 rate limited, network failure, 5xx) means the route
 * DOES exist — the failure is surfaced on-screen instead.
 */
export function isLegacyFallbackError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}

export interface SignupOnboardingNavState {
  email?: string
  pilotKey?: string
  /**
   * Set by signup.tsx from the outcome of its `signupEmailStart` call:
   * `true` when the server accepted it (show the code step), `false` when
   * the call 404'd (legacy fallback — skip straight to the recovery
   * phrase, exactly like every build before task 1525). Undefined only on
   * an unreachable path (onboarding.tsx is entered with no `email` either,
   * which already redirects back to /signup) — defaults conservatively to
   * the pre-1525 behavior rather than stranding a user on a code screen no
   * code was ever sent for.
   */
  emailCodeSupported?: boolean
}

/** The initial onboarding step for a given capability outcome. */
export function initialOnboardingStep(
  navState: SignupOnboardingNavState | null | undefined,
): 'code' | 'display' {
  return navState?.emailCodeSupported ? 'code' : 'display'
}
