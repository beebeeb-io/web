/**
 * Task 1832 — the ONE mapping from account state to the "Current plan" name
 * and line. Both the Billing summary card and the plan chooser read it, so an
 * allowance account is never "Free" on one page and "Allowance" on the other
 * (there is no free plan publicly).
 */
export const ALLOWANCE_LINE = 'Included with your account. A plan adds storage and sharing.'

/**
 * Task 1842 — a trial without a card is not a plan and not a subscription: the account is
 * on a trial, and the billing pages say so instead of naming the plan it will be offered.
 */
export const NO_CARD_TRIAL_PLAN_NAME = 'Trial, no card'

export function currentPlanName(opts: {
  accountStateLabel: string | null
  hasNoPlan: boolean
  planLabel: string
  /** The onboarding document says the account runs a no-card trial right now (1842). */
  noCardTrial?: boolean
}): string {
  if (opts.noCardTrial) return NO_CARD_TRIAL_PLAN_NAME
  if (opts.accountStateLabel === 'allowance') return 'Allowance'
  if (opts.hasNoPlan) return 'No plan'
  return opts.planLabel
}
