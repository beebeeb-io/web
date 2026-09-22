/**
 * Checkout-confirmation reconcile state machine (task 0957, spec §3.3
 * Component C). Extracted out of `billing.tsx` so it is a pure, directly
 * testable function — no React, no refs, no closures over component state.
 *
 * `reflectsUpgrade` answers ONE question: "does this freshly-fetched
 * subscription reflect the change described by this pending checkout
 * intent?" It is the SAME comparison used by all three confirmation paths in
 * billing.tsx (the poll fallback, the `billing_updated` WS accelerator, and
 * the WS-reconnect catch-up) — all three agree on what "confirmed" means by
 * comparing the fresh subscription against the intent's PRE-checkout state
 * (`intent.pre`), never a post-reload baseline (which could already BE the
 * upgraded value if the grant landed before the reload — the bug this
 * function fixes: a delta against a post-reload baseline can never trip, but
 * a delta against the pre-checkout truth captured before the redirect still
 * does).
 */

import type { Subscription } from '@beebeeb/shared'
import type { PendingCheckout } from './pending-checkout'

const ACTIVE_STATUSES = new Set(['active', 'trialing'])

/**
 * True when `s` (a freshly-fetched subscription) reflects the change
 * described by `intent`. `intent` may be `null` — a direct visit to
 * `/billing` with no in-flight checkout — in which case this always returns
 * `false` (there is nothing to compare against; the caller's own
 * no-intent fallback heuristic applies instead, see `billing.tsx`'s
 * `confirmed()`).
 */
export function reflectsUpgrade(intent: PendingCheckout | null, s: Subscription): boolean {
  if (!intent) return false
  const pre = intent.pre

  // Storage add-on. An instant-pay STORAGE upgrade leaves plan/cycle/status
  // unchanged and only raises extra_storage_tb (or the pinned
  // storage_tb_quantity). Detect that FIRST — before the plan-target path —
  // so it confirms even when plan/cycle never move. Compared against the
  // PRE-checkout storage, so it trips on a reload after the grant landed.
  const extraNow = s.extra_storage_tb ?? 0
  const qtyNow = s.storage_tb_quantity ?? 0
  if (ACTIVE_STATUSES.has(s.status) && (extraNow > pre.extraStorageTb || qtyNow > pre.storageTbQuantity)) {
    return true
  }
  // A storage-kind intent confirms ONLY via the storage delta above; never via
  // the plan/cycle heuristics (the plan is expected to stay the same).
  if (intent.kind === 'storage') return false

  // Most precise: the subscription matches exactly what the user just bought.
  return (
    s.plan === intent.plan &&
    s.billing_cycle === intent.cycle &&
    ACTIVE_STATUSES.has(s.status) &&
    // …but only if that is actually a CHANGE from the pre-state (a no-op
    // "match" against an unchanged sub is not a confirmation), OR the
    // pre-state wasn't active (a fresh paid provision from free/expired).
    (s.plan !== pre.plan ||
      s.billing_cycle !== pre.cycle ||
      !ACTIVE_STATUSES.has(pre.status ?? '') ||
      // Trial conversion keeps the SAME plan/cycle and only moves
      // trialing → active; both are "active" so the clause above won't fire
      // and current_period_end may not advance (the existing period is
      // honored). That status transition IS the confirmation signal —
      // without this a convert-to-paid would spin to `unconfirmed` despite
      // succeeding.
      (pre.status === 'trialing' && s.status === 'active') ||
      (!!pre.periodEnd && !!s.current_period_end && s.current_period_end > pre.periodEnd))
  )
}

/**
 * The no-intent fallback: a legacy/direct visit to `?upgraded=true` with no
 * persisted pre-state. Accepts any active paid subscription as the
 * best-effort signal (the historical 0865 behaviour). Used by billing.tsx's
 * `confirmed()` when `intent` is null; kept here alongside `reflectsUpgrade`
 * so the whole state machine — precise path AND fallback — is covered by one
 * test file.
 */
export function reflectsUpgradeNoIntent(s: Subscription): boolean {
  return s.plan !== 'free' && ACTIVE_STATUSES.has(s.status)
}
