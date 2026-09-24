import { describe, expect, test } from 'bun:test'
import { isTrialEligible, resolveHasUsedTrial } from '../src/lib/trial-eligibility'

/**
 * Task 1517 — the CTA decision. Before this fix, `billing.tsx` gated every
 * trial CTA (the "Start 14-day trial" buttons AND the Compare-plans table's
 * "Upgrade" buttons, via `handleUpgradeOrTrial`) on a local `trialUsed` React
 * state that starts `false` and is set only after a LIVE 409 this session —
 * so an account that had already used its trial in a past session (Guus's,
 * on prod: trial used in July) always saw the trial CTA and always attempted
 * `startTrial()` first, discovering ineligibility only from the 409.
 *
 * `resolveHasUsedTrial` + `isTrialEligible` (src/lib/trial-eligibility.ts)
 * are the extracted, pure decision `billing.tsx` now calls. This suite
 * exercises them directly — no React, no rendering (this repo's `bun test`
 * harness has no @testing-library/react / jsdom, per
 * test/1471-isloggedin-auth-context.test.ts's header comment).
 */

describe('resolveHasUsedTrial()', () => {
  test('true when the server subscription says has_used_trial: true, no local flag needed', () => {
    expect(resolveHasUsedTrial(true, false)).toBe(true)
  })

  test('true when only the local optimistic flag is set (same-session 409, sub not yet re-fetched)', () => {
    expect(resolveHasUsedTrial(false, true)).toBe(true)
    expect(resolveHasUsedTrial(undefined, true)).toBe(true)
  })

  test('false when neither signal says the trial was used', () => {
    expect(resolveHasUsedTrial(false, false)).toBe(false)
  })

  test('an older server response missing the field (undefined) does not itself block trial CTAs', () => {
    expect(resolveHasUsedTrial(undefined, false)).toBe(false)
  })
})

describe('isTrialEligible() — the CTA decision', () => {
  test('has_used_trial: true → NOT eligible, even on Free with no active trial (the reported bug)', () => {
    const hasUsedTrial = resolveHasUsedTrial(true, false)
    expect(
      isTrialEligible({
        effectivePlan: 'free',
        subStatus: 'active',
        hasUsedTrial,
        targetComingSoon: false,
      }),
    ).toBe(false)
  })

  test('has_used_trial: false, Free plan, no active trial → eligible (normal first-trial case)', () => {
    const hasUsedTrial = resolveHasUsedTrial(false, false)
    expect(
      isTrialEligible({
        effectivePlan: 'free',
        subStatus: 'active',
        hasUsedTrial,
        targetComingSoon: false,
      }),
    ).toBe(true)
  })

  test('already trialing → NOT eligible for a NEW trial regardless of has_used_trial', () => {
    expect(
      isTrialEligible({
        effectivePlan: 'basic',
        subStatus: 'trialing',
        hasUsedTrial: false,
        targetComingSoon: false,
      }),
    ).toBe(false)
  })

  test('not on the Free plan → NOT eligible (a paying customer never sees a trial CTA)', () => {
    expect(
      isTrialEligible({
        effectivePlan: 'pro',
        subStatus: 'active',
        hasUsedTrial: false,
        targetComingSoon: false,
      }),
    ).toBe(false)
  })

  test('target plan is coming-soon (Teams) → NOT eligible even with an unused trial', () => {
    expect(
      isTrialEligible({
        effectivePlan: 'free',
        subStatus: 'active',
        hasUsedTrial: false,
        targetComingSoon: true,
      }),
    ).toBe(false)
  })

  test('the exact reported scenario: Free plan, has_used_trial true, clicking compare-table Upgrade routes to paid checkout, never startTrial()', () => {
    // Mirrors handleUpgradeOrTrial's call shape in billing.tsx.
    const hasUsedTrial = resolveHasUsedTrial(true, false)
    const eligibleForTrial = isTrialEligible({
      effectivePlan: 'free',
      subStatus: 'active',
      hasUsedTrial,
      targetComingSoon: false,
    })
    // false means the caller falls through to openUpgrade(plan) — the paid
    // checkout dialog — instead of calling handleStartTrial(plan).
    expect(eligibleForTrial).toBe(false)
  })
})
