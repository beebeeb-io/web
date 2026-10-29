import { describe, expect, test, afterEach } from 'bun:test'
import {
  sanitizeCode,
  codeDigitsForDisplay,
  isLegacyFallbackError,
  initialOnboardingStep,
  resendCopyForAttempt,
  signupTicketInvalidCopy,
  EMAIL_CODE_LENGTH,
  MAX_LIVE_CODES_PER_EMAIL,
} from '../src/lib/signup-email-code'
import { ApiError, signupEmailStart, signupEmailVerify, opaqueRegisterStart, opaqueRegisterFinish } from '../src/lib/api'

/**
 * Task 1525 — verify the email with a code BEFORE the account is created.
 *
 * Pure-logic + network-client coverage. No React rendering (this repo's
 * `bun test` harness has no @testing-library/react / jsdom — see
 * test/1471-isloggedin-auth-context.test.ts's header comment, same pattern
 * as test/1520-signup-pilot-key-gate.test.ts).
 */

describe('sanitizeCode() — the code-input / paste sanitizer', () => {
  test('strips non-digits', () => {
    expect(sanitizeCode('12-34 56.78')).toBe('12345678')
  })

  test('truncates to EMAIL_CODE_LENGTH digits', () => {
    expect(sanitizeCode('123456789999')).toBe('12345678')
    expect(sanitizeCode('123456789999').length).toBe(EMAIL_CODE_LENGTH)
  })

  test('a code pasted with surrounding prose keeps only the digits, in order', () => {
    // A real email body reads "...verify your Beebeeb account: 40217693\n\n...".
    // A user who selects too much and pastes the whole line must still land
    // on exactly the code.
    expect(sanitizeCode('Enter this code to verify your Beebeeb account: 40217693')).toBe('40217693')
  })

  test('empty / all-non-digit input -> empty string', () => {
    expect(sanitizeCode('')).toBe('')
    expect(sanitizeCode('abc-def')).toBe('')
  })

  test('fewer than 8 digits pasted -> passed through as-is (not padded)', () => {
    expect(sanitizeCode('123')).toBe('123')
  })

  test('respects a custom maxLength', () => {
    expect(sanitizeCode('123456', 4)).toBe('1234')
  })
})

