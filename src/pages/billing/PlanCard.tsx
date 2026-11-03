/**
 * The current-plan card of the billing summary view (task W-P2-2).
 *
 * It draws what the account holds right now — plan name, status badge, price
 * breakdown, storage meters and the renews/access-until strip — and nothing
 * else: every value is computed by the page from server truth and passed in,
 * so this module stays pure markup and can be rendered in a test.
 */

import type { ReactNode } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { NoCardTrialPlanLines } from '../../components/no-card-trial'
import type { AccountState } from '../../lib/account-state'
import type { NoCardTrialStatus } from '../../lib/no-card-trial'
import type { PayNowPhase } from '../../lib/trial-pay-now'
import { formatCentsAsEur } from '../../lib/billing/money'
import { Card, SectionLabel } from './ui'
import { UsagePanel } from './UsagePanel'

/** Non-free price breakdown from server truth (task 0947). */
export interface PlanCardPrice {
  readonly label: string
  readonly totalCents: number
  readonly baseCents: number
  readonly extraTb: number
  readonly addonPerTbCents: number
  /** "month" or "year", as the price line says it. */
  readonly interval: string
  readonly cycle: string | null
}

export interface PlanCardUsage {
  readonly usedBytes: number
  readonly totalStorageBytes: number
  readonly usedPercent: number
  readonly extraTb: number
  readonly addonPerTbCents: number
  readonly cycle: string | null
}

/**
 * The footer strip. Flow-money #5: a trial does not renew and a cancelling
 * plan lapses — the page picks the honest label. Task 1605: a never-paid trial
 * cancelled before its first charge gets its own compact line ("Uploads
 * stopped · Access until · Files deleted on", never "Renews"), distinct from a
 * paying customer's ordinary cancel.
 */
export type PlanCardFooter =
  | { readonly kind: 'none' }
  | { readonly kind: 'never_paid_trial'; readonly compactLine: string | null }
  | {
      readonly kind: 'period'
      readonly label: string
      readonly dateLabel: string
      /** `cancelCopy.kind` — drives the cancelling-card test ids. */
      readonly cancelKind: string | null
      /** The second date a cancelling plan already marked for deletion shows. */
      readonly extra: { readonly text: string; readonly dateLabel: string } | null
      readonly paymentBrand: string | null
      readonly includesAddon: boolean
    }

/** The active-trial cap row (task 1605) and its pay-now feedback rows. */
export interface PlanCardPayNow {
  readonly trialCapped: boolean
  /** The cap explainer sentence, or null when the cap row must not render. */
  readonly explainer: string | null
  readonly heldUntil: boolean
  readonly label: string
  readonly phase: PayNowPhase
  readonly message: string | null
  readonly onPayNow: () => void
}

export interface PlanCardProps {
  readonly planName: string
  readonly badge: ReactNode
  readonly noCardTrial: NoCardTrialStatus | null
  readonly price: PlanCardPrice | null
  /** Free and plan-less: the "5 GB encrypted storage" line. */
  readonly isFreeWithoutPlan: boolean
  readonly accountState: AccountState
  /** null when the onboarding document is not loaded yet. */
  readonly accountStateLabel: string | null
  readonly allowanceLine: string
  readonly uploadsBlockedNow: boolean
  readonly canCancel: boolean
  readonly usage: PlanCardUsage
  readonly footer: PlanCardFooter
  readonly payNow: PlanCardPayNow
  readonly onChangePlan: () => void
  readonly onCancel: () => void
}

