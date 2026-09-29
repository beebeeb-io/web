/**
 * The one line of period copy under the current plan — "Renews …",
 * "Trial ends …", "Trial · first charge on …" or "Access until …" — as a
 * pure, testable rule.
 *
 * Flow-money #5 (P2): billing.tsx rendered "Renews <current_period_end>" for
 * a trialing subscription. That is false for a no-card (Pattern-B) trial:
 * the server's trial.rs `start_trial` sets current_period_end == trial_ends_at,
 * and on that date the account drops to Free unless the user converts —
 * nothing renews. Cancelling (Mollie cancel path keeps current_period_end as
 * the paid grace end) likewise lapses rather than renews.
 *
 * Task 1037/1604: since server #125, a `trialing` row can ALSO already hold a
 * Mollie mandate (`trial_auto_converts: true`) — it is charged automatically
 * at `trial_ends_at` instead of dropping to Free, so "Trial ends" (which
 * reads as "and then you lose it") is wrong for that row. Same status,
 * opposite outcome, so the label branches on `trial_auto_converts`:
 *   - mandated trial (trial_auto_converts === true) → "Trial · first charge on"
 *   - no-card trial  (legacy, trial_auto_converts !== true) → "Trial ends"
 * `data_deletion_at` (also since #125) is surfaced as a second line on a
 * cancelling row whenever the server has set it — the account is already
 * marked for deletion, not just losing paid access.
 *
 * Rules otherwise mirror mobile's `billingStatusView` (repos/mobile/src/lib/
 * billing-status.ts) and the CLI's billing.rs, so every client says the same
 * thing for the same account:
 *   - free / cancelled / paused → null (paused has its own panel)
 *   - trialing   → "Trial ends" / "Trial · first charge on"  trial_ends_at ?? current_period_end
 *   - cancelling → "Access until" current_period_end (+ "Files deleted on" data_deletion_at)
 *   - otherwise  → "Renews"       current_period_end
 */

export interface BillingPeriodFields {
  plan?: string | null
  status?: string | null
  current_period_end?: string | null
  trial_ends_at?: string | null
  /**
   * True iff a `trialing` row already holds a Mollie mandate + subscription
   * (task 1037) — it is charged automatically at `trial_ends_at`. False/absent
   * for legacy no-card trials, which lapse to Free at `trial_ends_at` instead.
   */
  trial_auto_converts?: boolean | null
  /** RFC3339 deletion date for a lapsed/lapsing account; null/absent otherwise (task 1037). */
  data_deletion_at?: string | null
}

export type BillingPeriodLabel = 'Renews' | 'Trial ends' | 'Trial · first charge on' | 'Access until'

export interface BillingPeriodLine {
  label: BillingPeriodLabel
  dateIso: string
  /** Second line, e.g. "Files deleted on <date>" — set only when the server has already marked the account for deletion. */
  extra?: { text: string; dateIso: string }
}

export function billingPeriodLine(sub: BillingPeriodFields | null | undefined): BillingPeriodLine | null {
  if (!sub) return null
  const plan = (sub.plan ?? 'free').toLowerCase()
  const status = (sub.status ?? '').toLowerCase()
  if (plan === 'free' || status === 'cancelled' || status === 'paused') return null

  if (status === 'trialing') {
    const dateIso = sub.trial_ends_at ?? sub.current_period_end ?? null
    if (!dateIso) return null
    return sub.trial_auto_converts === true
      ? { label: 'Trial · first charge on', dateIso }
      : { label: 'Trial ends', dateIso }
  }

  const dateIso = sub.current_period_end ?? null
  if (!dateIso) return null
  if (status === 'cancelling') {
    const extra = sub.data_deletion_at ? { text: 'Files deleted on', dateIso: sub.data_deletion_at } : undefined
    return { label: 'Access until', dateIso, extra }
  }
  return { label: 'Renews', dateIso }
}
