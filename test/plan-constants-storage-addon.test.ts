import { describe, expect, test } from 'bun:test'
import {
  STORAGE_ADDON_EUR_PER_TB,
  PLAN_META,
  PRICING_PAGE_PLANS,
} from '../src/lib/plan-constants'

// Task 1607 (Guus ruling, 2026-09-29): reverses task 1463's 2026-09-22 raise —
// the per-TB storage add-on for Pro and Teams moves back from €14.99/TB to
// €10.99/TB. Pro's base price (1 TB included) stays €10.99/mo — only the
// marginal per-TB add-on rate changes (back to matching the base rate).
describe('storage add-on rate — task 1607 (€14.99/TB → €10.99/TB)', () => {
  test('STORAGE_ADDON_EUR_PER_TB is 10.99', () => {
    expect(STORAGE_ADDON_EUR_PER_TB).toBe(10.99)
  })

  test('Pro base price is UNCHANGED at €10.99/mo', () => {
    expect(PLAN_META.pro.priceMonthly).toBe(10.99)
  })

  test('Pro features list the reverted €10.99/TB add-on copy', () => {
    expect(PLAN_META.pro.features.some((f) => f.includes('€10.99/TB'))).toBe(true)
    expect(PLAN_META.pro.features.some((f) => f.includes('€14.99/TB'))).toBe(false)
  })

  test('Teams (business) features list the reverted €10.99/TB add-on copy', () => {
    expect(PLAN_META.business.features.some((f) => f.includes('€10.99/TB'))).toBe(true)
    expect(PLAN_META.business.features.some((f) => f.includes('€14.99/TB'))).toBe(false)
  })

  test('pricing page Pro card note/perTb/feature strings use €10.99/TB', () => {
    const pro = PRICING_PAGE_PLANS.find((p) => p.id === 'pro')!
    expect(pro.note).toContain('€10.99/TB')
    expect(pro.perTb).toBe('+€10.99/TB')
    expect(pro.features.some((f) => f.label.includes('€10.99/TB'))).toBe(true)
  })

  test('pricing page Teams card perTb string uses €10.99/TB', () => {
    const teams = PRICING_PAGE_PLANS.find((p) => p.id === 'business')!
    expect(teams.perTb).toBe('+€10.99/TB')
    expect(teams.features.some((f) => f.label.includes('€10.99/TB'))).toBe(true)
  })
})
