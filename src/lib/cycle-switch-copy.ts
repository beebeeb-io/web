/**
 * Billing-cycle switch copy (flow-4 money-flow finding 4).
 *
 * A trialing user sees the same "Switch to annual" / "Switch to monthly"
 * prompts as a paying subscriber. Until the server fix alongside this, the
 * switch 404'd for them; now `POST /billing/switch-cycle` re-pins the trial's
 * cycle locally (no provider call) and `/trial/convert` charges the chosen
 * cycle once they add a payment method. The paid-subscriber copy ("Your
 * current monthly period stays active until then — no double charge") is
 * wrong for a trial: nothing has been charged and nothing will be until they
 * add a payment method. Pure so it is unit-testable without React.
 */

export type BillingCycle = 'monthly' | 'yearly'

/** Is this subscription an in-flight free trial? */
export function isTrialing(status: string | null | undefined): boolean {
  return status === 'trialing'
}

/**
 * The honest "what happens next" line for a cycle switch during a trial.
 * `trialEndLabel` is the already-formatted trial end date.
 */
export function trialCycleSwitchNote(target: BillingCycle, trialEndLabel: string): string {
  const which = target === 'yearly' ? 'annual' : 'monthly'
  return (
    `You are on your free trial, so nothing is charged today. ` +
    `If you add a payment method, ${which} billing starts on ${trialEndLabel}.`
  )
}

/** Toast description after a successful cycle switch during a trial. */
export function trialCycleSwitchToast(target: BillingCycle, trialEndLabel: string): string {
  const which = target === 'yearly' ? 'annual' : 'monthly'
  return `Nothing is charged during your trial. Add a payment method to start ${which} billing on ${trialEndLabel}.`
}
