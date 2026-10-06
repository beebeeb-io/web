/**
 * Trial plan + payment-method pickers (task 1037 — no free signups).
 *
 * Shared by /signup (plans first, before the email step) and /choose-plan
 * (plans + payment method before the Mollie mandate checkout). Visual language
 * follows the upgrade dialog / hifi-billing `HiUpgradeFlow`: radio cards, the
 * selected one on amber-bg with an amber-deep border; prices are mono.
 */

import { Icon } from '@beebeeb/shared'
import type { BillingCycle } from '../lib/plan-intent'
import {
  TRIAL_METHOD_COPY,
  formatEur,
  type TrialMethod,
  type TrialPlanOption,
  type TrialPlanSlug,
} from '../lib/trial-checkout'

function Radio({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`w-3.5 h-3.5 shrink-0 rounded-full border-[1.5px] flex items-center justify-center ${
        active ? 'border-amber-deep bg-amber' : 'border-line-2 bg-paper'
      }`}
    >
      {active && <span className="w-1.5 h-1.5 rounded-full bg-ink" />}
    </span>
  )
}

export function CycleToggle({
  cycle,
  onChange,
}: {
  cycle: BillingCycle
  onChange: (cycle: BillingCycle) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing cycle"
      className="inline-flex p-[3px] bg-paper-2 border border-line rounded-full"
    >
      {(['monthly', 'yearly'] as const).map((c) => {
        const active = cycle === c
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`trial-cycle-${c}`}
            onClick={() => onChange(c)}
            className={`px-3.5 py-1 rounded-full text-[12px] flex items-center gap-1.5 transition-all cursor-pointer ${
              active ? 'bg-paper shadow-1 text-ink font-semibold' : 'text-ink-3 hover:text-ink-2 font-medium'
            }`}
          >
            {c === 'monthly' ? 'Monthly' : 'Yearly'}
            {c === 'yearly' && (
              <span className="inline-flex items-center px-1.5 py-px rounded-sm bg-amber-bg text-amber-deep text-[10px] font-bold font-mono tracking-wide">
                -20%
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function TrialPlanPicker({
  options,
  plan,
  cycle,
  onPlanChange,
  onCycleChange,
  label = 'Plan',
  noCard = false,
}: {
  options: TrialPlanOption[]
  plan: TrialPlanSlug
  cycle: BillingCycle
  onPlanChange: (plan: TrialPlanSlug) => void
  onCycleChange: (cycle: BillingCycle) => void
  label?: string
  /**
   * The no-card trial (task 1757): the price is what a subscription would cost, not
   * something the trial charges, so the line under the name says so instead of "then billed".
   */
  noCard?: boolean
}) {
  return (
    <div data-testid="trial-plan-picker">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
        <CycleToggle cycle={cycle} onChange={onCycleChange} />
      </div>
      <div role="radiogroup" aria-label="Plan" className="flex flex-col gap-2">
        {options.map((o) => {
          const active = o.id === plan
          const price = cycle === 'yearly' ? o.priceYearly : o.priceMonthly
          const saved = Math.round(o.priceMonthly * 12 - o.priceYearly)
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`trial-plan-${o.id}`}
              onClick={() => onPlanChange(o.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-md text-left transition-all cursor-pointer ${
                active
                  ? 'bg-amber-bg border-[1.5px] border-amber-deep'
                  : 'bg-paper border border-line hover:border-line-2'
              }`}
            >
              <Radio active={active} />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className={`text-[13.5px] ${active ? 'font-semibold' : 'font-medium'} text-ink`}>
                    {o.name}
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-3">
                    <Icon name="cloud" size={11} className="text-amber-deep" />
                    {o.storageLabel}
                  </span>
                </span>
                <span className="block text-[11px] text-ink-3 mt-0.5">
                  {noCard
                    ? `Try it for ${o.trialDays} days. Nothing is billed.`
                    : `${o.trialDays} days free, then billed ${cycle === 'yearly' ? 'yearly' : 'monthly'}`}
                  {cycle === 'yearly' && saved > 0 && (
                    <span className="text-amber-deep font-medium"> · save {formatEur(saved)}/year</span>
                  )}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block font-mono text-[14px] font-semibold text-ink">{formatEur(price)}</span>
                <span className="block font-mono text-[10.5px] text-ink-3">
                  / {cycle === 'yearly' ? 'year' : 'month'}
                  {noCard ? ' if you subscribe' : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function TrialMethodPicker({
  method,
  onChange,
}: {
  method: TrialMethod
  onChange: (method: TrialMethod) => void
}) {
  return (
    <div data-testid="trial-method-picker">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2">Payment method</div>
      <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(['creditcard', 'ideal'] as const).map((m) => {
          const active = method === m
          const copy = TRIAL_METHOD_COPY[m]
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`trial-method-${m}`}
              onClick={() => onChange(m)}
              className={`p-3 rounded-md text-left transition-all cursor-pointer ${
                active
                  ? 'bg-amber-bg border-[1.5px] border-amber-deep'
                  : 'bg-paper border border-line hover:border-line-2'
              }`}
            >
              <span className="flex items-center gap-2 mb-0.5">
                <Radio active={active} />
                <span className={`text-[13px] ${active ? 'font-semibold' : 'font-medium'} text-ink`}>{copy.label}</span>
              </span>
              <span className="block text-[11px] text-ink-3 pl-[22px]">{copy.detail}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
