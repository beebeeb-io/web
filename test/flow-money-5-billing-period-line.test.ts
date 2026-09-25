/**
 * Flow-money #5 (P2): the billing page rendered "Renews <date>" for a no-card
 * trial. A Pattern-B trial does not renew — it drops to Free on
 * trial_ends_at (server trial.rs sets current_period_end == trial_ends_at).
 * Rules mirror mobile's billingStatusView (repos/mobile/src/lib/billing-status.ts)
 * and the CLI (billing.rs) so every client says the same thing for the same
 * account.
 */
import { describe, expect, test } from 'bun:test'
import { billingPeriodLine } from '../src/lib/billing-period-line'

const TRIAL_END = '2026-10-09T00:00:00Z'
const PERIOD_END = '2026-11-01T00:00:00Z'

describe('billingPeriodLine', () => {
  test('trialing (server shape: current_period_end == trial_ends_at) → "Trial ends", never "Renews"', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'trialing',
      current_period_end: TRIAL_END,
      trial_ends_at: TRIAL_END,
    })
    expect(line).toEqual({ label: 'Trial ends', dateIso: TRIAL_END })
  })

  test('trialing prefers trial_ends_at over current_period_end', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'trialing',
      current_period_end: PERIOD_END,
      trial_ends_at: TRIAL_END,
    })
    expect(line).toEqual({ label: 'Trial ends', dateIso: TRIAL_END })
  })

  test('trialing without trial_ends_at falls back to current_period_end', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'trialing',
      current_period_end: TRIAL_END,
      trial_ends_at: null,
    })
    expect(line).toEqual({ label: 'Trial ends', dateIso: TRIAL_END })
  })

  test('cancelling → "Access until" current_period_end (the plan lapses, it does not renew)', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'cancelling',
      current_period_end: PERIOD_END,
    })
    expect(line).toEqual({ label: 'Access until', dateIso: PERIOD_END })
  })

  test('active paid plan → "Renews"', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'active',
      current_period_end: PERIOD_END,
    })
    expect(line).toEqual({ label: 'Renews', dateIso: PERIOD_END })
  })

  test('paused → no period line (the paused panel owns the copy)', () => {
    expect(
      billingPeriodLine({ plan: 'pro', status: 'paused', current_period_end: PERIOD_END }),
    ).toBeNull()
  })

  test('free plan → no period line, whatever the status', () => {
    expect(
      billingPeriodLine({ plan: 'free', status: 'trialing', current_period_end: TRIAL_END, trial_ends_at: TRIAL_END }),
    ).toBeNull()
    expect(billingPeriodLine({ plan: 'free', status: 'active', current_period_end: PERIOD_END })).toBeNull()
  })

  test('no date → no period line', () => {
    expect(billingPeriodLine({ plan: 'pro', status: 'active', current_period_end: null })).toBeNull()
    expect(billingPeriodLine(null)).toBeNull()
  })
})
