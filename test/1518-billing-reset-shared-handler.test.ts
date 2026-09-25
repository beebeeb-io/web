import { describe, expect, test, mock } from 'bun:test'
import { ApiError } from '../packages/shared/src/api/errors'
import {
  BILLING_RESET_TEST_MODE_CODE,
  isBillingResetTestModeError,
  handleBillingResetTestMode,
  billingResetNavigationState,
} from '../src/lib/billing-reset'

/**
 * Task 1518 part C — Codex found 3 valid P2s on PR #69, all rooted in the
 * same gap: only `billing.tsx`'s `handleResumeCheckout` special-cased the
 * `billing_reset_test_mode` 409. `handleBillingResetTestMode` is the shared
 * handler every checkout entry point (UpgradeDialog, billing.tsx's resume/
 * storage-addon/switch-cycle handlers, pricing.tsx, upgrade-nudge-modal) now
 * routes the error through — this suite exercises it directly, no rendering
 * (this repo's `bun test` harness has no @testing-library/react / jsdom, per
 * test/1471-isloggedin-auth-context.test.ts's header comment).
 */

const MESSAGE =
  'Your subscription was created in test mode and has been reset. Please subscribe again.'

function resetError(): ApiError {
  return new ApiError(MESSAGE, 409, BILLING_RESET_TEST_MODE_CODE)
}

describe('isBillingResetTestModeError()', () => {
  test('true for the exact 409 + code combination', () => {
    expect(isBillingResetTestModeError(resetError())).toBe(true)
  })

  test('false for an ApiError with a different code (no over-broad match)', () => {
    expect(isBillingResetTestModeError(new ApiError(MESSAGE, 409, 'some_other_code'))).toBe(false)
  })

  test('false for a plain Error, and for non-Error values', () => {
    expect(isBillingResetTestModeError(new Error(MESSAGE))).toBe(false)
    expect(isBillingResetTestModeError('nope')).toBe(false)
    expect(isBillingResetTestModeError(null)).toBe(false)
    expect(isBillingResetTestModeError(undefined)).toBe(false)
  })
})

describe('handleBillingResetTestMode()', () => {
  test('returns null for an unrelated error and calls NOTHING (no reload, no dispatch) — callers fall through to their own handling', async () => {
    const refreshPlanDetails = mock(() => {})
    const dispatchPlanChanged = mock(() => {})
    const reloadLocal = mock(async () => {})
    const clearPendingCheckout = mock(() => {})

    const result = await handleBillingResetTestMode(new Error('network blip'), {
      refreshPlanDetails,
      dispatchPlanChanged,
      reloadLocal,
      clearPendingCheckout,
    })

    expect(result).toBeNull()
    expect(refreshPlanDetails).not.toHaveBeenCalled()
    expect(dispatchPlanChanged).not.toHaveBeenCalled()
    expect(reloadLocal).not.toHaveBeenCalled()
    expect(clearPendingCheckout).not.toHaveBeenCalled()
  })

  test('on the reset error: dispatches plan-changed, calls refreshPlanDetails, awaits reloadLocal, clears the pending checkout, and returns the real server message', async () => {
    const calls: string[] = []
    const refreshPlanDetails = mock(() => { calls.push('refresh') })
    const dispatchPlanChanged = mock(() => { calls.push('dispatch') })
    const reloadLocal = mock(async () => { calls.push('reload') })
    const clearPendingCheckout = mock(() => { calls.push('clear') })

    const result = await handleBillingResetTestMode(resetError(), {
      refreshPlanDetails,
      dispatchPlanChanged,
      reloadLocal,
      clearPendingCheckout,
    })

    expect(result).toBe(MESSAGE)
    expect(refreshPlanDetails).toHaveBeenCalledTimes(1)
    expect(dispatchPlanChanged).toHaveBeenCalledTimes(1)
    expect(reloadLocal).toHaveBeenCalledTimes(1)
    expect(clearPendingCheckout).toHaveBeenCalledTimes(1)
    // clearPendingCheckout runs before the redirect/reload work, matching
    // handleResumeCheckout's pre-1518-part-C ordering (moot intent first).
    expect(calls[0]).toBe('clear')
  })

  test('reloadLocal and clearPendingCheckout are optional — callers with no page-local state (UpgradeDialog with no onSuccess, pricing.tsx) can omit them', async () => {
    const refreshPlanDetails = mock(() => {})
    const dispatchPlanChanged = mock(() => {})

    const result = await handleBillingResetTestMode(resetError(), {
      refreshPlanDetails,
      dispatchPlanChanged,
    })

    expect(result).toBe(MESSAGE)
    expect(refreshPlanDetails).toHaveBeenCalledTimes(1)
    expect(dispatchPlanChanged).toHaveBeenCalledTimes(1)
  })

  test('dispatchPlanChanged is itself optional — the real default (window.dispatchEvent) is guarded and does not throw under bun test\'s non-DOM runtime', async () => {
    const refreshPlanDetails = mock(() => {})
    const result = await handleBillingResetTestMode(resetError(), { refreshPlanDetails })
    expect(result).toBe(MESSAGE)
    expect(refreshPlanDetails).toHaveBeenCalledTimes(1)
  })
})

