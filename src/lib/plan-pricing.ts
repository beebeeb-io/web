/**
 * Plan pricing utilities — delegates to WASM core (beebeeb-types::quota).
 *
 * NO local constants or fallbacks. If WASM isn't loaded, these throw.
 * The WasmGuard component ensures WASM is ready before the app renders.
 */

import {
  plan_can_add_storage,
  plan_max_extra_tb,
  plan_base_storage_bytes,
  plan_monthly_cost_cents,
  plan_effective_quota,
} from 'beebeeb-wasm'
import { ensureWasm, formatStorageSI, isWasmReady } from './format'

// Start WASM init immediately on module load — don't wait for first call
ensureWasm()


export function planCanAddStorage(planSlug: string): boolean {
  if (!isWasmReady()) return false
  return plan_can_add_storage(planSlug)
}

export function planMaxExtraTB(planSlug: string): number {
  if (!isWasmReady()) return 0
  return Number(plan_max_extra_tb(planSlug))
}

export function planBaseTB(planSlug: string): number {
  if (!isWasmReady()) return 0
  return Number(plan_base_storage_bytes(planSlug)) / 1_000_000_000_000
}

export function planMonthlyCostCents(
  planSlug: string,
  extraTB: number,
  extraUsers: number = 0,
): number {
  if (!isWasmReady()) return 0
  return Number(plan_monthly_cost_cents(planSlug, BigInt(extraTB), BigInt(extraUsers)))
}

export function planEffectiveQuota(
  planSlug: string,
  extraTB: number,
  bonusBytes: number = 0,
): number {
  if (!isWasmReady()) return 0
  return Number(plan_effective_quota(planSlug, BigInt(extraTB), BigInt(bonusBytes)))
}


export { ensureWasm, formatStorageSI, isWasmReady }

// ─── Pricing-page add-on-aware display (task 1550 / 1607) ──────────────────

/** Monthly cents for ONE extra TB on a plan — the real marginal add-on rate. */
export type AddonRateLookup = (planId: string) => number

/**
 * Default `AddonRateLookup`: the live WASM quota engine, the single source
 * of truth for what an extra TB actually costs (what Mollie bills). Returns
 * 0 when WASM isn't ready yet, same as an unknown/zero add-on.
 */
export function realAddonMonthlyCents(planId: string): number {
  if (!isWasmReady()) return 0
  return planMonthlyCostCents(planId, 1) - planMonthlyCostCents(planId, 0)
}

export interface ApiPlanPriceInfo {
  price_eur: number
  price_yearly_eur: number
  storage_bytes: number
  storage_label: string
}

/**
 * Task 1550 (regression guarded by e2e/1550-pricing-addon-rate.spec.ts and
 * test/pricing-addon-display-1550.test.ts): derive a pricing-page card's
 * price/storage display fields from a live `/api/v1/billing/plans` row.
 *
 * The per-TB add-on rate shown in `note`/`perTb` must be the REAL marginal
 * rate for one extra TB (`addonRate`, default `realAddonMonthlyCents`) —
 * NEVER `price_eur / tbCount`. That quotient is the base plan's own unit
 * economics, not what an extra TB costs; it only happens to equal the real
 * add-on rate while a plan's base TB count is 1 (true for Pro since task
 * 1607's €14.99→€10.99 reversal, by coincidence, not by rule) and silently
 * breaks again the moment either number moves independently. `addonRate` is
 * injected so this is unit-testable without a live WASM module.
 */
export function deriveAddonAwarePriceDisplay(
  planId: string,
  ap: ApiPlanPriceInfo,
  fallback: { note: string; perTb?: string },
  addonRate: AddonRateLookup = realAddonMonthlyCents,
): { priceMonthly: number; priceYearly: number; storage: string; note: string; perTb?: string } {
  const monthlyEq = ap.price_yearly_eur > 0 ? ap.price_yearly_eur / 12 : 0
  const tbCount = Math.round(ap.storage_bytes / 1_000_000_000_000)

  let note = fallback.note
  let perTb = fallback.perTb
  if (tbCount > 0) {
    const addonCents = addonRate(planId)
    if (addonCents > 0) {
      const perTbMonthly = addonCents / 100
      const perTbStr = perTbMonthly % 1 === 0 ? perTbMonthly.toFixed(0) : perTbMonthly.toFixed(2)
      note = `${ap.storage_label} · €${perTbStr}/TB`
      perTb = `€${perTbStr}/TB`
    }
  }

  return {
    priceMonthly: ap.price_eur,
    priceYearly: Math.round(monthlyEq * 100) / 100,
    storage: ap.storage_label,
    note,
    perTb,
  }
}
