/**
 * The one line of period copy under the current plan — "Renews …",
 * "Trial ends …" or "Access until …" — as a pure, testable rule.
 *
 * Flow-money #5 (P2): billing.tsx rendered "Renews <current_period_end>" for
 * a trialing subscription. That is false for a no-card (Pattern-B) trial:
 * the server's trial.rs `start_trial` sets current_period_end == trial_ends_at,
 * and on that date the account drops to Free unless the user converts —
 * nothing renews. Cancelling (Mollie cancel path keeps current_period_end as
 * the paid grace end) likewise lapses rather than renews.
 *
 * Rules mirror mobile's `billingStatusView` (repos/mobile/src/lib/
 * billing-status.ts) and the CLI's billing.rs, so every client says the same
 * thing for the same account:
 *   - free / cancelled / paused → null (paused has its own panel)
 *   - trialing   → "Trial ends"   trial_ends_at ?? current_period_end
 *   - cancelling → "Access until" current_period_end
 *   - otherwise  → "Renews"       current_period_end
 */

export interface BillingPeriodFields {
  plan?: string | null
  status?: string | null
  current_period_end?: string | null
  trial_ends_at?: string | null
}

export type BillingPeriodLabel = 'Renews' | 'Trial ends' | 'Access until'

export interface BillingPeriodLine {
  label: BillingPeriodLabel
  dateIso: string
}

export function billingPeriodLine(sub: BillingPeriodFields | null | undefined): BillingPeriodLine | null {
  if (!sub) return null
  const plan = (sub.plan ?? 'free').toLowerCase()
  const status = (sub.status ?? '').toLowerCase()
  if (plan === 'free' || status === 'cancelled' || status === 'paused') return null

  if (status === 'trialing') {
    const dateIso = sub.trial_ends_at ?? sub.current_period_end ?? null
    return dateIso ? { label: 'Trial ends', dateIso } : null
  }

  const dateIso = sub.current_period_end ?? null
  if (!dateIso) return null
  return { label: status === 'cancelling' ? 'Access until' : 'Renews', dateIso }
}