export function PlanCard(props: PlanCardProps) {
  const { planName, badge, noCardTrial, price, isFreeWithoutPlan, accountState, accountStateLabel } = props

  return (
    <Card className="overflow-hidden" data-testid="billing-current-plan-card">
      <div className="p-5 grid gap-6 md:grid-cols-2">
        {/* Left: plan + price + actions */}
        <div>
          <SectionLabel className="mb-2">Current plan</SectionLabel>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[28px] font-bold tracking-tight leading-none" data-testid="billing-current-plan-name">
              {planName}
            </span>
            {badge}
          </div>
          {noCardTrial && <NoCardTrialPlanLines status={noCardTrial} testIdPrefix="billing-current-plan" />}
          {price && (
            <div className="font-mono text-[13px] text-ink-2">
              EUR {formatCentsAsEur(price.totalCents)} / {price.interval}
              <span className="text-ink-3">
                {' · '}billed {price.cycle === 'yearly' ? 'annually' : 'monthly'}
              </span>
              {/* Coherent breakdown from server truth (task 0947): show
                  the base plan and the storage add-on as their own line
                  instead of one lumped figure, with the per-TB price from
                  the server's storage_addon_price_cents (not hard-coded). */}
              {price.extraTb > 0 && (
                <div className="text-[11px] text-ink-3 mt-0.5">
                  {price.label} EUR {formatCentsAsEur(price.baseCents)} + {price.extraTb} TB × EUR {formatCentsAsEur(price.addonPerTbCents)}/{price.interval}
                </div>
              )}
            </div>
          )}
          {isFreeWithoutPlan && (
            <div className="text-[13px] text-ink-3">5 GB encrypted storage</div>
          )}
          {accountState === 'lapsed' && (
            <div className="text-[13px] text-ink-3">Read-only — uploads are paused</div>
          )}
          {accountState === 'needs_plan' && accountStateLabel === 'allowance' && (
            <div className="text-[13px] text-ink-3" data-testid="billing-allowance-line">
              {props.allowanceLine}
            </div>
          )}
          {accountState === 'needs_plan' && accountStateLabel !== 'allowance' && (
            <div className="text-[13px] text-ink-3">Start a free trial to begin uploading</div>
          )}
          {/* Task 1605 — a never-paid trial cancelled before its first
              charge is read-only for UPLOADS immediately, distinct
              from `accountState === 'lapsed'` above (the trial hasn't
              lapsed yet, it's cancelled early). */}
          {props.uploadsBlockedNow && (
            <div className="text-[13px] text-ink-3">Uploads and new shares are off — view and download still work</div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <BBButton variant="amber" size="md" onClick={props.onChangePlan} data-testid="billing-choose-plan">
              <Icon name="arrow-up" size={13} className="mr-1.5" />
              {price === null ? 'Choose a plan' : 'Change plan'}
            </BBButton>
            {props.canCancel && (
              <button
                className="text-[13px] text-ink-3 hover:text-red transition-colors disabled:opacity-50"
                onClick={props.onCancel}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Right: storage meters (primary amber + secondary add-on) */}
        <UsagePanel
          variant="meters"
          usedBytes={props.usage.usedBytes}
          totalStorageBytes={props.usage.totalStorageBytes}
          usedPercent={props.usage.usedPercent}
          extraTb={props.usage.extraTb}
          addonPerTbCents={props.usage.addonPerTbCents}
          billingCycle={props.usage.cycle}
        />
      </div>

      <PlanCardFooterStrip footer={props.footer} />
      <PlanCardPayNowRows payNow={props.payNow} />
    </Card>
  )
}

/** Renews / trial ends / access until, or the never-paid-trial compact line. */
function PlanCardFooterStrip({ footer }: { footer: PlanCardFooter }) {
  switch (footer.kind) {
    case 'none':
      return null
    case 'never_paid_trial':
      return (
        <div
          data-testid="cancelling-card"
          data-cancel-kind="never_paid_trial"
          className="flex items-center gap-3 px-5 py-3 border-t border-line bg-amber-bg/40 text-xs"
        >
          <Icon name="upload" size={13} className="text-amber-deep shrink-0" />
          <span className="flex-1 text-ink-2" data-testid="cancelling-headline">
            {footer.compactLine}
          </span>
        </div>
      )
    case 'period':
      return (
        <div
          className="flex items-center gap-3 px-5 py-3 border-t border-line bg-paper-2 text-xs"
          data-testid={footer.cancelKind === 'paid_cancelling' ? 'cancelling-card' : undefined}
          data-cancel-kind={footer.cancelKind ?? undefined}
        >
          <Icon name="clock" size={13} className="text-ink-3 shrink-0" />
          <span className="flex-1 text-ink-2" data-testid={footer.cancelKind === 'paid_cancelling' ? 'cancelling-headline' : undefined}>
            {footer.label} <strong className="font-mono text-ink">{footer.dateLabel}</strong>
            {footer.label === 'Renews' && footer.paymentBrand && (
              <> via <span className="text-ink">{footer.paymentBrand}</span></>
            )}
            {/* Task 1037/1604 — a cancelling row already marked for
                deletion surfaces that alongside "Access until", not
                in place of it: the two dates can differ. */}
            {footer.extra && (
              <>
                {' · '}
                {footer.extra.text}{' '}
                <strong className="font-mono text-ink">{footer.extra.dateLabel}</strong>
              </>
            )}
          </span>
          {footer.includesAddon && (
            <span className="font-mono text-ink-4">incl. add-on storage</span>
          )}
        </div>
      )
    default: {
      const unreachable: never = footer
      return unreachable
    }
  }
}

/** Task 1605 — active mandated trial under the cap: pay now unlocks the quota. */
function PlanCardPayNowRows({ payNow }: { payNow: PlanCardPayNow }) {
  const pending = payNow.phase === 'submitting' || payNow.phase === 'pending'
  return (
    <>
      {payNow.explainer !== null && (
        <div data-testid="trial-cap-card" className="flex items-center gap-3 px-5 py-3 border-t border-line bg-paper-2 text-xs">
          <Icon name="lock" size={13} className="text-ink-3 shrink-0" />
          <span className="flex-1 text-ink-2" data-testid="trial-cap-explainer">
            {payNow.explainer}
          </span>
          {!payNow.heldUntil && (
            <BBButton
              size="sm"
              variant="amber"
              data-testid="pay-now-button"
              onClick={payNow.onPayNow}
              disabled={pending}
            >
              {pending ? 'Processing…' : payNow.label}
            </BBButton>
          )}
        </div>
      )}
      {payNow.trialCapped && !payNow.heldUntil && payNow.phase === 'pending' && (
        <div data-testid="pay-now-pending" className="px-5 py-2 border-t border-line bg-paper-2 text-xs text-amber-deep">
          {payNow.message}
        </div>
      )}
      {payNow.trialCapped && !payNow.heldUntil && payNow.phase === 'error' && (
        <div data-testid="pay-now-error" className="px-5 py-2 border-t border-line bg-paper-2 text-xs text-red">
          {payNow.message}
        </div>
      )}
    </>
  )
}
