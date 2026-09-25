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
 * Mirrors the server's `MAX_LIVE_CODES_PER_EMAIL` (round 3,
 * `signup_email_challenge.rs`) — at most this many codes may be
 * simultaneously live for one email. A 4th `/email-start` while 3 are live
 * still 202s but sends nothing new.
 */
export const MAX_LIVE_CODES_PER_EMAIL = 3

/**
 * Best-effort copy for the Nth resend click (1-indexed) since this step
 * mounted. Task 1525 round 3 (server): each `/email-start` while a code is
 * already live ADDS a new one instead of no-op'ing, up to
 * `MAX_LIVE_CODES_PER_EMAIL` simultaneously live; past the cap it is STILL a
 * 202 with no new mail sent — and by the same anti-enumeration design that
 * keeps the new-vs-existing-email responses byte-identical, the server gives
 * the client NO signal to tell "sent" and "no-op'd at the cap" apart (see
 * `beebeeb-api/src/routes/auth.rs::signup_email_start`'s doc comment: both
 * branches share one response-building function on purpose).
 *
 * So this is a LOCAL best-effort count, not a server-confirmed fact: it
 * assumes the /signup page's own initial email-start counts as the 1st live
 * code, so this step can honestly claim a genuine "sent" for its first
 * `MAX_LIVE_CODES_PER_EMAIL - 1` resend clicks. Past that we can no longer
 * honestly claim a new code went out — so we say that instead of repeating a
 * possibly-false "resent" claim (the bug this closes: the previous copy said
 * "Code resent" unconditionally, which is a LIE once the cap is reached).
 */
export function resendCopyForAttempt(
  resendAttempt: number,
  maxLiveCodes: number = MAX_LIVE_CODES_PER_EMAIL,
): { message: string; likelySent: boolean } {
  if (resendAttempt <= maxLiveCodes - 1) {
    return {
      message: 'We sent a new code. Any code from the last 15 minutes works.',
      likelySent: true,
    }
  }
  return {
    message:
      "You've already requested the maximum number of codes for now — any code from the last 15 minutes still works.",
    likelySent: false,
  }
}

/**
 * Task 1525 Codex review (PR #79, `onboarding.tsx:364`) — a
 * `signup_ticket_invalid` from register-FINISH is ambiguous in a way one
 * from register-START is not:
 *
 *  - register-START only VALIDATES the ticket (never consumes it), so an
 *    invalid ticket there is unambiguous: it really is stale/wrong, no
 *    account was created.
 *  - register-FINISH consumes the ticket atomically WITH the account INSERT,
 *    in the same transaction (server grounding, task 1525 continuation
 *    round). If its response is lost in transit, the shared `request()`
 *    client's single retry-on-network-failure resubmits the SAME POST with
 *    the now-consumed ticket, which the server correctly refuses — even
 *    though the account was actually created by the first, successful
 *    attempt.
 *
 * We can't disambiguate "genuinely never consumed, just expired" from
 * "consumed by a successful attempt whose response was lost" purely
 * client-side (the server returns one undifferentiated
 * `signup_ticket_invalid` for every cause). Silently treating a
 * finish-time failure as "pre-registration expiry" and bouncing to the code
 * step is ALSO a dead end in the ambiguous case: `/email-start` for an email
 * that now has an account sends the "you already have an account" notice,
 * never a code (task 1525's own anti-enumeration design) — so a user who
 * really did finish would be stuck on a code screen that can never be
 * completed. Route them to sign-in as an option instead of asserting either
 * story with false confidence.
 */
export type SignupTicketInvalidSource = 'register-start' | 'register-finish'

export function signupTicketInvalidCopy(source: SignupTicketInvalidSource): {
  codeStepError: string
  offerSignIn: boolean
} {
  if (source === 'register-finish') {
    return {
      codeStepError:
        "We couldn't confirm that finished. If you already completed this signup, sign in instead — or request a new code to try again.",
      offerSignIn: true,
    }
  }
  return {
    codeStepError: 'That verification expired. Please request a new code.',
    offerSignIn: false,
  }
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
