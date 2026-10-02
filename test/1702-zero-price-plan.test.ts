import { describe, expect, test } from 'bun:test'
import type { Plan } from '@beebeeb/shared'
import {
  buildTrialPlanOptions,
  isZeroPriceForCycle,
  trialRenewalAmount,
  formatEur,
  trialPriceLabel,
} from '../src/lib/trial-checkout'

/**
 * Task 1702 + 1701 — a plan priced €0 must render as €0 everywhere and take
 * the direct-activation checkout flow. The old `> 0` guards substituted the
 * static 1.99/19.90 constants whenever the API returned €0, so the owner's
 * stored price never reached the pricing/checkout surfaces and testers were
 * sent into a payment flow that then failed on the zero amount.
 *
 * Pure functions only (the repo's bun harness has no jsdom) — the pages call
 * these helpers with the API plans row / subscription.
 */

function apiPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'starter',
    name: 'Starter',
    price_eur: 0,
    price_yearly_eur: 0,
    storage_bytes: 100_000_000_000,
    storage_label: '100 GB',
    per_seat: false,
    min_seats: 1,
    features: [],
    purchasable: true,
    ...overrides,
  }
}

describe('buildTrialPlanOptions — stored price passes through (1701)', () => {
  test('a €0 API plan renders €0 on both cycles — never the static 1.99', () => {
    const [starter] = buildTrialPlanOptions([apiPlan()])
    expect(starter.id).toBe('starter')
    expect(starter.priceMonthly).toBe(0)
    expect(starter.priceYearly).toBe(0)
  })

  test('a paid API plan still renders its stored price', () => {
    const [starter] = buildTrialPlanOptions([apiPlan({ price_eur: 1.99, price_yearly_eur: 19.9 })])
    expect(starter.priceMonthly).toBe(1.99)
    expect(starter.priceYearly).toBe(19.9)
  })

  test('a plan missing from the API response falls back to the static constants', () => {
    const [starter] = buildTrialPlanOptions([apiPlan({ id: 'basic' })])
    expect(starter.priceMonthly).toBe(1.99)
    expect(starter.priceYearly).toBe(19.9)
  })
})

describe('isZeroPriceForCycle (1702 flow gate)', () => {
  test('monthly €0 on the monthly cycle', () => {
    expect(isZeroPriceForCycle(0, 19.9, 'monthly')).toBe(true)
  })
  test('yearly €0 on the yearly cycle', () => {
    expect(isZeroPriceForCycle(1.99, 0, 'yearly')).toBe(true)
  })
  test('non-zero prices are not the zero-price flow', () => {
    expect(isZeroPriceForCycle(1.99, 19.9, 'monthly')).toBe(false)
    expect(isZeroPriceForCycle(1.99, 19.9, 'yearly')).toBe(false)
    expect(isZeroPriceForCycle(0, 19.9, 'yearly')).toBe(false)
    expect(isZeroPriceForCycle(1.99, 0, 'monthly')).toBe(false)
  })
})

describe('trialRenewalAmount — €0 renewal is €0, not a substitute (1701)', () => {
  const euroZeroPlan = apiPlan()

  test('an API-priced €0 plan renews at €0 on both cycles', () => {
    expect(
      trialRenewalAmount({ plan: 'starter', billing_cycle: 'monthly', mollie_amount_cents: null }, euroZeroPlan),
    ).toBe(0)
    expect(
      trialRenewalAmount({ plan: 'starter', billing_cycle: 'yearly', mollie_amount_cents: null }, euroZeroPlan),
    ).toBe(0)
  })

  test('mollie_amount_cents (what Mollie actually charges) still wins when present', () => {
    expect(
      trialRenewalAmount(
        { plan: 'starter', billing_cycle: 'monthly', mollie_amount_cents: 199 },
        euroZeroPlan,
      ),
    ).toBe(1.99)
  })

  test('without an API row, the static fallback keeps its >0 guard (price unknowable)', () => {
    expect(trialRenewalAmount({ plan: 'free', billing_cycle: 'monthly', mollie_amount_cents: null }, null)).toBeNull()
    expect(
      trialRenewalAmount(
        { plan: 'basic', billing_cycle: 'monthly', mollie_amount_cents: null },
        apiPlan({ id: 'pro' }),
      ),
    ).toBe(3.99)
  })
})

describe('€0 renders honestly', () => {
  test('formatEur and trialPriceLabel show a real zero', () => {
    expect(formatEur(0)).toBe('€0')
    expect(trialPriceLabel(0, 'monthly')).toBe('€0/month')
    expect(trialPriceLabel(0, 'yearly')).toBe('€0/year')
  })
})