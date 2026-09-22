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
 * - `paymentId` (task 0957): the provider (Mollie) checkout id, when the
 *   caller has one. Lets the reconcile-on-load flow in billing.tsx ask
 *   `GET /api/v1/billing/payment/{id}/status` for server-side ground truth on
 *   THIS specific payment — independent of both the `?upgraded=true` URL flag
 *   and the WS `billing_updated` accelerator (spec §3.3 item 2). Optional:
 *   an older persisted record (pre-0957), or a checkout path the server
 *   doesn't yet tag with a payment id, simply has none — the reconcile then
 *   falls back to the pre-0957 subscription-poll/WS path unchanged.
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
  // task 0957 — the provider checkout id, when known. See the module doc.
  paymentId?: string
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
  paymentId?: string,
) {
  try {
    localStorage.setItem(
      PENDING_CHECKOUT_KEY,
      JSON.stringify({ kind, plan, cycle, pre, ts: Date.now(), paymentId } satisfies PendingCheckout),
    )
  } catch { /* storage unavailable — watchdog/reconcile simply won't fire */ }
}

/**
 * Build + persist the pending-checkout intent for a trial→paid conversion
 * (task 0957 follow-up, PR #53 review). Factored out so EVERY trial-convert
 * call site stamps the IDENTICAL `paymentId`-carrying shape instead of each
 * one hand-rolling its own `setPendingCheckout` call: before this, the
 * billing-page "Convert now" button passed `payment_id` through but
 * `trial-banner.tsx`'s site-wide banner destructured only `{ url }` from
 * `convertTrial()` and silently dropped it, so a conversion started from the
 * banner lost the direct `GET /payment/{id}/status` reconciliation path and
 * fell back to the weaker poll/WS-only route. One shared helper means the
 * two callers cannot drift like that again.
 */
export function persistTrialConvertIntent(
  sub: Subscription | null | undefined,
  paymentId: string | undefined,
) {
  setPendingCheckout('plan', sub?.plan ?? 'free', sub?.billing_cycle ?? 'monthly', makePreState(sub), paymentId)
}

/**
 * task 1469 follow-up (Codex review on PR #54, thread PRRT_kwDOSLX6Nc6k2gf2,
 * src/pages/pricing.tsx:130): what should the checkout watchdog's "Continue"
 * button DO for a persisted `kind: 'plan'` intent?
 *
 * A saved plan that differs from the subscription's CURRENT plan is a plan
 * PURCHASE (or a tier change) — resuming it must recreate checkout for the
 * saved plan + cycle, the same `createCheckoutSession` request every other
 * plan-purchase entry point (pricing.tsx's `startPlanCheckout`,
 * upgrade-dialog.tsx, upgrade-nudge-modal.tsx) makes. Only when the saved
 * plan MATCHES the current plan is the abandoned checkout genuinely an
 * in-place billing-cycle switch — that's the one case
 * `switchBillingCycle(cycle)` is the correct call for. Before this, the
 * Continue handler called `switchBillingCycle` unconditionally and never
 * read `pending.plan` at all, so resuming a Starter/Pro purchase silently
 * switched the cycle of whatever plan the user was ALREADY on (or failed
 * outright on a free current plan, which has no cycle to switch).
 *
 * Pure so it's unit-testable without rendering billing.tsx — the handler
 * there is wired through it.
 */
export function resolveResumeAction(
  pending: Pick<PendingCheckout, 'plan' | 'cycle'>,
  currentPlan: string,
): { kind: 'checkout'; plan: string; cycle: string } | { kind: 'switch-cycle'; cycle: 'monthly' | 'yearly' } {
  if (pending.plan !== currentPlan) {
    return { kind: 'checkout', plan: pending.plan, cycle: pending.cycle }
  }
  return { kind: 'switch-cycle', cycle: pending.cycle === 'yearly' ? 'yearly' : 'monthly' }
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
      paymentId: typeof data.paymentId === 'string' ? data.paymentId : undefined,
    }
  } catch { return null }
}
