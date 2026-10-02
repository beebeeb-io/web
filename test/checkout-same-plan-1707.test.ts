import { describe, expect, test } from 'bun:test'
import { ApiError } from '../src/lib/api'
import type { Subscription } from '@beebeeb/shared'
import {
  SAME_PLAN_ACTIVE_CODE,
  isSamePlanActiveError,
  samePlanConflictMessage,
  isCurrentPlanCycle,
} from '../src/lib/checkout-same-plan'
import { userFriendlyError } from '../src/lib/user-friendly-error'
import {
  effectiveUpgradeTarget,
  resolveUpgradeCheckoutFailure,
} from '../src/components/upgrade-nudge-modal'

/**
 * Task 1707 — the server's same-plan re-purchase guard returns a typed 409
 * `already_subscribed` ("You already have an active basic (yearly)
 * subscription — manage it at /billing") when a checkout targets the EXACT
 * plan+cycle the user's newest entitled subscription row already carries as
 * `status='active'` with a real Mollie subscription. These tests cover the
 * web side at the level the existing harnesses support (helper-level, no
 * component rendering — see test/pricing-checkout-intent-1469.test.ts's
 * header comment for why these helpers are extracted that way):
 *
 *   - error recognition + friendly-copy mapping (the three checkout error
 *     surfaces — /pricing handleSelect, UpgradeDialog's proceedToPayment,
 *     the nudge's resolveUpgradeCheckoutFailure — all branch through these);
 *   - the "Current plan" CTA predicate shared by /pricing's PlanCard and
 *     UpgradeDialog's Continue button;
 *   - the nudge's honesty guard: the "Upgrade to X" claim is dropped when the
 *     user already holds the chain target on the yearly cycle the nudge
 *     checks out.
 *
 * The actual button rendering is covered by inspection only (no component
 * render harness exists in this repo — recorded honestly in the task
 * evidence).
 */

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    plan: 'free',
    billing_cycle: 'monthly',
    seats: 1,
    region: 'falkenstein',
    status: 'active',
    created_at: null,
    current_period_end: null,
    ...overrides,
  }
}

const SERVER_MESSAGE = 'You already have an active basic (yearly) subscription — manage it at /billing'

function samePlanError(): ApiError {
  return new ApiError(SERVER_MESSAGE, 409, SAME_PLAN_ACTIVE_CODE)
}

describe('isSamePlanActiveError — recognises the task-1707 typed 409', () => {
  test('true for a 409 carrying the already_subscribed code', () => {
    expect(isSamePlanActiveError(samePlanError())).toBe(true)
  })

  test('false for a 409 with a different code (billing_reset_test_mode)', () => {
    const err = new ApiError('Subscription reset', 409, 'billing_reset_test_mode')
    expect(isSamePlanActiveError(err)).toBe(false)
  })

  test('false when the same code arrives on a non-409 status', () => {
    const err = new ApiError(SERVER_MESSAGE, 403, SAME_PLAN_ACTIVE_CODE)
    expect(isSamePlanActiveError(err)).toBe(false)
  })

  test('false for a plain Error and for a code-less ApiError', () => {
    expect(isSamePlanActiveError(new Error('boom'))).toBe(false)
    expect(isSamePlanActiveError(new ApiError('boom', 409))).toBe(false)
  })
})

describe('samePlanConflictMessage — grounded copy passthrough', () => {
  test('uses the server message verbatim (it names plan, cycle and /billing)', () => {
    expect(samePlanConflictMessage(samePlanError())).toBe(SERVER_MESSAGE)
  })

  test('falls back when the server message is empty', () => {
    const err = new ApiError('', 409, SAME_PLAN_ACTIVE_CODE)
    expect(samePlanConflictMessage(err)).toBe(
      'You already have an active subscription on this plan. Manage it in Billing.',
    )
  })
})

describe('userFriendlyError — central mapper routes the 409 to the server copy', () => {
  test('returns the server message for the already_subscribed code', () => {
    expect(userFriendlyError(samePlanError())).toBe(SERVER_MESSAGE)
  })

  test('keeps the looksUserFriendly passthrough for other conflicts', () => {
    const err = new ApiError('another conflict', 409)
    expect(userFriendlyError(err)).toBe('another conflict')
  })
})

