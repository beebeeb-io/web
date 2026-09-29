import { describe, expect, test } from 'bun:test'
import type { Plan, Subscription } from '@beebeeb/shared'
import {
  resolveAccountState,
  planGateRedirect,
  lapsedBannerCopy,
  uploadBlockedNotice,
  CHOOSE_PLAN_PATH,
  accountStateFromError,
} from '../src/lib/account-state'
import { ApiError } from '../src/lib/api'
import { userFriendlyError } from '../src/lib/user-friendly-error'
import {
  TRIAL_PLAN_SLUGS,
  DEFAULT_TRIAL_DAYS,
  buildTrialPlanOptions,
  trialTermsCopy,
  startTrialLabel,
  TRIAL_METHOD_COPY,
  trialAutoConvertCopy,
  choosePlanEntry,
  choosePlanPath,
  trialReturnOutcome,
  trialPriceLabel,
  classifyTrialCheckoutError,
  trialRenewalAmount,
  trialBlockedCopy,
} from '../src/lib/trial-checkout'
import { resolveResumeAction } from '../src/lib/pending-checkout'

/**
 * Task 1037 — no free signups: a trial with a payment mandate at signup.
 *
 * The pure decisions behind /signup's plan picker, /choose-plan, the
 * needs_plan route gate, the lapsed banner and the auto-converting trial copy.
 * No React here (the repo's bun harness has no jsdom); the pages call these.
 */

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    plan: 'free',
    billing_cycle: 'monthly',
    seats: 1,
    region: 'eu-central',
    status: 'active',
    created_at: null,
    current_period_end: null,
    ...overrides,
  }
}

describe('resolveAccountState', () => {
  test('passes the three server states through', () => {
    expect(resolveAccountState(sub({ account_state: 'ok' }))).toBe('ok')
    expect(resolveAccountState(sub({ account_state: 'needs_plan' }))).toBe('needs_plan')
    expect(resolveAccountState(sub({ account_state: 'lapsed' }))).toBe('lapsed')
  })
  test('a missing field (older server), a missing subscription, or junk is "ok"', () => {
    expect(resolveAccountState(sub())).toBe('ok')
    expect(resolveAccountState(null)).toBe('ok')
    expect(resolveAccountState(undefined)).toBe('ok')
    expect(resolveAccountState(sub({ account_state: 'weird' as never }))).toBe('ok')
  })
})

describe('planGateRedirect — needs_plan sends every app route to /choose-plan', () => {
  test('protected app routes redirect', () => {
    for (const p of ['/', '/photos', '/settings/security', '/settings/import', '/shared', '/trash']) {
      expect(planGateRedirect(p, 'needs_plan')).toBe(CHOOSE_PLAN_PATH)
    }
    expect(CHOOSE_PLAN_PATH).toBe('/choose-plan')
  })
  test('the chooser, account settings, deletion, logout and the billing return stay reachable', () => {
    for (const p of [
      '/choose-plan',
      '/choose-plan/',
      '/settings/account',
      '/settings/profile',
      '/settings/delete-account',
      '/settings/billing',
      '/billing',
      '/logout',
      '/verify-email',
      // `bb login --browser` must still work for an account without a plan.
      '/cli-auth',
    ]) {
      expect(planGateRedirect(p, 'needs_plan')).toBeNull()
    }
  })
  test('a prefix match is not an allow (no /settings/accountX loophole)', () => {
    expect(planGateRedirect('/settings/account-evil', 'needs_plan')).toBe(CHOOSE_PLAN_PATH)
    expect(planGateRedirect('/choose-planet', 'needs_plan')).toBe(CHOOSE_PLAN_PATH)
  })
  test('ok and lapsed accounts are never redirected (lapsed is read-only, not locked out)', () => {
    expect(planGateRedirect('/', 'ok')).toBeNull()
    expect(planGateRedirect('/', 'lapsed')).toBeNull()
    expect(planGateRedirect('/photos', 'lapsed')).toBeNull()
  })
})

