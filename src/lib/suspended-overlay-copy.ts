/**
 * Safety copy for BillingSuspendedOverlay (task 1542, finding 1).
 *
 * Before this fix, the overlay computed a hard "deletion date" 90 days after
 * `past_due_since` and rendered "If no action is taken, your files will be
 * permanently deleted on {date}." for billing_state === 'suspended'. The
 * server removed the automatic d90 auto-terminate sweep in task 1062
 * (WP-D, decision 3) — `billing_lifecycle.rs:370-376` states plainly:
 * "There is NO further automatic escalation past the freeze: no
 * auto-suspend, no auto-terminate, no auto-delete." A permanently abandoned
 * frozen/suspended account is reached only by a MANUAL admin action
 * (`routes/admin_billing_frozen.rs::force_suspend_account` /
 * `cancel_on_behalf`), never an automatic sweep — "we keep trying to win
 * the customer back instead of silently deleting their data."
 * `billing_policy.rs:247-256` confirms the old `delete_after_days` config
 * field was deliberately removed for the same reason.
 *
 * This mirrors the honest read-only freeze banner shown one state earlier
 * (billing.tsx: "nothing has been deleted and nothing will be") instead of
 * fabricating a deletion date from client-side arithmetic that has no
 * corresponding server mechanism.
 */
export function suspendedAccountSafetyMessage(): string {
  return (
    'Nothing is deleted automatically. Your files remain safe and encrypted. ' +
    'If your account stays unpaid, our team may review it manually, but there is no automatic deletion date.'
  )
}
