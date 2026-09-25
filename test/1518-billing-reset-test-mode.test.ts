import { describe, expect, test } from 'bun:test'
import { ApiError } from '../packages/shared/src/api/errors'
import { userFriendlyError } from '../src/lib/user-friendly-error'

/**
 * Task 1518 — server PR #94 added a 409 `billing_reset_test_mode` response
 * (a subscription created while Mollie was in test mode gets reset; the
 * account falls back to the free plan and must subscribe again):
 *
 *   { "error": "billing_reset_test_mode",
 *     "message": "Your subscription was created in test mode and has been
 *                  reset. Please subscribe again." }
 *
 * That message is 86 characters — over `user-friendly-error.ts`'s
 * `SHORT_MESSAGE_MAX` (80) — so `looksUserFriendly()` rejected it and every
 * caller of `userFriendlyError()` (UpgradeDialog, billing.tsx's checkout-resume
 * handler, upgrade-nudge-modal, pricing.tsx) fell through to the generic
 * "Something went wrong. Try again." with no explicit `code` branch to catch
 * it first, same shape as the other typed-code branches just above it
 * (`object_budget_exceeded`, `quota_exceeded`, `downgrade_blocked_over_quota`).
 */

const MESSAGE =
  'Your subscription was created in test mode and has been reset. Please subscribe again.'

describe('userFriendlyError() — billing_reset_test_mode (1518)', () => {
  test('the real server message is over SHORT_MESSAGE_MAX (80) — this is why it needs an explicit code branch', () => {
    expect(MESSAGE.length).toBeGreaterThan(80)
  })

  test('shows the server message verbatim instead of the generic fallback', () => {
    const err = new ApiError(MESSAGE, 409, 'billing_reset_test_mode')
    expect(userFriendlyError(err)).toBe(MESSAGE)
    expect(userFriendlyError(err)).not.toBe('Something went wrong. Try again.')
  })

  test('an unrelated 409 with a long message and a different code still falls through to the generic message (no over-broad match)', () => {
    const longUnrelatedMessage =
      'This is a different long conflict message that also exceeds eighty characters in length.'
    const err = new ApiError(longUnrelatedMessage, 409, 'some_other_code')
    expect(userFriendlyError(err)).toBe('Something went wrong. Try again.')
  })
})