describe('lapsedBannerCopy', () => {
  test('names the deletion date', () => {
    expect(lapsedBannerCopy('2026-12-01T12:00:00Z')).toBe(
      'Your trial has ended and your vault is read-only. Your files will be permanently deleted on 1 December 2026. Subscribe to keep them.',
    )
  })
  test('without a date it still tells the truth, never "undefined"/"Invalid Date"', () => {
    for (const v of [null, undefined, 'not-a-date']) {
      const copy = lapsedBannerCopy(v)
      expect(copy).toBe(
        'Your trial has ended and your vault is read-only. Your files will be permanently deleted unless you subscribe. Subscribe to keep them.',
      )
    }
  })
})

describe('uploadBlockedNotice — a clear message instead of a generic quota error', () => {
  test('lapsed → read-only notice pointing at paid checkout', () => {
    const n = uploadBlockedNotice('lapsed')
    expect(n).not.toBeNull()
    expect(n!.title).toBe('Your vault is read-only')
    expect(n!.description).toMatch(/trial has ended/i)
    expect(n!.href).toBe('/billing?view=change')
  })
  test('needs_plan → points at the plan chooser', () => {
    const n = uploadBlockedNotice('needs_plan')
    expect(n!.href).toBe('/choose-plan')
  })
  test('ok → no block', () => {
    expect(uploadBlockedNotice('ok')).toBeNull()
  })
})

describe('buildTrialPlanOptions — Starter / Basic / Pro only, never Free', () => {
  test('falls back to plan-constants with a 14-day trial when the API has not answered', () => {
    const opts = buildTrialPlanOptions(null)
    expect(opts.map((o) => o.id)).toEqual(['starter', 'basic', 'pro'])
    expect([...TRIAL_PLAN_SLUGS]).toEqual(['starter', 'basic', 'pro'])
    const basic = opts.find((o) => o.id === 'basic')!
    expect(basic.name).toBe('Basic')
    expect(basic.priceMonthly).toBe(3.99)
    expect(basic.priceYearly).toBe(39.9)
    expect(basic.storageLabel).toBe('200 GB')
    expect(basic.trialDays).toBe(DEFAULT_TRIAL_DAYS)
    expect(DEFAULT_TRIAL_DAYS).toBe(14)
  })
  test('API prices, storage label and trial_days win; free/business are dropped', () => {
    const api = [
      { id: 'free', name: 'Free', price_eur: 0, price_yearly_eur: 0, storage_bytes: 5e9, storage_label: '5 GB', per_seat: false, min_seats: 1, features: [] },
      { id: 'pro', name: 'Pro', price_eur: 11.49, price_yearly_eur: 114.9, storage_bytes: 1e12, storage_label: '1 TB', per_seat: false, min_seats: 1, features: [], trial_days: 30 },
      { id: 'business', name: 'Teams', price_eur: 54.95, price_yearly_eur: 549.5, storage_bytes: 5e12, storage_label: '5 TB', per_seat: false, min_seats: 1, features: [], coming_soon: true },
    ] as Plan[]
    const opts = buildTrialPlanOptions(api)
    expect(opts.map((o) => o.id)).toEqual(['starter', 'basic', 'pro'])
    const pro = opts.find((o) => o.id === 'pro')!
    expect(pro.priceMonthly).toBe(11.49)
    expect(pro.priceYearly).toBe(114.9)
    expect(pro.trialDays).toBe(30)
    // Starter was absent from the API → constants fallback.
    expect(opts.find((o) => o.id === 'starter')!.priceMonthly).toBe(1.99)
  })
  test('a non-positive trial_days from the API never renders a "0-day trial"', () => {
    const api = [
      { id: 'basic', name: 'Basic', price_eur: 3.99, price_yearly_eur: 39.9, storage_bytes: 2e11, storage_label: '200 GB', per_seat: false, min_seats: 1, features: [], trial_days: 0 },
    ] as Plan[]
    expect(buildTrialPlanOptions(api).find((o) => o.id === 'basic')!.trialDays).toBe(14)
  })
})

