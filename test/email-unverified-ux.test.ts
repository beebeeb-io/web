import { describe, expect, test } from 'bun:test'
import { ApiError } from '@beebeeb/shared'
import { userFriendlyError, isEmailUnverified } from '../src/lib/user-friendly-error'

// task 0762 — the typed 403 email_unverified must surface a verify-email
// explainer (pointing at the always-present banner), never the generic
// "you don't have permission" 403 fall-through.
describe('email_unverified UX (task 0762)', () => {
  const unverified = new ApiError('email_unverified', 403, 'email_unverified')

  test('userFriendlyError surfaces the verify-email explainer, not the generic 403', () => {
    const msg = userFriendlyError(unverified)
    expect(msg).toMatch(/verify your email/i)
    expect(msg).not.toMatch(/don.?t have permission/i)
  })

  test('isEmailUnverified is true only for the typed 403', () => {
    expect(isEmailUnverified(unverified)).toBe(true)
    expect(isEmailUnverified(new ApiError('Forbidden', 403))).toBe(false) // generic 403, no code
    expect(isEmailUnverified(new ApiError('email_unverified', 401, 'email_unverified'))).toBe(false)
    expect(isEmailUnverified(new Error('nope'))).toBe(false)
  })

  test('a generic 403 still maps to the permission message (no regression)', () => {
    expect(userFriendlyError(new ApiError('Forbidden', 403))).toMatch(/permission/i)
  })
})
