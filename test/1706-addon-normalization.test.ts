import { describe, expect, test } from 'bun:test'
import { normalizeStorageAddonState } from '../src/lib/api'

/**
 * Task 1706 — quota display drift: the /billing/addons normalization helper.
 *
 * RED-FIRST (2026-10-02): against the pre-fix code this suite FAILED — the
 * helper did not exist (export missing = import error) and the inline
 * normalization it replaces synthesized `effective_storage_bytes` from the
 * whole-TB fields (`total_storage_tb * 1e12`), which multiplied the stale
 * pre-pricing-v2 literal (`basic → base_storage_tb: 1`) into a fake 1.0 TB
 * quota on the billing page.
 *
 * Contract after the fix:
 *  - explicit `effective_storage_bytes` (server truth — get_user_quota,
 *    bonus-inclusive) is used verbatim when present;
 *  - NO tb×1e12 synthesis when it is absent (0 = "unknown"; callers fall
 *    back to their own server-truth sources);
 *  - add-on quantities/prices pass through untouched (addonState stays
 *    authoritative for those).
 */
describe('task 1706 — normalizeStorageAddonState', () => {
  test('no effective_storage_bytes field ⇒ NO tb×1e12 synthesis (the 1 TB drift)', () => {
    // The exact stale pre-pricing-v2 server shape for a basic plan: the
    // removed literal said base = 1 whole TB.
    const stale = normalizeStorageAddonState({
      plan: 'basic',
      base_storage_tb: 1,
      extra_storage_tb: 0,
      total_storage_tb: 1,
      max_storage_tb: 1,
      storage_addon_price_cents: null,
    })
    expect(stale.plan).toBe('basic')
    expect(stale.effective_storage_bytes).not.toBe(1_000_000_000_000)
    expect(stale.effective_storage_bytes).toBe(0)
  })

  test('explicit effective_storage_bytes is used verbatim (basic + 1 TB bonus = 1.2 TB)', () => {
    const fixed = normalizeStorageAddonState({
      plan: 'basic',
      base_storage_tb: 0.2,
      extra_storage_tb: 0,
      total_storage_tb: 0.2,
      max_storage_tb: 0.2,
      effective_storage_bytes: 1_200_000_000_000,
      storage_addon_price_cents: null,
    })
    expect(fixed.effective_storage_bytes).toBe(1_200_000_000_000)
  })

  test('explicit 0 is server truth (no-plan accounts store nothing) and is kept', () => {
    const noPlan = normalizeStorageAddonState({
      plan: 'none',
      base_storage_tb: 0,
      effective_storage_bytes: 0,
    })
    expect(noPlan.effective_storage_bytes).toBe(0)
  })

  test('malformed effective_storage_bytes does not synthesize', () => {
    const junk = normalizeStorageAddonState({
      plan: 'basic',
      base_storage_tb: 0.2,
      effective_storage_bytes: '1e12',
    })
    expect(junk.effective_storage_bytes).toBe(0)
  })

  test('add-on quantities/prices stay authoritative (pro payload pass-through)', () => {
    const pro = normalizeStorageAddonState({
      plan: 'pro',
      base_storage_tb: 1,
      extra_storage_tb: 3,
      total_storage_tb: 4,
      max_storage_tb: 99,
      effective_storage_bytes: 4_000_000_000_000,
      storage_addon_price_cents: 1099,
    })
    expect(pro.extra_storage_tb).toBe(3)
    expect(pro.max_storage_tb).toBe(99)
    expect(pro.storage_addon_price_cents).toBe(1099)
    expect(pro.effective_storage_bytes).toBe(4_000_000_000_000)
  })

  test('apply-response pending marker passes through; extra falls back to requested TB', () => {
    const sepa = normalizeStorageAddonState(
      {
        plan: 'pro',
        base_storage_tb: 1,
        extra_storage_tb: 2,
        effective_storage_bytes: 3_000_000_000_000,
        pending: true,
      },
      2,
    )
    expect(sepa.pending).toBe(true)
    expect(sepa.extra_storage_tb).toBe(2)
    const absent = normalizeStorageAddonState({ plan: 'pro' }, 5)
    expect(absent.pending).toBe(false)
    expect(absent.extra_storage_tb).toBe(5)
  })
})
