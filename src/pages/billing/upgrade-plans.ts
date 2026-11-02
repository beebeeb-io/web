// Plan metadata and date/price helpers shared by the billing views.
import { formatStorageSI } from '../../lib/format'
import { PLAN_META, PLAN_RANK } from '../../lib/plan-constants'
import type { Plan } from '../../lib/api'

/**
 * The billing page's plan metadata and its date/price helpers (W-P2-4 sweep).
 * Pure functions only; the page keeps its state and side effects.
 */

export const planMeta = PLAN_META
export const planRank = PLAN_RANK

export type UpgradePlanCard = {
  id: string
  label: string
  priceMonthly: number
  priceYearly: number
  storageLabel: string
  features: string[]
  sortOrder: number
}

export const fallbackUpgradePlanIds = ['basic', 'pro', 'business'] as const

export function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Compute remaining time until a future ISO date as a human-readable string. */
export function formatRemainingTime(iso: string | null): string | null {
  if (!iso) return null
  const now = new Date()
  const end = new Date(iso)
  const diffMs = end.getTime() - now.getTime()
  if (diffMs <= 0) return null

  const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const months = Math.floor(totalDays / 30)
  const days = totalDays - months * 30

  if (months >= 1 && days > 0) return `${months} month${months !== 1 ? 's' : ''}, ${days} day${days !== 1 ? 's' : ''} remaining`
  if (months >= 1) return `${months} month${months !== 1 ? 's' : ''} remaining`
  return `${totalDays} day${totalDays !== 1 ? 's' : ''} remaining`
}

/** Get the number of remaining days until an ISO date. */
export function remainingDays(iso: string | null): number {
  if (!iso) return 0
  const diffMs = new Date(iso).getTime() - Date.now()
  return diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0
}

/** Plans ordered by tier, used for downgrade suggestions.
 *
 * Includes `business` (Teams) for rank ordering, but Teams is `comingSoon` —
 * not purchasable via checkout (server rejects it — task 1050) — so every
 * consumer of this list MUST also exclude `comingSoon` plans before offering
 * one as an actual downgrade/downsell target (task 1064, D8: the cancel
 * downsell iterated this list without that guard — latent today only because
 * Teams is the top rank and can never be "lower" than the current plan, but a
 * real bug the moment a plan above Teams ships). */
export const orderedPaidPlans = ['basic', 'pro', 'business'] as const

export function upgradeCardFromApiPlan(plan: Plan, fallbackSortOrder: number): UpgradePlanCard {
  return {
    id: plan.id,
    label: plan.name,
    priceMonthly: plan.price_eur,
    priceYearly: plan.price_yearly_eur,
    storageLabel: plan.storage_label,
    features: plan.features,
    sortOrder: plan.sort_order ?? planRank[plan.id] ?? fallbackSortOrder,
  }
}

export function upgradeCardFromFallback(planId: (typeof fallbackUpgradePlanIds)[number], fallbackSortOrder: number): UpgradePlanCard {
  const meta = planMeta[planId]
  return {
    id: planId,
    label: meta.label,
    priceMonthly: meta.priceMonthly,
    priceYearly: meta.priceYearly,
    storageLabel: formatStorageSI(meta.storageGB * 1_000_000_000),
    features: meta.features,
    sortOrder: planRank[planId] ?? fallbackSortOrder,
  }
}

export function upgradeCardFromPlanMeta(planId: string): UpgradePlanCard | null {
  const meta = planMeta[planId]
  if (!meta) return null
  return {
    id: planId,
    label: meta.label,
    priceMonthly: meta.priceMonthly,
    priceYearly: meta.priceYearly,
    storageLabel: formatStorageSI(meta.storageGB * 1_000_000_000),
    features: meta.features,
    sortOrder: planRank[planId] ?? 0,
  }
}
