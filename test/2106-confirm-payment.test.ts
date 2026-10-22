/**
 * Task 2106 — held-trial banner logic and the `?confirm_payment=` query param.
 */
import { describe, expect, test } from 'bun:test'
import {
  confirmPaymentBy,
  confirmPaymentBannerCopy,
  confirmPaymentIntent,
  formatConfirmDate,
  chargesAutomatically,
  CONFIRM_PAYMENT_TRIAL_PATH,
} from '../src/lib/confirm-payment'
import { sanitizeRedirect } from '../src/lib/safe-redirect'
import { trialCycleSwitchNoteFor, trialCycleSwitchToastFor } from '../src/lib/cycle-switch-copy'
import { billingPeriodLine } from '../src/lib/billing-period-line'
import { routePayNowResult } from '../src/lib/trial-pay-now'
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
    const copy = confirmPaymentBannerCopy('2026-10-25T22:59:59Z')
    expect(copy).toBe('Your bank asks you to confirm your first payment. Confirm by 25 Oct 2026, or your trial ends then.')
    expect(copy.toLowerCase()).not.toContain('charged automatically')
  })
  test('the normal mandated-trial copy is unchanged', () => {
    expect(trialAutoConvertCopy('2026-10-13T00:00:00Z', 4.99, 'monthly')).toContain('charged automatically')
  })
})

describe('formatConfirmDate: the Amsterdam day, en-GB like the rest of the page and the mail', () => {
  test('23:59:59 Amsterdam in summer (CEST) and winter (CET) is that same day', () => {
    expect(formatConfirmDate('2026-07-14T21:59:59Z')).toBe('14 Jul 2026') // CEST, UTC+2
    expect(formatConfirmDate('2026-12-14T22:59:59Z')).toBe('14 Dec 2026') // CET, UTC+1
  })
  test('the DST end day 2026-10-25 (clocks back at 03:00): 23:59:59 is 22:59:59Z', () => {
    expect(formatConfirmDate('2026-10-25T22:59:59Z')).toBe('25 Oct 2026')
    // one hour earlier is 22:59:59 Amsterdam, still the 25th; one second later is the 26th
    expect(formatConfirmDate('2026-10-25T21:59:59Z')).toBe('25 Oct 2026')
    expect(formatConfirmDate('2026-10-25T23:00:00Z')).toBe('26 Oct 2026')
  })
  test('the viewer timezone does not move the day (run under three TZ values)', () => {
    for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      const r = Bun.spawnSync({
        cmd: ['bun', '-e', "import { formatConfirmDate } from './src/lib/confirm-payment'; console.log(formatConfirmDate('2026-10-25T22:59:59Z'))"],
        env: { ...process.env, TZ: tz },
        cwd: `${import.meta.dir}/..`,
      })
      expect([tz, r.stdout.toString().trim()]).toEqual([tz, '25 Oct 2026'])
    }
  })
})

describe('chargesAutomatically: one predicate for every automatic-charge promise', () => {
  const mandated = { status: 'trialing', trial_auto_converts: true }
  test('a mandated trial charges automatically; held, no-card, and non-trial rows do not', () => {
    expect(chargesAutomatically({ ...mandated, confirm_payment_by: null })).toBe(true)
    expect(chargesAutomatically({ ...mandated, confirm_payment_by: HELD })).toBe(false)
    expect(chargesAutomatically({ status: 'trialing', trial_auto_converts: false })).toBe(false)
    expect(chargesAutomatically({ status: 'active', trial_auto_converts: true })).toBe(false)
    expect(chargesAutomatically(null)).toBe(false)
  })
})

describe('the cycle-switch copy for a held trial', () => {
  const held = { status: 'trialing', trial_auto_converts: true, confirm_payment_by: HELD }
  const normal = { status: 'trialing', trial_auto_converts: true, confirm_payment_by: null }
  test('a held trial promises no first charge', () => {
    const note = trialCycleSwitchNoteFor(held, 'yearly', '25 Oct 2026', 'EUR 39.90/year')
    const toast = trialCycleSwitchToastFor(held, 'yearly', '25 Oct 2026', 'EUR 39.90/year')
    for (const t of [note, toast]) {
      expect(t.toLowerCase()).not.toContain('first charge')
      expect(t).toContain('25 Oct 2026')
      expect(t).toContain('confirm')
    }
  })
  test('a normal mandated trial keeps its copy', () => {
    expect(trialCycleSwitchNoteFor(normal, 'yearly', '25 Oct 2026', 'EUR 39.90/year')).toContain('Your first charge of EUR 39.90/year is on 25 Oct 2026')
    expect(trialCycleSwitchToastFor(normal, 'yearly', '25 Oct 2026', 'EUR 39.90/year')).toContain('first charge')
  })
})

describe('sign-in bounce keeps exactly the confirm_payment intent on /settings/billing', () => {
  test('1 and trial survive', () => {
    expect(sanitizeRedirect('/settings/billing?confirm_payment=1')).toBe('/settings/billing?confirm_payment=1')
    expect(sanitizeRedirect('/settings/billing?confirm_payment=trial')).toBe('/settings/billing?confirm_payment=trial')
  })
  test('anything else is stripped, including a forged checkout-return flag riding along', () => {
    expect(sanitizeRedirect('/settings/billing?confirm_payment=2')).toBe('/settings/billing')
    expect(sanitizeRedirect('/settings/billing?confirm_payment=')).toBe('/settings/billing')
    expect(sanitizeRedirect('/settings/billing?confirm_payment=1&success=true')).toBe('/settings/billing')
    expect(sanitizeRedirect('/settings/billing?success=true&confirm_payment=1')).toBe('/settings/billing')
    expect(sanitizeRedirect('/settings/billing?confirm_payment=trial%0a')).toBe('/settings/billing')
    expect(sanitizeRedirect('/settings/privacy?confirm_payment=1')).toBe('/settings/privacy?confirm_payment=1') // other paths unchanged
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

describe('routePayNowResult and the debug mock checkout (http://localhost)', () => {
  const local = { payment_id: 'tr_9', status: 'open', checkout_url: 'http://localhost:3003/dev/mock-mollie/checkout/tr_9' }
  test('refused by default (production behaviour unchanged)', () => {
    expect(routePayNowResult(local).kind).toBe('inline')
  })
  test('followed only with the dev opt-in, and only for loopback hosts', () => {
    expect(routePayNowResult(local, { allowLocalHttp: true }).kind).toBe('redirect')
    expect(routePayNowResult({ ...local, checkout_url: 'http://evil.example/x' }, { allowLocalHttp: true }).kind).toBe('inline')
    expect(routePayNowResult({ ...local, checkout_url: 'http://localhost.evil.example/x' }, { allowLocalHttp: true }).kind).toBe('inline')
  })
})
