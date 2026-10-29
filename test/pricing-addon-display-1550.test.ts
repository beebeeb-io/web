import { describe, expect, test } from 'bun:test'
import { deriveAddonAwarePriceDisplay } from '../src/lib/plan-pricing'

// Task 1550 (regression re-guarded task 1607, PR #127 Codex P2): the pricing
// page's Pro card must show the REAL marginal per-TB add-on rate in its
// note/perTb fields, never `price_eur / tbCount` — the base plan's own unit
// economics. Since task 1607 made Pro's add-on rate (€10.99) equal its
// base-price/base-TB quotient (10.99 / 1 = 10.99), the real fixture can no
// longer distinguish the two formulas; this test proves the FORMULA itself
// is right by injecting an `addonRate` whose value differs from the
// quotient the old buggy code would have computed.
describe('deriveAddonAwarePriceDisplay — task 1550 regression (price_eur/tbCount vs real add-on rate)', () => {
  test('uses the injected real add-on rate, not price_eur / tbCount, when they differ', () => {
    // A plan whose base price/TB quotient (25.00 / 2 = €12.50/TB) is
    // deliberately different from the real add-on rate this test injects
    // (€10.99/TB, cents 1099) — the exact shape of the original 1550 bug,
    // reproduced with fixture numbers instead of relying on Pro's real
    // numbers happening to coincide post-1607.
    const fakeApiPlan = {
      price_eur: 25.0,
      price_yearly_eur: 250.0,
      storage_bytes: 2_000_000_000_000, // 2 TB
      storage_label: '2 TB',
    }
    const fallback = { note: 'stale fallback note', perTb: '+€99.99/TB' }
    const realAddonRateStub = (planId: string) => {
      expect(planId).toBe('pro')
      return 1099 // €10.99/TB — deliberately NOT price_eur/tbCount (€12.50/TB)
    }

    const result = deriveAddonAwarePriceDisplay('pro', fakeApiPlan, fallback, realAddonRateStub)

    expect(result.note).toBe('2 TB · €10.99/TB')
    expect(result.perTb).toBe('€10.99/TB')
    // The buggy quotient must never appear anywhere in the output.
    expect(result.note).not.toContain('12.50')
    expect(result.perTb).not.toContain('12.50')
    // Base price/yearly pass through untouched.
    expect(result.priceMonthly).toBe(25.0)
    expect(result.priceYearly).toBeCloseTo(20.83, 2)
    expect(result.storage).toBe('2 TB')
  })

  test('falls back to the static note/perTb when the add-on rate is unknown (0 — WASM not ready)', () => {
    const fakeApiPlan = {
      price_eur: 10.99,
      price_yearly_eur: 109.9,
      storage_bytes: 1_000_000_000_000,
      storage_label: '1 TB',
    }
    const fallback = { note: '1 TB base · +€10.99/TB', perTb: '+€10.99/TB' }
    const notReadyStub = () => 0

    const result = deriveAddonAwarePriceDisplay('pro', fakeApiPlan, fallback, notReadyStub)

    expect(result.note).toBe(fallback.note)
    expect(result.perTb).toBe(fallback.perTb)
  })

  test('falls back to the static note/perTb when the plan has no base TB (tbCount 0)', () => {
    const fakeApiPlan = {
      price_eur: 3.99,
      price_yearly_eur: 39.9,
      storage_bytes: 200_000_000_000, // 200 GB — not a whole TB
      storage_label: '200 GB',
    }
    const fallback = { note: 'static basic note', perTb: undefined }
    let called = false
    const shouldNotBeCalled = () => {
      called = true
      return 1099
    }

    const result = deriveAddonAwarePriceDisplay('basic', fakeApiPlan, fallback, shouldNotBeCalled)

    expect(called).toBe(false)
    expect(result.note).toBe(fallback.note)
    expect(result.perTb).toBeUndefined()
  })

  test('Pro real fixture: real WASM rate (€10.99/TB) and the quotient (10.99/1) coincide post-1607, but the formula used is the injected rate', () => {
    const proApiPlan = {
      price_eur: 10.99,
      price_yearly_eur: 109.9,
      storage_bytes: 1_000_000_000_000,
      storage_label: '1 TB',
    }
    const fallback = { note: '1 TB base · +€10.99/TB', perTb: '+€10.99/TB' }
    // Real rate injected explicitly (as realAddonMonthlyCents would return
    // once regenerated from core with STORAGE_ADDON_CENTS_PER_TB = 1099).
    const result = deriveAddonAwarePriceDisplay('pro', proApiPlan, fallback, () => 1099)
    expect(result.note).toBe('1 TB · €10.99/TB')
    expect(result.perTb).toBe('€10.99/TB')
  })
})
