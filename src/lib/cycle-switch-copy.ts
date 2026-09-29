/**
 * Billing-cycle switch copy (flow-4 money-flow finding 4; extended task 1604).
 *
 * A trialing user sees the same "Switch to annual" / "Switch to monthly"
 * prompts as a paying subscriber. Three trial shapes now exist (server #125,
 * #128 / task 1037, 1604), and each needs its own honest copy:
 *
 * (a) Mandated trial (`trial_auto_converts === true`) — the trial already
 *     holds a Mollie mandate + subscription that charges automatically at
 *     `trial_ends_at`. Switching cycle re-prices that first charge; nothing
 *     is charged today, and the date does not move.
 * (b) No-card trial (legacy, `trial_auto_converts` false/absent) — no mandate
 *     yet. `POST /billing/switch-cycle` just re-pins the cycle the trial will
 *     convert on; the user still has to add a payment method via
 *     `/trial/convert` before anything is charged. Unchanged from before.
 * (c) Cancelled trial (`status === 'cancelling'` with `current_period_end`
 *     still pinned at `trial_ends_at` — cancelled before its first charge,
 *     server #128) — there is no cycle to switch. The switch UI must not be
 *     offered; if the server still gets hit (e.g. a stale tab), it answers
 *     409 `trial_cancelled`, which gets the same copy.
 *
 * Paid-subscriber copy (not trialing) is untouched.
 *
 * Pure so it is unit-testable without React.
 */

export type BillingCycle = 'monthly' | 'yearly'

/** The subscription fields this module's decisions are driven by. */
export interface CycleSwitchSubscription {
  status?: string | null
  trial_auto_converts?: boolean | null
  trial_ends_at?: string | null
  current_period_end?: string | null
}

/** Is this subscription an in-flight free trial? */
export function isTrialing(status: string | null | undefined): boolean {
  return status === 'trialing'
}

/** Case (a) — a trialing row that already holds a Mollie mandate. */
export function isMandatedTrial(sub: CycleSwitchSubscription | null | undefined): boolean {
  return isTrialing(sub?.status) && sub?.trial_auto_converts === true
}

/**
 * Case (c) — a trial cancelled before its first charge (server #128:
 * `status='cancelling' AND current_period_end <= trial_ends_at`). The row
 * never reached a real billing period, so `current_period_end` is still
 * pinned at `trial_ends_at` exactly (`trial.rs start_trial` sets them equal;
 * nothing since has moved either forward). A cancelling row with its OWN
 * grace period (a paid plan cancelled normally) has no `trial_ends_at` at
 * all, or a `current_period_end` that has since moved past it — never equal.
 */
export function isCancelledTrial(sub: CycleSwitchSubscription | null | undefined): boolean {
  if (!sub) return false
  return (
    sub.status === 'cancelling' &&
    !!sub.trial_ends_at &&
    sub.current_period_end === sub.trial_ends_at
  )
}

/** Case (c) copy — shown instead of the switch UI, and for a 409 `trial_cancelled` response. */
export function trialCancelledSwitchNote(): string {
  return 'Your trial is cancelled — resume it to change billing.'
}

/**
 * Case (a) — the honest "what happens next" line for a cycle switch during a
 * mandated trial. `newPriceLabel` is the already-formatted new price (e.g.
 * "EUR 54.95/yr"); `trialEndLabel` is the already-formatted trial end date.
 */
export function mandatedTrialCycleSwitchNote(
  target: BillingCycle,
  newPriceLabel: string,
  trialEndLabel: string,
): string {
  const cadence = target === 'yearly' ? 'year' : 'month'
  return `Nothing is charged today. Your first charge of ${newPriceLabel} is on ${trialEndLabel}, then every ${cadence}.`
}

/** Case (a) — toast description after a successful cycle switch during a mandated trial. */
export function mandatedTrialCycleSwitchToast(newPriceLabel: string, trialEndLabel: string): string {
  return `Nothing was charged. Your first charge of ${newPriceLabel} is still on ${trialEndLabel}.`
}

/**
 * Case (b) — the honest "what happens next" line for a cycle switch during a
 * no-card trial. `trialEndLabel` is the already-formatted trial end date.
 */
export function trialCycleSwitchNote(target: BillingCycle, trialEndLabel: string): string {
  const which = target === 'yearly' ? 'annual' : 'monthly'
  return (
    `You are on your free trial, so nothing is charged today. ` +
    `If you add a payment method, ${which} billing starts on ${trialEndLabel}.`
  )
}

/** Case (b) — toast description after a successful cycle switch during a no-card trial. */
export function trialCycleSwitchToast(target: BillingCycle, trialEndLabel: string): string {
  const which = target === 'yearly' ? 'annual' : 'monthly'
  return `Nothing is charged during your trial. Add a payment method to start ${which} billing on ${trialEndLabel}.`
}

/**
 * Dispatcher: the confirm-dialog note for a trialing row, routed by the
 * subscription payload. Callers only reach this after already checking
 * `isTrialing(sub.status)` — a cancelled trial in particular should not even
 * offer the switch buttons (case c), so this is the copy for the one place
 * that still needs it: a 409 `trial_cancelled` race, or a defensive render.
 */
export function trialCycleSwitchNoteFor(
  sub: CycleSwitchSubscription | null | undefined,
  target: BillingCycle,
  trialEndLabel: string,
  newPriceLabel: string,
): string {
  if (isCancelledTrial(sub)) return trialCancelledSwitchNote()
  if (isMandatedTrial(sub)) return mandatedTrialCycleSwitchNote(target, newPriceLabel, trialEndLabel)
  return trialCycleSwitchNote(target, trialEndLabel)
}

/** Dispatcher for the post-switch toast — same routing as {@link trialCycleSwitchNoteFor}. */
export function trialCycleSwitchToastFor(
  sub: CycleSwitchSubscription | null | undefined,
  target: BillingCycle,
  trialEndLabel: string,
  newPriceLabel: string,
): string {
  if (isCancelledTrial(sub)) return trialCancelledSwitchNote()
  if (isMandatedTrial(sub)) return mandatedTrialCycleSwitchToast(newPriceLabel, trialEndLabel)
  return trialCycleSwitchToast(target, trialEndLabel)
}
