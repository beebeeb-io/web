/**
 * Task 2106 — held-trial banner logic and the `?confirm_payment=` query param.
 */
import { describe, expect, test } from 'bun:test'
import {
  confirmPaymentBy,
  confirmPaymentBannerCopy,
  confirmPaymentIntent,
  formatConfirmDate,
  CONFIRM_PAYMENT_TRIAL_PATH,
} from '../src/lib/confirm-payment'
import { billingPeriodLine } from '../src/lib/billing-period-line'
import { trialAutoConvertCopy } from '../src/lib/trial-checkout'

const HELD = '2026-10-25T22:59:59Z' // 23:59:59 on 25 Oct in Amsterdam (CET, UTC+1)

describe('confirmPaymentBy', () => {
  test('a trialing row with confirm_payment_by is held, even though trial_auto_converts is true', () => {
    expect(confirmPaymentBy({ status: 'trialing', confirm_payment_by: HELD })).toBe(HELD)
  })
  test('null / absent / empty / garbage / non-trialing -> not held', () => {
    expect(confirmPaymentBy({ status: 'trialing', confirm_payment_by: null })).toBeNull()
    expect(confirmPaymentBy({ status: 'trialing' })).toBeNull()
    expect(confirmPaymentBy({ status: 'trialing', confirm_payment_by: '' })).toBeNull()
    expect(confirmPaymentBy({ status: 'trialing', confirm_payment_by: 'soon' })).toBeNull()
    expect(confirmPaymentBy({ status: 'active', confirm_payment_by: HELD })).toBeNull()
    expect(confirmPaymentBy(null)).toBeNull()
  })
})

describe('confirmPaymentBannerCopy', () => {
  test('says what the bank asks, by when, and never "charged automatically"', () => {
    const copy = confirmPaymentBannerCopy('2026-10-25T22:59:59Z', 'en-GB')
    expect(copy).toBe('Your bank asks you to confirm your first payment. Confirm by 25 October 2026, or your trial ends then.')
    expect(copy.toLowerCase()).not.toContain('charged automatically')
  })
  test('the date follows the viewer locale and the Amsterdam day', () => {
    expect(formatConfirmDate('2026-10-25T22:59:59Z', 'nl-NL')).toBe('25 oktober 2026')
    // 22:59:59Z is already the next day in a UTC+11 viewer's zone; the mail names 25 Oct.
    expect(formatConfirmDate('2026-10-25T22:59:59Z', 'en-GB')).toContain('25')
  })
  test('the normal mandated-trial copy is unchanged', () => {
    expect(trialAutoConvertCopy('2026-10-13T00:00:00Z', 4.99, 'monthly')).toContain('charged automatically')
  })
})

describe('confirmPaymentIntent', () => {
  test('1 -> pay-overdue, trial -> pay-now, anything else -> none', () => {
    expect(confirmPaymentIntent('1')).toBe('overdue')
    expect(confirmPaymentIntent('trial')).toBe('trial')
    expect(confirmPaymentIntent('0')).toBeNull()
    expect(confirmPaymentIntent('')).toBeNull()
    expect(confirmPaymentIntent(null)).toBeNull()
    expect(confirmPaymentIntent(undefined)).toBeNull()
  })
  test('the shell banner links to the billing route that starts pay-now', () => {
    expect(CONFIRM_PAYMENT_TRIAL_PATH).toBe('/settings/billing?confirm_payment=trial')
  })
})

describe('billingPeriodLine on a held trial', () => {
  const base = { plan: 'basic', status: 'trialing', trial_ends_at: HELD, trial_auto_converts: true }
  test('a held trial does not say "first charge on"', () => {
    expect(billingPeriodLine({ ...base, confirm_payment_by: HELD })).toEqual({ label: 'Trial ends', dateIso: HELD })
  })
  test('a normal mandated trial keeps "first charge on"', () => {
    expect(billingPeriodLine({ ...base, confirm_payment_by: null })?.label).toBe('Trial · first charge on')
  })
})
