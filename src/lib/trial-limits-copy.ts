/**
 * Task 1605 — copy + state helpers for unpaid-trial limits (server PR #129,
 * `.claude/tasks/in-development/1605-trial-abuse-limits-cancel-readonly-retention-cap.md`).
 *
 * Guus's rulings (2026-09-29):
 *   - A never-paid mandated trial that gets cancelled goes read-only for
 *     uploads/shares IMMEDIATELY (view/download keep working until the trial
 *     end); the server marks this via `uploads_blocked_at` (= the cancel
 *     instant), `access_until` (= trial end), `data_deletion_at` (= trial
 *     end + 14 days). This is distinct from a PAYING customer's cancel, which
 *     keeps full upload access until `current_period_end` (no upload block
 *     at all) and follows the 60-day grace instead.
 *   - An active mandated trial is capped at 25 GB (`trial_storage_cap_bytes`)
 *     until the first successful charge — "pay now" ends the trial early and
 *     unlocks the full plan quota as soon as the payment webhook confirms.
 *
 * Pure so it is unit-testable without React. Dates are left as RFC3339
 * strings — callers format with the existing `formatDate` helper so every
 * date on the page (this card, the plan header, invoices) renders identically.
 */

export interface CancelledCardFields {
  status?: string | null
  uploads_blocked_at?: string | null
  access_until?: string | null
  data_deletion_at?: string | null
  current_period_end?: string | null
}

/**
 * True only for the shape server PR #129 introduced: a `cancelling` row with
 * `uploads_blocked_at` set. The server sets this field ONLY on the
 * never-paid-trial-cancel path (`ensure_trial_not_cancelled_read_only`'s
 * `UNPAID_TRIAL_CANCELLING_SQL`) — a paying customer's ordinary cancel never
 * gets it, so this single field is sufficient to distinguish the two cases
 * without re-deriving the server's own predicate client-side.
 */
export function isNeverPaidCancelledTrial(sub: CancelledCardFields | null | undefined): boolean {
  return !!sub && sub.status === 'cancelling' && !!sub.uploads_blocked_at
}

export type CancelledCardKind = 'never_paid_trial' | 'paid_cancelling'

export interface CancelledCardCopy {
  kind: CancelledCardKind
  /** "Uploads stopped" (never-paid trial) or a plan-named headline (paid). */
  headline: string
  /** Date access (view/download) stops — `access_until` for a trial, `current_period_end` for a paid cancel. */
  accessUntilIso: string | null
  /** Date the account/files are permanently deleted, when the server has computed one. Null = not yet known / not applicable. */
  deletionIso: string | null
  /** Whether uploads are ALREADY blocked (true for a never-paid trial; false for a paying customer's grace period). */
  uploadsBlockedNow: boolean
}

/**
 * The single source of truth for the "cancelling" panel on Storage & Plan.
 * Returns null when the subscription isn't in a cancelling state at all.
 */
export function cancelledCardCopy(
  sub: CancelledCardFields | null | undefined,
  planLabel: string,
): CancelledCardCopy | null {
  if (!sub || sub.status !== 'cancelling') return null

  if (isNeverPaidCancelledTrial(sub)) {
    return {
      kind: 'never_paid_trial',
      headline: 'Uploads stopped',
      accessUntilIso: sub.access_until ?? sub.current_period_end ?? null,
      deletionIso: sub.data_deletion_at ?? null,
      uploadsBlockedNow: true,
    }
  }

  // Paying customer, ordinary cancel — unchanged semantics (task 1605 Notes:
  // "paying customers who cancel keep their existing copy semantics: access
  // until period end; deletion per data_deletion_at if set"). Uploads stay
  // open for the whole grace period, so this never claims otherwise.
  return {
    kind: 'paid_cancelling',
    headline: `Your ${planLabel} plan stays active`,
    accessUntilIso: sub.current_period_end ?? null,
    deletionIso: sub.data_deletion_at ?? null,
    uploadsBlockedNow: false,
  }
}

export interface TrialCapFields {
  status?: string | null
  trial_storage_cap_bytes?: number | null
}

/** True only while an active mandated trial is still capped at 25 GB (server clears the field after the first successful charge). */
export function isTrialCapped(sub: TrialCapFields | null | undefined): boolean {
  return !!sub && sub.status === 'trialing' && typeof sub.trial_storage_cap_bytes === 'number' && sub.trial_storage_cap_bytes > 0
}

/** "25 GB during your trial — full Pro storage after your first payment." */
export function trialCapExplainer(planLabel: string, capBytes: number, formatBytes: (b: number) => string): string {
  return `${formatBytes(capBytes)} during your trial — full ${planLabel} storage after your first payment.`
}

/** The pay-now CTA label, shared by the trial card and the trial-cap upload error. */
export function payNowButtonLabel(planLabel: string): string {
  return `Pay now to unlock ${planLabel} storage`
}

/**
 * The exact compact status line Guus's ruling asks for on Storage & Plan:
 * "Uploads stopped · Access until <date> · Files deleted on <date>" — never
 * "Renews". Null for a paid cancel (that card keeps its own longer-form
 * copy) or when there is nothing to say. `formatDate` is injected so this
 * stays pure and reuses whatever date formatter the page already renders
 * every other date with.
 */
export function cancelledCompactLine(
  copy: CancelledCardCopy | null | undefined,
  formatDate: (iso: string) => string,
): string | null {
  if (!copy || copy.kind !== 'never_paid_trial') return null
  const parts = ['Uploads stopped']
  if (copy.accessUntilIso) parts.push(`Access until ${formatDate(copy.accessUntilIso)}`)
  if (copy.deletionIso) parts.push(`Files deleted on ${formatDate(copy.deletionIso)}`)
  return parts.join(' · ')
}