describe('codeDigitsForDisplay() — the visual digit-box render', () => {
  test('pads a partial code with spaces to EMAIL_CODE_LENGTH slots', () => {
    const digits = codeDigitsForDisplay('123')
    expect(digits.length).toBe(EMAIL_CODE_LENGTH)
    expect(digits).toEqual(['1', '2', '3', ' ', ' ', ' ', ' ', ' '])
  })

  test('a full 8-digit code renders with no padding', () => {
    expect(codeDigitsForDisplay('40217693')).toEqual(['4', '0', '2', '1', '7', '6', '9', '3'])
  })

  test('empty code -> all blank slots', () => {
    expect(codeDigitsForDisplay('')).toEqual([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '])
  })
})

describe('resendCopyForAttempt() — honest resend copy (round-3 server: server #95, resend ADDS a code, cap 3 live)', () => {
  test('MAX_LIVE_CODES_PER_EMAIL matches the server round-3 cap of 3', () => {
    expect(MAX_LIVE_CODES_PER_EMAIL).toBe(3)
  })

  test('resend attempt 1 (2nd live code overall) claims a genuine send', () => {
    const { message, likelySent } = resendCopyForAttempt(1)
    expect(likelySent).toBe(true)
    expect(message).toBe('We sent a new code. Any code from the last 15 minutes works.')
  })

  test('resend attempt 2 (3rd live code overall — exactly at the cap) still claims a genuine send', () => {
    const { likelySent } = resendCopyForAttempt(2)
    expect(likelySent).toBe(true)
  })

  test('resend attempt 3 (would be a 4th live code — past the cap) must NOT claim "resent"', () => {
    const { message, likelySent } = resendCopyForAttempt(3)
    expect(likelySent).toBe(false)
    expect(message.toLowerCase()).not.toContain('we sent a new code')
    expect(message).toContain('maximum number of codes')
  })

  test('resend attempt 4+ keeps the honest cap message (does not flip back to claiming a send)', () => {
    expect(resendCopyForAttempt(4).likelySent).toBe(false)
    expect(resendCopyForAttempt(10).likelySent).toBe(false)
  })

  test('respects a custom maxLiveCodes', () => {
    expect(resendCopyForAttempt(1, 2).likelySent).toBe(true) // 2nd of 2 — still under
    expect(resendCopyForAttempt(2, 2).likelySent).toBe(false) // would be 3rd of a 2-cap
  })
})

describe('signupTicketInvalidCopy() — register-start vs register-finish ambiguity (Codex review, PR #79)', () => {
  test('register-start: unambiguous, no sign-in offer (register-start never consumes the ticket)', () => {
    const { codeStepError, offerSignIn } = signupTicketInvalidCopy('register-start')
    expect(offerSignIn).toBe(false)
    expect(codeStepError).toBe('That verification expired. Please request a new code.')
  })

  test('register-finish: ambiguous (may have already succeeded) — offers sign-in', () => {
    const { codeStepError, offerSignIn } = signupTicketInvalidCopy('register-finish')
    expect(offerSignIn).toBe(true)
    expect(codeStepError.toLowerCase()).toContain('sign in')
  })

  test('the two sources never produce identical copy — the whole point is to distinguish them', () => {
    expect(signupTicketInvalidCopy('register-start').codeStepError).not.toBe(
      signupTicketInvalidCopy('register-finish').codeStepError,
    )
  })
})

describe('isLegacyFallbackError() — the capability-detection signal', () => {
  test('a 404 ApiError (server predates task 1525) -> true', () => {
    expect(isLegacyFallbackError(new ApiError('Not Found', 404))).toBe(true)
  })

  test('a 429 ApiError (rate limited — route exists) -> false', () => {
    expect(isLegacyFallbackError(new ApiError('Rate limited', 429, 'rate_limit_exceeded'))).toBe(false)
  })

  test('a 400 ApiError (bad request — route exists) -> false', () => {
    expect(isLegacyFallbackError(new ApiError('invalid email address', 400))).toBe(false)
  })

  test('a plain network-failure ApiError (status 0) -> false — do NOT silently skip the code step on a flaky connection', () => {
    expect(isLegacyFallbackError(new ApiError('Could not reach the server.', 0))).toBe(false)
  })

  test('a non-ApiError value -> false', () => {
    expect(isLegacyFallbackError(new Error('boom'))).toBe(false)
    expect(isLegacyFallbackError('boom')).toBe(false)
    expect(isLegacyFallbackError(null)).toBe(false)
  })
})

describe('initialOnboardingStep() — which step /onboarding mounts into', () => {
  test('emailCodeSupported: true -> starts on the code step', () => {
    expect(initialOnboardingStep({ email: 'a@beebeeb.io', emailCodeSupported: true })).toBe('code')
  })

  test('emailCodeSupported: false (legacy fallback) -> starts on the phrase display, unchanged from pre-1525', () => {
    expect(initialOnboardingStep({ email: 'a@beebeeb.io', emailCodeSupported: false })).toBe('display')
  })

  test('missing navState / missing flag -> defaults to the conservative legacy path, never strands the user on an unreachable code screen', () => {
    expect(initialOnboardingStep(null)).toBe('display')
    expect(initialOnboardingStep(undefined)).toBe('display')
    expect(initialOnboardingStep({ email: 'a@beebeeb.io' })).toBe('display')
  })
})

// ─── Network client coverage (mirrors test/pilot-key-registration-flow.test.ts) ───

function capturingFetch(
  calls: { url: string; body: unknown }[],
  respond: (url: string) => { status: number; body: unknown },
) {
  return (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url: String(url), body })
    const { status, body: respBody } = respond(String(url))
    return new Response(JSON.stringify(respBody), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('signupEmailStart() / signupEmailVerify()', () => {
  test('signupEmailStart posts {email} to /signup/email-start', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 202,
      body: { message: "If that address can sign up, we've sent you a code." },
    }))

    const result = await signupEmailStart('a@beebeeb.io')

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/signup/email-start')
    expect(calls[0].body).toEqual({ email: 'a@beebeeb.io' })
    expect(result.message).toContain('sent you a code')
  })

  test('signupEmailStart on a 404 (pre-1525 server) throws an ApiError with status 404', async () => {
    globalThis.fetch = capturingFetch([], () => ({ status: 404, body: { error: 'Not Found' } }))

    await expect(signupEmailStart('a@beebeeb.io')).rejects.toMatchObject({ status: 404 })
  })

  test('signupEmailVerify posts {email, code} and returns the signup_ticket', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 200,
      body: { signup_ticket: 'tkt_abc123' },
    }))

    const result = await signupEmailVerify('a@beebeeb.io', '40217693')

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/signup/email-verify')
    expect(calls[0].body).toEqual({ email: 'a@beebeeb.io', code: '40217693' })
    expect(result.signup_ticket).toBe('tkt_abc123')
  })

  test('signupEmailVerify on a wrong/expired code throws with the server\'s undifferentiated message', async () => {
    globalThis.fetch = capturingFetch([], () => ({
      status: 400,
      body: { error: 'invalid or expired code' },
    }))

    await expect(signupEmailVerify('a@beebeeb.io', '00000000')).rejects.toMatchObject({
      status: 400,
      message: 'invalid or expired code',
    })
  })
})

