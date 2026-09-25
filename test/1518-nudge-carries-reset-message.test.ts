import { describe, expect, test, mock } from 'bun:test'
import { ApiError } from '../packages/shared/src/api/errors'
import { BILLING_RESET_TEST_MODE_CODE } from '../src/lib/billing-reset'

/**
 * Task 1518 part C (Codex P2 #3, PR #69) — before this fix,
 * upgrade-nudge-modal.tsx's `handleUpgrade` stored a failed checkout's
 * `err.message` in local `checkoutError` state and immediately called
 * `navigate('/billing')` — discarding that state along with the rest of the
 * unmounting modal, so the "your subscription was reset, please subscribe
 * again" explanation never reached the user.
 *
 * `resolveUpgradeCheckoutFailure` (extracted from `handleUpgrade`'s catch
 * block, mirrors `startUpgradeCheckout`'s existing extraction just above it
 * in the same file) decides what the catch block should do. This suite
 * exercises it directly — no rendering (this repo's `bun test` harness has
 * no @testing-library/react / jsdom, per
 * test/1471-isloggedin-auth-context.test.ts's header comment).
 */

const MESSAGE =
  'Your subscription was created in test mode and has been reset. Please subscribe again.'

const { resolveUpgradeCheckoutFailure } = await import('../src/components/upgrade-nudge-modal')

describe('resolveUpgradeCheckoutFailure() — carrying the billing-reset explanation across navigation', () => {
  test('billing_reset_test_mode: navigates to /billing WITH the real message as router state, sets no local error, and reloads plan state', async () => {
    const refreshPlanDetails = mock(() => {})
    const dispatchPlanChanged = mock(() => {})
    const err = new ApiError(MESSAGE, 409, BILLING_RESET_TEST_MODE_CODE)

    const failure = await resolveUpgradeCheckoutFailure(err, { refreshPlanDetails, dispatchPlanChanged })

    expect(failure.navigateTo).toBe('/billing')
    // The exact shape billing.tsx's landing-page effect reads off
    // useLocation().state to show the toast.
    expect(failure.navigateState).toEqual({ billingResetMessage: MESSAGE })
    // Not set — the modal is about to unmount on this navigation, so a local
    // `checkoutError` would never be seen (the bug this task fixes).
    expect(failure.localError).toBeUndefined()
    expect(refreshPlanDetails).toHaveBeenCalledTimes(1)
    expect(dispatchPlanChanged).toHaveBeenCalledTimes(1)
  })

  test('a different error: still navigates to /billing, but with a local error and NO router state (unchanged pre-1518 behavior)', async () => {
    const refreshPlanDetails = mock(() => {})
    const dispatchPlanChanged = mock(() => {})
    const err = new Error('checkout unavailable')

    const failure = await resolveUpgradeCheckoutFailure(err, { refreshPlanDetails, dispatchPlanChanged })

    expect(failure.navigateTo).toBe('/billing')
    expect(failure.navigateState).toBeUndefined()
    expect(failure.localError).toBe('checkout unavailable')
    expect(refreshPlanDetails).not.toHaveBeenCalled()
    expect(dispatchPlanChanged).not.toHaveBeenCalled()
  })

  test('a non-Error throw falls back to the generic local error message', async () => {
    const refreshPlanDetails = mock(() => {})
    const failure = await resolveUpgradeCheckoutFailure('boom', { refreshPlanDetails })
    expect(failure.localError).toBe('Could not start checkout')
    expect(failure.navigateState).toBeUndefined()
  })

  test('an unrelated 409 with a different code is NOT treated as a reset (no over-broad match)', async () => {
    const refreshPlanDetails = mock(() => {})
    const err = new ApiError('some other conflict', 409, 'some_other_code')
    const failure = await resolveUpgradeCheckoutFailure(err, { refreshPlanDetails })
    expect(failure.navigateState).toBeUndefined()
    expect(failure.localError).toBe('some other conflict')
    expect(refreshPlanDetails).not.toHaveBeenCalled()
  })
})
