/**
 * The billing cycle prompts: the annual savings offer and the monthly switch offer, each with its confirm step.
 *
 * The two billing-cycle prompts of the change view: annual savings for a
 * monthly subscriber, and the switch-to-monthly card for an annual one. Each
 * owns its confirm sub-state through the page model's reducer.
 *
 * Must not: own state or call the API.
 */

import { BBButton } from '@beebeeb/shared'
import {
  isTrialing,
  isCancelledTrial,
  trialCycleSwitchNoteFor,
} from '../../lib/cycle-switch-copy'
import {
  formatDate,
} from './upgrade-plans'
import { useBillingModel } from './model-context'

export function AnnualSwitchPrompt() {
  const {
    noCardTrial,
    sub,
    cycleSwitchConfirm,
    setCycleSwitchConfirm,
    cycleSwitchLoading,
    effectivePlan,
    currentPriceMonthly,
    currentPriceYearly,
    targetCycleTotalLabel,
    trialDateLabel,
    handleSwitchBillingCycle,
  } = useBillingModel()
  return (
    <>
          {/* Annual savings prompt — shown to monthly paid subscribers. Moved ABOVE
              the Current plan card (task 0942) to match mockup #8's order:
              savings banner → current plan → switch plan → manage storage → cancel.
              Task 1604 (c): a trial cancelled before its first charge has no
              cycle left to switch — the prompt (and its switch UI) is not
              offered at all for that row. */}
          {sub?.billing_cycle === 'monthly' && effectivePlan !== 'free' && !isCancelledTrial(sub) && !noCardTrial && (
            <div className="border border-amber/30 bg-amber-bg/30 rounded-xl p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
                Save on your plan
              </div>
              <p className="text-sm text-ink-2 mb-3">
                Switch to annual billing and save{' '}
                <span className="font-semibold text-ink">
                  EUR {((currentPriceMonthly * 12 - currentPriceYearly) || 0).toFixed(2)}
                </span>{' '}
                per year.
              </p>
              <div className="flex items-center gap-4 text-xs font-mono text-ink-3 mb-3">
                <span>Monthly: EUR {currentPriceMonthly.toFixed(2)}/mo</span>
                <span>Annual: EUR {(currentPriceYearly / 12).toFixed(2)}/mo</span>
              </div>
              {cycleSwitchConfirm === 'yearly' ? (
                <div className="rounded-lg bg-paper border border-line px-4 py-3.5 space-y-3">
                  <div className="text-[12px] font-medium text-ink">Switch to annual billing?</div>
                  <div className="rounded-md bg-paper-2 border border-line px-3.5 py-3 space-y-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-ink-2">New price</span>
                      <span className="font-mono font-semibold text-ink">
                        EUR {currentPriceYearly.toFixed(2)} / year
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-3">
                      That is EUR {(currentPriceYearly / 12).toFixed(2)}/mo instead of EUR {currentPriceMonthly.toFixed(2)}/mo.
                    </div>
                  </div>
                  {isTrialing(sub?.status) ? (
                    <p className="text-xs text-ink-3" data-testid="cycle-switch-trial-note">
                      {trialCycleSwitchNoteFor(
                        sub,
                        'yearly',
                        trialDateLabel(sub?.trial_ends_at ?? sub?.current_period_end ?? null),
                        targetCycleTotalLabel('yearly'),
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-ink-3">
                      Annual billing starts on{' '}
                      <strong className="font-mono">{formatDate(sub?.current_period_end ?? null)}</strong>.
                      Your current monthly period stays active until then — no double charge.
                    </p>
                  )}
                  {(sub?.extra_storage_tb ?? 0) > 0 && (
                    <p className="text-xs text-ink-3">
                      Your storage add-on ({sub!.extra_storage_tb} TB) will also switch to annual billing on the same date.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <BBButton
                      size="sm"
                      onClick={() => setCycleSwitchConfirm(null)}
                      disabled={cycleSwitchLoading}
                    >
                      Cancel
                    </BBButton>
                    <BBButton
                      size="sm"
                      variant="amber"
                      onClick={() => void handleSwitchBillingCycle('yearly')}
                      disabled={cycleSwitchLoading}
                    >
                      {cycleSwitchLoading ? 'Switching...' : 'Confirm switch to annual'}
                    </BBButton>
                  </div>
                </div>
              ) : (
                <BBButton size="sm" variant="amber" onClick={() => setCycleSwitchConfirm('yearly')}>
                  Switch to annual
                </BBButton>
              )}
            </div>
          )}
    </>
  )
}

export function MonthlySwitchPrompt() {
  const {
    noCardTrial,
    sub,
    cycleSwitchConfirm,
    setCycleSwitchConfirm,
    cycleSwitchLoading,
    effectivePlan,
    currentPriceMonthly,
    currentPriceYearly,
    targetCycleTotalLabel,
    trialDateLabel,
    handleSwitchBillingCycle,
  } = useBillingModel()
  return (
    <>
          {/* Monthly switch prompt — shown to yearly paid subscribers */}
          {sub?.billing_cycle === 'yearly' && effectivePlan !== 'free' && sub.status !== 'cancelling' && !noCardTrial && (
            <div className="border border-line rounded-xl p-5 bg-paper">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                Billing cycle
              </div>
              <p className="text-sm text-ink-2 mb-3">
                Currently on annual billing at{' '}
                <span className="font-semibold text-ink font-mono">
                  EUR {currentPriceYearly.toFixed(2)}/yr
                </span>
                .{' '}
                You can switch to monthly billing at{' '}
                <span className="font-semibold text-ink font-mono">
                  EUR {currentPriceMonthly.toFixed(2)}/mo
                </span>
                .
              </p>
              {cycleSwitchConfirm === 'monthly' ? (
                <div className="rounded-lg bg-paper-2 border border-line px-4 py-3.5 space-y-3">
                  <div className="text-[12px] font-medium text-ink">Switch to monthly billing?</div>
                  <div className="rounded-md bg-paper border border-line px-3.5 py-3 space-y-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-ink-2">New price</span>
                      <span className="font-mono font-semibold text-ink">
                        EUR {currentPriceMonthly.toFixed(2)} / month
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-3">
                      Annual cost: EUR {(currentPriceMonthly * 12).toFixed(2)}/yr instead of EUR {currentPriceYearly.toFixed(2)}/yr.
                    </div>
                  </div>
                  {isTrialing(sub.status) ? (
                    <p className="text-xs text-ink-3" data-testid="cycle-switch-trial-note">
                      {trialCycleSwitchNoteFor(
                        sub,
                        'monthly',
                        trialDateLabel(sub.trial_ends_at ?? sub.current_period_end ?? null),
                        targetCycleTotalLabel('monthly'),
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-ink-3">
                      The change takes effect at the start of your next billing period.
                      Your current annual period remains active until{' '}
                      <strong className="font-mono">{formatDate(sub.current_period_end ?? null)}</strong>.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <BBButton
                      size="sm"
                      onClick={() => setCycleSwitchConfirm(null)}
                      disabled={cycleSwitchLoading}
                    >
                      Cancel
                    </BBButton>
                    <BBButton
                      size="sm"
                      variant="amber"
                      onClick={() => void handleSwitchBillingCycle('monthly')}
                      disabled={cycleSwitchLoading}
                    >
                      {cycleSwitchLoading ? 'Switching...' : 'Confirm switch to monthly'}
                    </BBButton>
                  </div>
                </div>
              ) : (
                <BBButton size="sm" onClick={() => setCycleSwitchConfirm('monthly')}>
                  Switch to monthly
                </BBButton>
              )}
            </div>
          )}
    </>
  )
}