describe('trial copy', () => {
  test('terms line uses N and N+1', () => {
    expect(trialTermsCopy(14)).toBe(
      '14-day free trial. Card or iDEAL needed to start. No charge until day 15; cancel any time before.',
    )
    expect(trialTermsCopy(30)).toBe(
      '30-day free trial. Card or iDEAL needed to start. No charge until day 31; cancel any time before.',
    )
  })
  test('primary button label', () => {
    expect(startTrialLabel(14)).toBe('Start 14-day free trial')
  })
  test('payment methods: honest amounts', () => {
    expect(TRIAL_METHOD_COPY.creditcard).toEqual({ label: 'Card', detail: '€0 authorization, no charge today' })
    expect(TRIAL_METHOD_COPY.ideal).toEqual({ label: 'iDEAL', detail: '€0.01 verification, refunded' })
  })
  test('price label per cycle', () => {
    expect(trialPriceLabel(3.99, 'monthly')).toBe('€3.99/month')
    expect(trialPriceLabel(39.9, 'yearly')).toBe('€39.90/year')
    expect(trialPriceLabel(10, 'monthly')).toBe('€10/month')
  })
  test('auto-converting trial line on billing', () => {
    expect(trialAutoConvertCopy('2026-10-12T12:00:00Z', 3.99, 'monthly')).toBe(
      'Trial — ends 12 Oct 2026. Then €3.99/month, charged automatically.',
    )
    expect(trialAutoConvertCopy('2026-10-12T12:00:00Z', 39.9, 'yearly')).toBe(
      'Trial — ends 12 Oct 2026. Then €39.90/year, charged automatically.',
    )
  })
})

describe('choosePlanEntry — what /choose-plan does on arrival', () => {
  const base = { returned: false, fromBilling: false, subStatus: 'active', effectivePlan: 'free', hasUsedTrial: false }
  test('a Mollie return always reconciles first, whatever the state', () => {
    expect(choosePlanEntry({ ...base, accountState: 'needs_plan', returned: true })).toEqual({ kind: 'reconcile' })
    expect(choosePlanEntry({ ...base, accountState: 'ok', returned: true })).toEqual({ kind: 'reconcile' })
  })
  test('needs_plan → the picker', () => {
    expect(choosePlanEntry({ ...base, accountState: 'needs_plan' })).toEqual({ kind: 'pick' })
  })
  test('lapsed → normal paid checkout (the trial is used)', () => {
    expect(choosePlanEntry({ ...base, accountState: 'lapsed' })).toEqual({ kind: 'redirect', to: '/billing?view=change' })
  })
  test('ok (entitled, grandfathered Free, or an older server) → the drive', () => {
    expect(choosePlanEntry({ ...base, accountState: 'ok' })).toEqual({ kind: 'redirect', to: '/' })
    expect(choosePlanEntry({ ...base, accountState: 'ok', subStatus: 'trialing', effectivePlan: 'basic' })).toEqual({ kind: 'redirect', to: '/' })
  })
  test('ok + sent from billing by a trial-eligible Free account → the picker', () => {
    expect(choosePlanEntry({ ...base, accountState: 'ok', fromBilling: true })).toEqual({ kind: 'pick' })
  })
  test('ok + from billing but the trial is used or running → paid checkout on billing', () => {
    expect(choosePlanEntry({ ...base, accountState: 'ok', fromBilling: true, hasUsedTrial: true })).toEqual({ kind: 'redirect', to: '/billing?view=change' })
    expect(choosePlanEntry({ ...base, accountState: 'ok', fromBilling: true, subStatus: 'trialing', effectivePlan: 'pro' })).toEqual({ kind: 'redirect', to: '/billing?view=change' })
  })
})

describe('choosePlanPath', () => {
  test('carries plan + cycle, and the billing marker when asked', () => {
    expect(choosePlanPath({ plan: 'basic', cycle: 'yearly' })).toBe('/choose-plan?plan=basic&cycle=yearly')
    expect(choosePlanPath({ plan: 'pro', cycle: 'monthly' }, { fromBilling: true })).toBe(
      '/choose-plan?plan=pro&cycle=monthly&from=billing',
    )
    expect(choosePlanPath(null)).toBe('/choose-plan')
  })
})

