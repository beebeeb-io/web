/**
 * The billing summary view: plan, coupon, payment method, invoices, transactions, and credit notes.
 *
 * The /billing summary view: current plan, coupon, payment method,
 * transactions, invoices and credit notes. Moved out of the page component
 * verbatim (task W run 5).
 *
 * Must not: own state or call the API.
 */

import { ALLOWANCE_LINE, currentPlanName } from '../../lib/current-plan-display'
import { Icon } from '@beebeeb/shared'
import { formatStorageSI } from '../../lib/format'
import { PlanCard } from './PlanCard'
import { PaymentMethodPanel } from './PaymentMethodPanel'
import { InvoiceList } from '../../components/billing/InvoiceList'
import { CreditNoteList } from '../../components/billing/CreditNoteList'
import { TransactionList } from '../../components/billing/TransactionList'
import { CouponCard } from '../../components/billing/coupon-card'
import {
  cancelledCompactLine,
  trialCapExplainer,
  payNowButtonLabel,
} from '../../lib/trial-limits-copy'
import {
  formatDate,
} from './upgrade-plans'
import { SubscriptionStatusBadge } from './SubscriptionStatusBadge'
import { useBillingModel } from './model-context'

export function BillingSummaryView() {
  const {
    showToast,
    setView,
    accountStateLabel,
    noCardTrial,
    sub,
    invoices,
    creditNotes,
    transactions,
    portalLoading,
    paymentMethod,
    pmLoaded,
    exportingTransactions,
    effectivePlan,
    meta,
    periodLine,
    accountState,
    hasNoPlan,
    totalStorageBytes,
    usedBytes,
    usedPercent,
    cancelCopy,
    trialCapped,
    heldUntil,
    trialDateLabel,
    currentExtraTB,
    billingInterval,
    addonPerTbCents,
    basePlanCents,
    basePriceCents,
    startCancelFlow,
    handlePayNow,
    handleUpdatePaymentMethod,
    handleExportTransactions,
    payNowState,
  } = useBillingModel()
  return (
    <>
          <div className="space-y-4">
            {/* Current Plan card */}
            <PlanCard
              planName={currentPlanName({ accountStateLabel, hasNoPlan, planLabel: meta.label, noCardTrial: noCardTrial !== null })}
              badge={effectivePlan !== 'free' && !hasNoPlan && !noCardTrial ? <SubscriptionStatusBadge sub={sub} effectivePlan={effectivePlan} /> : null}
              noCardTrial={noCardTrial}
              price={
                effectivePlan !== 'free' && !noCardTrial
                  ? {
                      label: meta.label,
                      totalCents: basePriceCents,
                      baseCents: basePlanCents,
                      extraTb: currentExtraTB,
                      addonPerTbCents,
                      interval: billingInterval,
                      cycle: sub?.billing_cycle ?? null,
                    }
                  : null
              }
              isFreeWithoutPlan={effectivePlan === 'free' && !hasNoPlan}
              accountState={accountState}
              accountStateLabel={accountStateLabel}
              allowanceLine={ALLOWANCE_LINE}
              uploadsBlockedNow={cancelCopy?.uploadsBlockedNow === true}
              canCancel={
                effectivePlan !== 'free' &&
                sub?.status !== 'cancelling' &&
                sub?.status !== 'paused' &&
                sub?.status !== 'trialing'
              }
              usage={{
                usedBytes,
                totalStorageBytes,
                usedPercent,
                extraTb: currentExtraTB,
                addonPerTbCents,
                cycle: sub?.billing_cycle ?? null,
              }}
              footer={
                cancelCopy?.kind === 'never_paid_trial'
                  ? { kind: 'never_paid_trial', compactLine: cancelledCompactLine(cancelCopy, formatDate) }
                  : periodLine && !noCardTrial
                    ? {
                        kind: 'period',
                        label: periodLine.label,
                        dateLabel: trialDateLabel(periodLine.dateIso),
                        cancelKind: cancelCopy?.kind ?? null,
                        extra: periodLine.extra
                          ? { text: periodLine.extra.text, dateLabel: formatDate(periodLine.extra.dateIso) }
                          : null,
                        paymentBrand: paymentMethod?.brand ?? null,
                        includesAddon: currentExtraTB > 0,
                      }
                    : { kind: 'none' }
              }
              payNow={{
                trialCapped,
                explainer:
                  trialCapped && !noCardTrial && sub?.trial_storage_cap_bytes != null
                    ? trialCapExplainer(meta.label, sub.trial_storage_cap_bytes, formatStorageSI)
                    : null,
                heldUntil: heldUntil !== null,
                label: payNowButtonLabel(meta.label),
                phase: payNowState.phase,
                message: payNowState.message ?? null,
                onPayNow: () => void handlePayNow(),
              }}
              onChangePlan={() => setView('change')}
              onCancel={() => {
                // Task 1064 (D7): this used to just switch to the full
                // plan-comparison view — a mismatch with what "Cancel" says it
                // does. Now it opens the SAME view AND starts the actual cancel
                // sequence (pause/confirm), so the user who clicked "Cancel"
                // lands directly in the cancel flow instead of a neutral
                // compare screen.
                setView('change')
                void startCancelFlow()
              }}
            />


            {/* Task 1814: redeem a coupon link or code. Only for an account that holds no plan
                (the server refuses one that does, so the card is not offered there). */}
            {(hasNoPlan || effectivePlan === 'free') && <CouponCard />}

            {/* Payment Method card (#7) — restyled. Binds ONLY to real
                PaymentMethod fields (type/brand/last4/iban_last4/is_default);
                same data + same Update/Add handler as the detailed view. */}
            {effectivePlan !== 'free' && sub?.status !== 'trialing' && pmLoaded && (
              <PaymentMethodPanel
                variant="summary"
                method={paymentMethod}
                busy={portalLoading}
                onUpdate={() => void handleUpdatePaymentMethod()}
              />
            )}


            {/* Payment History (#7) — the 0936 transactions view, restyled, with
                the "Export all" CSV affordance (task 0942) in the header. */}
            <TransactionList
              transactions={transactions}
              variant="card"
              onExport={() => void handleExportTransactions()}
              exporting={exportingTransactions}
            />

            {/* Invoices — the legal VAT documents, downloadable. */}
            <InvoiceList
              invoices={invoices}
              onError={(message) =>
                showToast({ icon: 'download', title: 'Could not download invoice', description: message, danger: true })
              }
            />

            {/* Credit notes (task 1899) — only when there are any. */}
            <CreditNoteList
              creditNotes={creditNotes}
              onError={(message) =>
                showToast({ icon: 'download', title: 'Could not download credit note', description: message, danger: true })
              }
            />

            {/* Compliance footer line (#7) */}
            <div className="flex items-center gap-2.5 px-1 pt-1 text-[11.5px] text-ink-3">
              <Icon name="shield" size={13} className="text-ink-4 shrink-0" />
              <span>
                VAT-compliant invoices · Operated by Initlabs B.V. · Stored in Europe under EU law.
              </span>
            </div>
          </div>
    </>
  )
}
