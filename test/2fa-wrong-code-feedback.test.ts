import { describe, expect, test } from 'bun:test'
import { ApiError } from '@beebeeb/shared'
import {
  classifyTwoFactorFailure,
  TWO_FACTOR_CHALLENGE_TTL_MS,
  TWO_FACTOR_INCORRECT_MESSAGE,
  TWO_FACTOR_MAX_ATTEMPTS,
  TWO_FACTOR_TIMED_OUT_MESSAGE,
  TWO_FACTOR_TOO_MANY_MESSAGE,
  TWO_FACTOR_UNREACHABLE_MESSAGE,
} from '../src/lib/two-factor-login'

/**
 * Sign-in 2FA failure copy (flow "Support, help & communication", fix lane 0).
 * The server's /auth/2fa/verify returns one generic 401 for wrong code,
 * expired challenge and attempt cap alike; the client decides the copy from
 * the challenge's age and its own attempt count.
 */
describe('classifyTwoFactorFailure', () => {
  const issuedAt = 1_000_000
  const unauthorized = new ApiError('Unauthorized', 401)

  test('a 401 inside the window with attempts left is an incorrect code — stay on the step', () => {
    expect(classifyTwoFactorFailure(unauthorized, { issuedAt, attempts: 1, now: issuedAt + 10_000 })).toEqual({
      kind: 'retry',
      message: TWO_FACTOR_INCORRECT_MESSAGE,
    })
    expect(TWO_FACTOR_INCORRECT_MESSAGE).toMatch(/incorrect code/i)
  })

  test('a 401 after the challenge TTL is a timeout — back to the password step', () => {
    expect(
      classifyTwoFactorFailure(unauthorized, { issuedAt, attempts: 1, now: issuedAt + TWO_FACTOR_CHALLENGE_TTL_MS }),
    ).toEqual({ kind: 'restart', message: TWO_FACTOR_TIMED_OUT_MESSAGE })
    expect(TWO_FACTOR_TIMED_OUT_MESSAGE).toBe('Your sign-in timed out. Enter your password again.')
  })

  test('the attempt that reaches the server cap restarts; the one before it does not', () => {
    const now = issuedAt + 1_000
    expect(classifyTwoFactorFailure(unauthorized, { issuedAt, attempts: TWO_FACTOR_MAX_ATTEMPTS - 1, now }).kind).toBe(
      'retry',
    )
    expect(classifyTwoFactorFailure(unauthorized, { issuedAt, attempts: TWO_FACTOR_MAX_ATTEMPTS, now })).toEqual({
      kind: 'restart',
      message: TWO_FACTOR_TOO_MANY_MESSAGE,
    })
  })

  test('limits mirror the server (CHALLENGE_TTL_MINUTES = 5, MAX_CHALLENGE_ATTEMPTS = 10)', () => {
    expect(TWO_FACTOR_CHALLENGE_TTL_MS).toBe(5 * 60 * 1000)
    expect(TWO_FACTOR_MAX_ATTEMPTS).toBe(10)
  })

  test('a network failure or 5xx is never called an incorrect code', () => {
    const ctx = { issuedAt, attempts: 1, now: issuedAt + 1_000 }
    for (const err of [new TypeError('Failed to fetch'), new ApiError('boom', 500), new ApiError('slow down', 429)]) {
      expect(classifyTwoFactorFailure(err, ctx)).toEqual({ kind: 'retry', message: TWO_FACTOR_UNREACHABLE_MESSAGE })
    }
  })
})
