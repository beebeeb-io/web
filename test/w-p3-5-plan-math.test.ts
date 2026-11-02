// W-P3-5: every plan fact (quota, price, add-on rate, extra-TB ceiling) comes
// from core's `beebeeb_types::quota` through wasm. This vector pins the plan
// math and the display mirror in `plan-constants.ts` to core's table, so a
// drift between the mirror and what Mollie charges fails here.
import { describe, expect, it } from 'bun:test'
import {
  ensureWasm,
  formatStorageSI,
  planBaseTB,
  planCanAddStorage,
  planEffectiveQuota,
  planMaxExtraTB,
  planMonthlyCostCents,
} from '../src/lib/plan-pricing'
import { PLAN_META, STORAGE_ADDON_EUR_PER_TB, USER_ADDON_EUR_PER_SEAT } from '../src/lib/plan-constants'

const ONE_TB = 1_000_000_000_000

/** core `Plan::from_slug` + `base_storage_bytes()` @ 3d2fd6d. */
const CORE_PLANS = [
  { slug: 'free', bytes: 5_000_000_000, cents: 0, addStorage: false, maxExtraTB: 0 },
  { slug: 'starter', bytes: 100_000_000_000, cents: 199, addStorage: false, maxExtraTB: 0 },
  { slug: 'basic', bytes: 200_000_000_000, cents: 399, addStorage: false, maxExtraTB: 0 },
  { slug: 'personal', bytes: 200_000_000_000, cents: 399, addStorage: false, maxExtraTB: 0 },
  { slug: 'pro', bytes: ONE_TB, cents: 1099, addStorage: true, maxExtraTB: 98 },
  { slug: 'business', bytes: 5 * ONE_TB, cents: 5495, addStorage: true, maxExtraTB: 94 },
  { slug: 'data_hoarder', bytes: 5 * ONE_TB, cents: 5495, addStorage: true, maxExtraTB: 94 },
] as const

describe('W-P3-5 plan math from core', () => {
  it('quota, price and add-on ceilings are core quota.rs values', async () => {
    await ensureWasm()
    for (const plan of CORE_PLANS) {
      expect(planBaseTB(plan.slug) * ONE_TB, plan.slug).toBe(plan.bytes)
      expect(planMonthlyCostCents(plan.slug, 0), plan.slug).toBe(plan.cents)
      expect(planCanAddStorage(plan.slug), plan.slug).toBe(plan.addStorage)
      expect(planMaxExtraTB(plan.slug), plan.slug).toBe(plan.maxExtraTB)
      expect(planEffectiveQuota(plan.slug, 0, 0), plan.slug).toBe(plan.bytes)
    }
    // An extra TB is the flat add-on rate, and the quota grows by exactly 1 TB.
    expect(planMonthlyCostCents('pro', 1) - planMonthlyCostCents('pro', 0)).toBe(1099)
    expect(planMonthlyCostCents('business', 3) - planMonthlyCostCents('business', 0)).toBe(3 * 1099)
    expect(planEffectiveQuota('business', 3, 0)).toBe(8 * ONE_TB)
    // A seat beyond the two Business includes is core's USER_ADDON_CENTS.
    expect(planMonthlyCostCents('business', 0, 1) - planMonthlyCostCents('business', 0, 0)).toBe(499)
    // A bonus (referral) is added on top of base + extra.
    expect(planEffectiveQuota('pro', 2, 5_000_000_000)).toBe(3 * ONE_TB + 5_000_000_000)
    // Unknown slugs are core's Free plan, never a crash or NaN.
    expect(planBaseTB('nonsense') * ONE_TB).toBe(5_000_000_000)
    expect(planMonthlyCostCents('nonsense', 0)).toBe(0)
  })

  it('the display mirror in plan-constants matches core', async () => {
    await ensureWasm()
    for (const plan of CORE_PLANS) {
      const meta = PLAN_META[plan.slug]
      expect(meta.priceMonthly * 100, plan.slug).toBe(plan.cents)
      expect(meta.storageGB * 1_000_000_000, plan.slug).toBe(plan.bytes)
      // Yearly is a display copy of the same monthly rate: ten months' worth
      // (core has no yearly rule, so this stays local and is pinned here).
      expect(meta.priceYearly, plan.slug).toBeCloseTo(meta.priceMonthly * 10, 2)
    }
    expect(Math.round(STORAGE_ADDON_EUR_PER_TB * 100)).toBe(
      planMonthlyCostCents('pro', 1) - planMonthlyCostCents('pro', 0),
    )
    expect(Math.round(USER_ADDON_EUR_PER_SEAT * 100)).toBe(
      planMonthlyCostCents('business', 0, 1) - planMonthlyCostCents('business', 0, 0),
    )
  })

  it('byte formatting of plan quotas is core format_si', async () => {
    await ensureWasm()
    expect(formatStorageSI(5_000_000_000)).toBe('5 GB')
    expect(formatStorageSI(100_000_000_000)).toBe('100 GB')
    expect(formatStorageSI(200_000_000_000)).toBe('200 GB')
    expect(formatStorageSI(ONE_TB)).toBe('1.0 TB')
    expect(formatStorageSI(5 * ONE_TB)).toBe('5.0 TB')
    expect(formatStorageSI(1_500_000_000)).toBe('1 GB')
    expect(formatStorageSI(-1)).toBe('—')
  })
})
