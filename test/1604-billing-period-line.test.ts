/**
 * Task 1604 — extends flow-money #5's billingPeriodLine (test/flow-money-5-
 * billing-period-line.test.ts) for the trial shapes server #125/#128
 * introduced: a `trialing` row can now be a MANDATED trial
 * (`trial_auto_converts: true`, charges automatically at `trial_ends_at`) or
 * the legacy no-card trial (drops to Free instead). Same status, opposite
 * outcome, so the label must differ. A `cancelling` row also gets a second
 * "Files deleted on" line once the server has set `data_deletion_at`.
 */
import { describe, expect, test } from 'bun:test'
import { billingPeriodLine } from '../src/lib/billing-period-line'

const TRIAL_END = '2026-10-09T00:00:00Z'
const PERIOD_END = '2026-11-01T00:00:00Z'
const DELETION_AT = '2026-11-15T00:00:00Z'

describe('billingPeriodLine — task 1604 trial_auto_converts + data_deletion_at', () => {
  test('mandated trial (trial_auto_converts: true) → "Trial · first charge on", never "Trial ends"', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'trialing',
      trial_auto_converts: true,
      current_period_end: TRIAL_END,
      trial_ends_at: TRIAL_END,
    })
    expect(line).toEqual({ label: 'Trial · first charge on', dateIso: TRIAL_END })
  })

  test('no-card trial (trial_auto_converts: false) → "Trial ends", same as before #125', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'trialing',
      trial_auto_converts: false,
      current_period_end: TRIAL_END,
      trial_ends_at: TRIAL_END,
    })
    expect(line).toEqual({ label: 'Trial ends', dateIso: TRIAL_END })
  })

  test('trial_auto_converts absent (older server / pre-#125 fixture) → treated as no-card, "Trial ends"', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'trialing',
      current_period_end: TRIAL_END,
      trial_ends_at: TRIAL_END,
    })
    expect(line).toEqual({ label: 'Trial ends', dateIso: TRIAL_END })
  })

  test('mandated trial still prefers trial_ends_at over current_period_end for the date', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'trialing',
      trial_auto_converts: true,
      current_period_end: PERIOD_END,
      trial_ends_at: TRIAL_END,
    })
    expect(line).toEqual({ label: 'Trial · first charge on', dateIso: TRIAL_END })
  })

  test('cancelling with data_deletion_at set → "Access until" plus an extra "Files deleted on" line', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'cancelling',
      current_period_end: PERIOD_END,
      data_deletion_at: DELETION_AT,
    })
    expect(line).toEqual({
      label: 'Access until',
      dateIso: PERIOD_END,
      extra: { text: 'Files deleted on', dateIso: DELETION_AT },
    })
  })

  test('cancelling WITHOUT data_deletion_at → "Access until", no extra line (unchanged from flow-money #5)', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'cancelling',
      current_period_end: PERIOD_END,
    })
    expect(line).toEqual({ label: 'Access until', dateIso: PERIOD_END })
    expect(line?.extra).toBeUndefined()
  })

  test('a trialing row never gets the deletion extra line, even if data_deletion_at happens to be set', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'trialing',
      trial_auto_converts: false,
      current_period_end: TRIAL_END,
      trial_ends_at: TRIAL_END,
      data_deletion_at: DELETION_AT,
    })
    expect(line?.extra).toBeUndefined()
  })

  test('active paid plan is unaffected by trial_auto_converts / data_deletion_at — still "Renews", no extra', () => {
    const line = billingPeriodLine({
      plan: 'pro',
      status: 'active',
      trial_auto_converts: false,
      current_period_end: PERIOD_END,
      data_deletion_at: DELETION_AT,
    })
    expect(line).toEqual({ label: 'Renews', dateIso: PERIOD_END })
  })
})
