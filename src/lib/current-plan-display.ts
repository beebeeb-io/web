/**
 * Task 1832 — the ONE mapping from account state to the "Current plan" name
 * and line. Both the Billing summary card and the plan chooser read it, so an
 * allowance account is never "Free" on one page and "Allowance" on the other
 * (there is no free plan publicly).
 */
export const ALLOWANCE_LINE = 'Included with your account. A plan adds storage and sharing.'

export function currentPlanName(opts: {
  accountStateLabel: string | null
  hasNoPlan: boolean
  planLabel: string
}): string {
  if (opts.accountStateLabel === 'allowance') return 'Allowance'
  if (opts.hasNoPlan) return 'No plan'
  return opts.planLabel
}