/**
 * The suite above always injects `dispatchPlanChanged`, so it never actually
 * exercises `realDispatchPlanChanged()`'s body — the mutation gate found that
 * replacing its `window.dispatchEvent(new Event('beebeeb:plan-changed'))`
 * with a no-op left every test above green. That event is what
 * drive-data-context.tsx's `onPlanChanged` listener uses to refresh the
 * sidebar's `usage` (quota bar) — `refreshPlanDetails()` alone does NOT
 * refresh usage, only plan details, so a dropped dispatch is a real, silent
 * sidebar-goes-stale regression, not a redundant belt-and-suspenders path.
 *
 * `window` doesn't exist under bun test (confirmed: referencing the bare
 * identifier throws `ReferenceError: window is not defined`), so these tests
 * stand up a minimal fake on `globalThis.window` for the DEFAULT (un-injected)
 * code path specifically, and tear it down in `finally` so it can't leak into
 * other tests/files.
 */
describe('handleBillingResetTestMode() — the REAL default (no dispatchPlanChanged override)', () => {
  function withFakeWindow(): { dispatched: Event[]; restore: () => void } {
    const dispatched: Event[] = []
    const fakeWindow = { dispatchEvent: (event: Event) => { dispatched.push(event); return true } }
    const g = globalThis as { window?: unknown }
    const hadOwn = Object.prototype.hasOwnProperty.call(g, 'window')
    const original = g.window
    g.window = fakeWindow
    return {
      dispatched,
      restore: () => {
        if (hadOwn) g.window = original
        else delete g.window
      },
    }
  }

  test('on the reset error: the real default calls window.dispatchEvent(beebeeb:plan-changed) exactly once, AND still calls refreshPlanDetails() directly', async () => {
    const { dispatched, restore } = withFakeWindow()
    try {
      const refreshPlanDetails = mock(() => {})
      const result = await handleBillingResetTestMode(resetError(), { refreshPlanDetails })

      expect(result).toBe(MESSAGE)
      expect(refreshPlanDetails).toHaveBeenCalledTimes(1)
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0]?.type).toBe('beebeeb:plan-changed')
    } finally {
      restore()
    }
  })

  test('an unrelated error: the real default touches neither window.dispatchEvent nor refreshPlanDetails', async () => {
    const { dispatched, restore } = withFakeWindow()
    try {
      const refreshPlanDetails = mock(() => {})
      const result = await handleBillingResetTestMode(new Error('network blip'), { refreshPlanDetails })

      expect(result).toBeNull()
      expect(refreshPlanDetails).not.toHaveBeenCalled()
      expect(dispatched).toHaveLength(0)
    } finally {
      restore()
    }
  })
})

describe('billingResetNavigationState()', () => {
  test('wraps the message in the shape RedirectPreservingSearch/billing.tsx expect', () => {
    expect(billingResetNavigationState(MESSAGE)).toEqual({ billingResetMessage: MESSAGE })
  })
})