describe('trialReturnOutcome — reconcile after Mollie sends the user back', () => {
  test('live once the subscription is trialing with account_state ok', () => {
    expect(trialReturnOutcome('paid', sub({ status: 'trialing', plan: 'basic', account_state: 'ok' }))).toBe('live')
    // The subscription is the truth even if the payment status call failed.
    expect(trialReturnOutcome(null, sub({ status: 'trialing', plan: 'basic', account_state: 'ok' }))).toBe('live')
    // Older server without account_state: trialing alone is enough.
    expect(trialReturnOutcome(null, sub({ status: 'trialing', plan: 'basic' }))).toBe('live')
  })
  test('still needs_plan while the webhook has not landed → pending, even if paid', () => {
    expect(trialReturnOutcome('paid', sub({ account_state: 'needs_plan' }))).toBe('pending')
    expect(trialReturnOutcome('open', sub({ account_state: 'needs_plan' }))).toBe('pending')
    expect(trialReturnOutcome('pending', null)).toBe('pending')
  })
  test('failed / canceled / expired mandate payment → failed (retry allowed)', () => {
    for (const s of ['failed', 'canceled', 'expired'] as const) {
      expect(trialReturnOutcome(s, sub({ account_state: 'needs_plan' }))).toBe('failed')
    }
  })
  test('a Free "active" row is not a live trial', () => {
    expect(trialReturnOutcome('paid', sub({ status: 'active', plan: 'free', account_state: 'ok' }))).toBe('pending')
  })
})

describe('resolveResumeAction — an abandoned TRIAL checkout resumes on the chooser, never as paid checkout', () => {
  test('kind trial', () => {
    expect(resolveResumeAction({ kind: 'trial', plan: 'basic', cycle: 'yearly' }, 'free')).toEqual({
      kind: 'trial',
      plan: 'basic',
      cycle: 'yearly',
    })
  })
  test('plan kinds unchanged', () => {
    expect(resolveResumeAction({ kind: 'plan', plan: 'pro', cycle: 'yearly' }, 'basic')).toEqual({
      kind: 'checkout',
      plan: 'pro',
      cycle: 'yearly',
    })
  })
})

describe('classifyTrialCheckoutError — where a failed POST /billing/trial/checkout sends the user', () => {
  test('409 trial_already_used → normal paid checkout', () => {
    expect(classifyTrialCheckoutError({ status: 409, code: 'trial_already_used', message: 'x' })).toBe('trial_used')
  })
  test('409 trial_has_active_subscription → the account already has a plan', () => {
    expect(classifyTrialCheckoutError({ status: 409, code: 'trial_has_active_subscription', message: 'x' })).toBe('has_plan')
  })
  test('400 billing_profile_required (code or message prefix, as /billing/checkout sends it) → collect the profile', () => {
    expect(classifyTrialCheckoutError({ status: 400, code: 'billing_profile_required', message: 'x' })).toBe('billing_profile')
    expect(
      classifyTrialCheckoutError({ status: 400, code: undefined, message: 'billing_profile_required: set your billing country first' }),
    ).toBe('billing_profile')
  })
  test('anything else is a plain error', () => {
    expect(classifyTrialCheckoutError({ status: 400, code: undefined, message: 'Mollie is not configured' })).toBe('error')
    expect(classifyTrialCheckoutError(new Error('network'))).toBe('error')
    expect(classifyTrialCheckoutError(null)).toBe('error')
  })
})

describe('plan_required / account_lapsed (409 from upload init + share creation — contract addition #2)', () => {
  test('accountStateFromError maps the two codes, nothing else', () => {
    expect(accountStateFromError(new ApiError('Choose a plan', 409, 'plan_required'))).toBe('needs_plan')
    expect(accountStateFromError(new ApiError('Lapsed', 409, 'account_lapsed'))).toBe('lapsed')
    expect(accountStateFromError(new ApiError('Storage full', 413, 'quota_exceeded'))).toBeNull()
    expect(accountStateFromError(new ApiError('Conflict', 409, 'name_conflict'))).toBeNull()
    expect(accountStateFromError(new Error('boom'))).toBeNull()
    expect(accountStateFromError(undefined)).toBeNull()
  })
  test('userFriendlyError never shows them as a generic conflict or quota error', () => {
    expect(userFriendlyError(new ApiError('x', 409, 'plan_required'))).toBe(
      'Choose a plan and start your free trial to upload or share files.',
    )
    expect(userFriendlyError(new ApiError('x', 409, 'account_lapsed'))).toBe(
      'Your trial has ended and your vault is read-only. Subscribe to upload or share again.',
    )
  })
})

