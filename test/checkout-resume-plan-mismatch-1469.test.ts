import { describe, expect, test } from 'bun:test'

/**
 * Task 1469 follow-up — Codex review on PR #54 (thread PRRT_kwDOSLX6Nc6k2gf2,
 * src/pages/pricing.tsx:130). The checkout watchdog's "Continue" button in
 * billing.tsx called `handleSwitchBillingCycle(pendingCheckout.cycle)`
 * unconditionally and never read `pendingCheckout.plan`. Resuming an
 * abandoned Starter/Pro PURCHASE (a saved plan that differs from the
 * subscription's CURRENT plan) switched the billing cycle of whatever plan
 * the user is already on — or failed outright when the current plan is
 * free, which has no cycle to switch — instead of recreating checkout for
 * the saved tier.
 *
 * `resolveResumeAction` is the pure decision extracted out of that handler
 * (Continue is not unit-testable without rendering all of billing.tsx) so
 * the plan-vs-cycle-switch branch can be asserted directly. The handler in
 * billing.tsx is wired through it.
 */
const { resolveResumeAction } = await import('../src/lib/pending-checkout')

describe('resolveResumeAction (task 1469 fix — Codex PR #54 review)', () => {
  test('a saved plan that differs from the current plan resumes as a CHECKOUT for the saved plan+cycle, not a cycle switch', () => {
    const action = resolveResumeAction({ plan: 'pro', cycle: 'yearly' }, 'basic')
    expect(action).toEqual({ kind: 'checkout', plan: 'pro', cycle: 'yearly' })
  })

  test('a saved plan matching the current plan resumes as an in-place cycle switch', () => {
    const action = resolveResumeAction({ plan: 'basic', cycle: 'yearly' }, 'basic')
    expect(action).toEqual({ kind: 'switch-cycle', cycle: 'yearly' })
  })

  test('a saved plan target while the current plan is free (no cycle to switch) resumes as a checkout, never a failing cycle switch', () => {
    const action = resolveResumeAction({ plan: 'starter', cycle: 'monthly' }, 'free')
    expect(action).toEqual({ kind: 'checkout', plan: 'starter', cycle: 'monthly' })
  })
})