describe('isCurrentPlanCycle — the "Current plan" CTA predicate', () => {
  test('true for active + same plan + same cycle', () => {
    expect(isCurrentPlanCycle(sub({ plan: 'basic', billing_cycle: 'yearly' }), 'basic', 'yearly')).toBe(true)
  })

  test('false when the cycle differs (the server passes a cycle switch through)', () => {
    expect(isCurrentPlanCycle(sub({ plan: 'basic', billing_cycle: 'yearly' }), 'basic', 'monthly')).toBe(false)
  })

  test('false when the plan differs', () => {
    expect(isCurrentPlanCycle(sub({ plan: 'basic', billing_cycle: 'yearly' }), 'pro', 'yearly')).toBe(false)
  })

  test('false for trialing / cancelled / past_due rows — only active blocks', () => {
    expect(isCurrentPlanCycle(sub({ plan: 'basic', billing_cycle: 'yearly', status: 'trialing' }), 'basic', 'yearly')).toBe(false)
    expect(isCurrentPlanCycle(sub({ plan: 'basic', billing_cycle: 'yearly', status: 'cancelled' }), 'basic', 'yearly')).toBe(false)
    expect(isCurrentPlanCycle(sub({ plan: 'basic', billing_cycle: 'yearly', status: 'past_due' }), 'basic', 'yearly')).toBe(false)
  })

  test('false with no subscription snapshot (signed-out / fetch failed)', () => {
    expect(isCurrentPlanCycle(null, 'basic', 'yearly')).toBe(false)
  })

  test('strict slug equality: a legacy personal row never reads as a basic card', () => {
    expect(isCurrentPlanCycle(sub({ plan: 'personal', billing_cycle: 'yearly' }), 'basic', 'yearly')).toBe(false)
  })
})

describe('effectiveUpgradeTarget — nudge never claims an upgrade that cannot happen', () => {
  test('drops the claim when the user already holds the chain target yearly', () => {
    expect(effectiveUpgradeTarget('basic', sub({ plan: 'pro', billing_cycle: 'yearly' }))).toBeNull()
  })

  test('keeps the claim for a different cycle (pro monthly is not the yearly checkout)', () => {
    expect(effectiveUpgradeTarget('basic', sub({ plan: 'pro', billing_cycle: 'monthly' }))).toBe('pro')
  })

  test('keeps the claim for non-active rows (trialing/cancelled pass the server guard)', () => {
    expect(effectiveUpgradeTarget('basic', sub({ plan: 'pro', billing_cycle: 'yearly', status: 'trialing' }))).toBe('pro')
    expect(effectiveUpgradeTarget('basic', sub({ plan: 'pro', billing_cycle: 'yearly', status: 'cancelled' }))).toBe('pro')
  })

  test('keeps the claim with no subscription snapshot', () => {
    expect(effectiveUpgradeTarget('basic', null)).toBe('pro')
  })

  test('null when the chain ends (pro has no next marketed tier)', () => {
    expect(effectiveUpgradeTarget('pro', null)).toBeNull()
  })

  test('normal chain for a user genuinely below the target', () => {
    expect(effectiveUpgradeTarget('basic', sub({ plan: 'basic', billing_cycle: 'yearly' }))).toBe('pro')
  })
})

describe('resolveUpgradeCheckoutFailure — the 409 stays on the modal with friendly copy', () => {
  test('same-plan 409: navigateTo null, localError is the server copy, plan state refreshed', async () => {
    let refreshed = 0
    const failure = await resolveUpgradeCheckoutFailure(samePlanError(), {
      refreshPlanDetails: () => {
        refreshed++
      },
    })
    expect(failure.navigateTo).toBeNull()
    expect(failure.localError).toBe(SERVER_MESSAGE)
    expect(failure.navigateState).toBeUndefined()
    expect(refreshed).toBe(1)
  })

  test('generic checkout failure keeps the pre-1707 behaviour (navigate to /billing)', async () => {
    let refreshed = 0
    const failure = await resolveUpgradeCheckoutFailure(new ApiError('boom', 500), {
      refreshPlanDetails: () => {
        refreshed++
      },
    })
    expect(failure.navigateTo).toBe('/billing')
    expect(failure.localError).toBe('boom')
    expect(refreshed).toBe(0)
  })
})