describe('trialRenewalAmount — what an auto-converting trial will charge', () => {
  test('the Mollie amount on the row wins (authoritative, includes add-ons)', () => {
    expect(trialRenewalAmount(sub({ plan: 'basic', billing_cycle: 'monthly', mollie_amount_cents: 499 }), null)).toBe(4.99)
  })
  test('then the catalogue price for the cycle', () => {
    const plan = { id: 'basic', price_eur: 3.99, price_yearly_eur: 39.9 } as Plan
    expect(trialRenewalAmount(sub({ plan: 'basic', billing_cycle: 'yearly' }), plan)).toBe(39.9)
    expect(trialRenewalAmount(sub({ plan: 'basic', billing_cycle: 'monthly' }), plan)).toBe(3.99)
  })
  test('then plan-constants', () => {
    expect(trialRenewalAmount(sub({ plan: 'pro', billing_cycle: 'monthly' }), null)).toBe(10.99)
    expect(trialRenewalAmount(sub({ plan: 'starter', billing_cycle: 'yearly' }), null)).toBe(19.9)
  })
  test('unknown plan → null (the caller omits the amount rather than inventing one)', () => {
    expect(trialRenewalAmount(sub({ plan: 'mystery', billing_cycle: 'monthly' }), null)).toBeNull()
  })
})

describe('one trial per payment method — trial_block_reason (Guus, 2026-09-29)', () => {
  const blocked = (o: Partial<Subscription> = {}) =>
    sub({ account_state: 'needs_plan', trial_block_reason: 'payment_method_already_used', ...o })

  test('paid mandate + the reason → blocked: stop polling, offer paid checkout', () => {
    expect(trialReturnOutcome('paid', blocked())).toBe('blocked')
  })
  test('the reason is set by THIS attempt (cleared on every /trial/checkout), so a failed status call still reads blocked', () => {
    expect(trialReturnOutcome(null, blocked())).toBe('blocked')
    expect(trialReturnOutcome('pending', blocked())).toBe('blocked')
  })
  test('a failed/cancelled/expired payment is a failure, not a block (nothing was verified)', () => {
    expect(trialReturnOutcome('failed', blocked())).toBe('failed')
    expect(trialReturnOutcome('canceled', blocked())).toBe('failed')
    expect(trialReturnOutcome('expired', blocked())).toBe('failed')
  })
  test('null / absent reason keeps the normal outcomes', () => {
    expect(trialReturnOutcome('paid', sub({ account_state: 'needs_plan', trial_block_reason: null }))).toBe('pending')
    expect(trialReturnOutcome('paid', sub({ account_state: 'needs_plan' }))).toBe('pending')
  })
  test('a live trial wins over a stale reason (the server clears it on success anyway)', () => {
    expect(trialReturnOutcome('paid', sub({ status: 'trialing', plan: 'basic', account_state: 'ok', trial_block_reason: 'payment_method_already_used' }))).toBe('live')
  })
  test('trialBlockedCopy: the known reason gets the exact copy; unknown reasons stay honest; none → null', () => {
    expect(trialBlockedCopy('payment_method_already_used')).toBe(
      "This card or bank account has already been used for a free trial. You can subscribe now — you'll be charged today.",
    )
    expect(trialBlockedCopy('something_new')).toBe(
      "We couldn't start a free trial with this payment method. You can subscribe now — you'll be charged today.",
    )
    expect(trialBlockedCopy(null)).toBeNull()
    expect(trialBlockedCopy(undefined)).toBeNull()
    expect(trialBlockedCopy('')).toBeNull()
  })
  test('the paid-checkout return (/billing?upgraded=true → /settings/billing) stays open to a needs_plan account', () => {
    expect(planGateRedirect('/billing', 'needs_plan')).toBeNull()
    expect(planGateRedirect('/settings/billing', 'needs_plan')).toBeNull()
  })
})

describe('signup_web_only (403 from signup — defensive; the web IS the signup surface)', () => {
  test('mapped to a clear message, never "You don\'t have permission to do that."', () => {
    const msg = userFriendlyError(new ApiError('Create your account at https://app.beebeeb.io/signup, then sign in here.', 403, 'signup_web_only'))
    expect(msg).toBe('Accounts can only be created at app.beebeeb.io/signup. Open that page in your browser to continue.')
  })
})