describe('opaqueRegisterStart() / opaqueRegisterFinish() carry signup_ticket (task 1525)', () => {
  test('register-start sends signup_ticket in the BODY (not a header) when provided', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 200,
      body: { server_message: 'AAAA' },
    }))

    await opaqueRegisterStart('a@beebeeb.io', 'Y2xpZW50LW1lc3NhZ2U=', undefined, 'tkt_abc123')

    expect(calls.length).toBe(1)
    expect(calls[0].body).toMatchObject({ email: 'a@beebeeb.io', signup_ticket: 'tkt_abc123' })
  })

  test('register-start omits signup_ticket entirely when none is passed (legacy / flag-off path)', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = capturingFetch(calls, () => ({ status: 200, body: { server_message: 'AAAA' } }))

    await opaqueRegisterStart('a@beebeeb.io', 'Y2xpZW50LW1lc3NhZ2U=')

    expect('signup_ticket' in (calls[0].body as object)).toBe(false)
  })

  test('register-finish ALSO sends signup_ticket — the call that actually consumes it', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 200,
      body: { user_id: 'u1', session_token: 'tok' },
    }))

    await opaqueRegisterFinish(
      'a@beebeeb.io',
      'cmVnaXN0cmF0aW9uLXVwbG9hZA==',
      'eDI1NTE5LXB1Yg==',
      'cmVjb3ZlcnktY2hlY2s=',
      undefined,
      undefined,
      undefined,
      undefined,
      'tkt_abc123',
    )

    expect(calls.length).toBe(1)
    expect(calls[0].body).toMatchObject({ email: 'a@beebeeb.io', signup_ticket: 'tkt_abc123' })
  })

  test('a signup_ticket_invalid 403 surfaces with the matching ApiError code', async () => {
    globalThis.fetch = capturingFetch([], () => ({
      status: 403,
      body: { error: 'signup_ticket_invalid' },
    }))

    await expect(
      opaqueRegisterFinish('a@beebeeb.io', 'x', 'y', 'z', undefined, undefined, undefined, undefined, 'stale-ticket'),
    ).rejects.toMatchObject({ status: 403, code: 'signup_ticket_invalid' })
  })
})
