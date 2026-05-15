/**
 * Plan pricing utilities — pure JS fallback for WASM plan_monthly_cost_cents,
 * plan_can_add_storage, plan_max_extra_tb, plan_effective_quota.
 *
 * These mirror the logic in beebeeb-types::Plan. When the WASM binary is
 * rebuilt with the new exports, the crypto worker can call the WASM versions
 * instead. Until then these keep the billing slider working.
 */

interface PlanPricing {
  baseCents: number
  storageTB: number
  canAddStorage: boolean
  maxExtraTB: number
  storageAddonCentsPerTB: number
}

const PLANS: Record<string, PlanPricing> = {
  free:         { baseCents: 0,     storageTB: 0.005, canAddStorage: false, maxExtraTB: 0,  storageAddonCentsPerTB: 0 },
  basic:        { baseCents: 899,   storageTB: 1,     canAddStorage: false, maxExtraTB: 0,  storageAddonCentsPerTB: 0 },
  personal:     { baseCents: 899,   storageTB: 1,     canAddStorage: false, maxExtraTB: 0,  storageAddonCentsPerTB: 0 },
  pro:          { baseCents: 3995,  storageTB: 5,     canAddStorage: true,  maxExtraTB: 94, storageAddonCentsPerTB: 1099 },
  business:     { baseCents: 13980, storageTB: 20,    canAddStorage: true,  maxExtraTB: 79, storageAddonCentsPerTB: 899 },
  data_hoarder: { baseCents: 13980, storageTB: 20,    canAddStorage: true,  maxExtraTB: 79, storageAddonCentsPerTB: 899 },
}

function getPlan(slug: string): PlanPricing {
  return PLANS[slug] ?? PLANS.free
}

/** Whether this plan supports purchasing extra storage. */
export function planCanAddStorage(planSlug: string): boolean {
  return getPlan(planSlug).canAddStorage
}

/** Maximum extra TB this plan can add. */
export function planMaxExtraTB(planSlug: string): number {
  return getPlan(planSlug).maxExtraTB
}

/** Base storage in TB for this plan. */
export function planBaseTB(planSlug: string): number {
  return getPlan(planSlug).storageTB
}

/** Price per extra TB in cents for this plan. */
export function planStorageAddonCentsPerTB(planSlug: string): number {
  return getPlan(planSlug).storageAddonCentsPerTB
}

/**
 * Monthly cost in cents for a plan with optional add-ons.
 * Mirrors beebeeb_types::monthly_cost_cents.
 */
export function planMonthlyCostCents(
  planSlug: string,
  extraTB: number,
  _extraUsers: number = 0,
): number {
  const plan = getPlan(planSlug)
  const storageCents = plan.canAddStorage
    ? Math.max(0, extraTB) * plan.storageAddonCentsPerTB
    : 0
  return plan.baseCents + storageCents
}

/**
 * Effective storage quota in bytes for a plan with add-ons.
 * Mirrors beebeeb_types::effective_quota.
 */
export function planEffectiveQuota(
  planSlug: string,
  extraTB: number,
  bonusBytes: number = 0,
): number {
  const plan = getPlan(planSlug)
  const baseBytes = plan.storageTB * 1_000_000_000_000
  const extraBytes = plan.canAddStorage ? Math.max(0, extraTB) * 1_000_000_000_000 : 0
  return baseBytes + extraBytes + bonusBytes
}

/** Format cents as EUR string: 3995 -> "39.95" */
export function formatCentsAsEur(cents: number): string {
  const eur = cents / 100
  return eur % 1 === 0 ? eur.toFixed(0) : eur.toFixed(2)
}
