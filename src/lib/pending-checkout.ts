/**
 * Checkout watchdog + pre-checkout intent (task 0946, extracted to a shared
 * module in task 1064 / D6).
 *
 * A persisted "intent" is written to localStorage just before EVERY redirect to
 * the hosted Mollie checkout — plan upgrade, billing-cycle switch, trial
 * convert, AND storage instant-pay. It carries two things:
 *
 * - `pre`: the subscription state captured *before* the redirect (plan, cycle,
 *   status, extra_storage_tb, storage_tb_quantity, current_period_end,
 *   mandate_method). This is the ground truth the reconcile-on-load in
 *   billing.tsx compares a fresh subscription against — NOT a post-reload
 *   baseline (which would already be the upgraded value if the grant landed
 *   before the reload). Comparing to `pre` is what makes confirmation survive a
 *   reload of /billing?upgraded=true, and what lets a trial→active conversion
 *   (same plan/cycle, only status moves) confirm precisely instead of falling
 *   through to a weaker heuristic.
 * - `target`: what the user bought, so we can confirm an exact plan/cycle
 *   match.
 *
 * `kind` distinguishes a storage add-on (plan/cycle unchanged, only storage
 * rises) from a plan checkout. 24h TTL, same as the legacy record.
 *
 * EVERY call site that redirects to a hosted checkout — billing.tsx (upgrade,
 * cycle switch, trial convert, storage instant-pay), upgrade-dialog.tsx, and
 * trial-banner.tsx (trial convert) — MUST stamp this precise shape via
 * `setPendingCheckout` with a real `pre` snapshot from `makePreState(sub)`.
 * Writing the legacy minimal `{plan, cycle, ts}` shape (no `kind`/`pre`) makes
 * `getPendingCheckout` fall back to the weaker target-match / any-change
 * heuristics instead of the precise delta-compare.
 */

import type { Subscription } from '@beebeeb/shared'

export const PENDING_CHECKOUT_KEY = 'bb_pending_checkout'

export interface CheckoutPreState {
  plan: string
  cycle: string | undefined
  status: string | undefined
  periodEnd: string | null | undefined
  extraStorageTb: number
  storageTbQuantity: number
  mandateMethod: 'creditcard' | 'directdebit' | null | undefined
}

export interface PendingCheckout {
  // 'plan' = plan upgrade / cycle switch / trial convert; 'storage' = add-on.
  kind: 'plan' | 'storage'
  // What was bought. For storage, `cycle` mirrors the current cycle (unused by
  // the storage reconcile path, which keys off the storage delta).
  plan: string
  cycle: string
  // Pre-checkout server truth — the reconcile baseline.
  pre: CheckoutPreState
  ts: number
}

export function makePreState(sub: Subscription | null | undefined): CheckoutPreState {
  return {
    plan: sub?.plan ?? 'free',
    cycle: sub?.billing_cycle,
    status: sub?.status,
    periodEnd: sub?.current_period_end,
    extraStorageTb: sub?.extra_storage_tb ?? 0,
    storageTbQuantity: sub?.storage_tb_quantity ?? 0,
    mandateMethod: sub?.mandate_method,
  }
}

export function setPendingCheckout(
  kind: 'plan' | 'storage',
  plan: string,
  cycle: string,
  pre: CheckoutPreState,
) {
  try {
    localStorage.setItem(
      PENDING_CHECKOUT_KEY,
      JSON.stringify({ kind, plan, cycle, pre, ts: Date.now() } satisfies PendingCheckout),
    )
  } catch { /* storage unavailable — watchdog/reconcile simply won't fire */ }
}

export function clearPendingCheckout() {
  localStorage.removeItem(PENDING_CHECKOUT_KEY)
}

export function getPendingCheckout(): PendingCheckout | null {
  try {
    const raw = localStorage.getItem(PENDING_CHECKOUT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<PendingCheckout> & { ts?: number }
    if (typeof data.ts !== 'number' || Date.now() - data.ts > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(PENDING_CHECKOUT_KEY)
      return null
    }
    // Back-compat: a legacy record ({plan,cycle,ts}) has no kind/pre. Treat it as
    // a plan checkout with an empty pre-state — the reconcile then falls back to
    // the target-match / any-change heuristics rather than a delta compare.
    return {
      kind: data.kind === 'storage' ? 'storage' : 'plan',
      plan: data.plan ?? 'free',
      cycle: data.cycle ?? 'monthly',
      pre: data.pre ?? makePreState(null),
      ts: data.ts,
    }
  } catch { return null }
}
