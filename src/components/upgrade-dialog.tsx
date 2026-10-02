import { useState, useCallback } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useToast } from './toast'
import { createCheckoutSession } from '../lib/api'
import { userFriendlyError } from '../lib/user-friendly-error'
import { isSamePlanActiveError, samePlanConflictMessage } from '../lib/checkout-same-plan'
import { useDriveData } from '../lib/drive-data-context'
import { handleBillingResetTestMode } from '../lib/billing-reset'
import { BillingInfoStep } from './billing/BillingInfoStep'
import { dueTodayVatCaption } from '../lib/checkout-summary-copy'

type BillingCycle = 'monthly' | 'yearly'
type Step = 'cycle' | 'billing-info'

interface UpgradeDialogProps {
  planId: string
  planName: string
  /** Monthly price (displayed only — the server derives the charged amount) */
  pricePerSeat: number
  /** Annual total price */
  priceYearlySeat: number
  /** Unused — kept for backward-compat. All plans are single-user. */
  minSeats?: number
  open: boolean
  onClose: () => void
  /** Reserved for future non-redirect upgrade flows. */
  onSuccess?: () => void
  /**
   * Persist the pre-checkout intent just before the redirect (task 0946). The
   * parent owns the live subscription, so it builds the pre-state snapshot; the
   * dialog only hands back the chosen plan/cycle. Called immediately before
   * `window.location.href = url`. Replaces the dialog's old raw localStorage
   * write so EVERY plan path stamps the same unified intent shape.
   *
   * `paymentId` (task 0957): the provider checkout id from the checkout
   * response, when the server returned one — threaded through so the
   * persisted intent carries it for `/billing`'s reconcile-on-load.
   */
  onBeforeRedirect?: (plan: string, cycle: BillingCycle, paymentId?: string) => void
  /**
   * TB of active storage add-on on the current subscription. When non-zero,
   * the cycle selector shows a note that the add-on will also switch cycles.
   */
  activeAddOnStorageTb?: number
  /**
   * Task 1707 — the user's current subscription's plan+cycle when its status
   * is 'active' (the parent already holds the snapshot; null otherwise). When
   * it equals this dialog's plan on the currently-selected cycle, the checkout
   * would be the exact purchase the server's same-plan guard refuses — the
   * Continue CTA is labelled "Current plan" and disabled instead of letting
   * the server bounce the flow one step later.
   */
  activePlanCycle?: { plan: string; cycle: string } | null
  /**
   * Task 1707 review #133-A — the parent's own billing-state reload path for
   * the same-plan-conflict 409, distinct from `onSuccess` (which stays
   * reserved for real completions). The 409 proves the parent's subscription
   * snapshot was stale — the dialog offered a purchase the server knows is
   * moot — so the parent should re-fetch its billing/subscription state (and
   * the shared plan details) BEFORE the dialog closes, without any
   * success-toast UX. When not wired, the dialog falls back to its own shared
   * plan-details refresh + the app-wide `beebeeb:plan-changed` signal.
   */
  onStaleSnapshot?: () => void
}

export function UpgradeDialog({
  planId,
  planName,
  pricePerSeat,
  priceYearlySeat,
  open,
  onClose,
  onSuccess,
  onBeforeRedirect,
  activeAddOnStorageTb = 0,
  activePlanCycle = null,
  onStaleSnapshot,
}: UpgradeDialogProps) {
  const [cycle, setCycle] = useState<BillingCycle>('yearly')
  const [step, setStep] = useState<Step>('cycle')
  const [error, setError] = useState<string | null>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)
  const { showToast } = useToast()
  const { refreshPlanDetails } = useDriveData()

  // Task 1707 — same-plan re-purchase guard, client side: the dialog targets
  // THIS plan on the CURRENTLY-SELECTED cycle and the user's active
  // subscription is already exactly that, so there is nothing to buy.
  const isCurrentPlanCycle =
    activePlanCycle !== null && activePlanCycle.plan === planId && activePlanCycle.cycle === cycle

  // All plans are single-user — no seat multiplier needed
  const monthlyTotal = pricePerSeat
  const yearlyTotal = priceYearlySeat
  const yearlySavings = (monthlyTotal * 12) - yearlyTotal
  const monthlyEquiv = yearlyTotal / 12
  const netCentsFallback = Math.round((cycle === 'yearly' ? yearlyTotal : monthlyTotal) * 100)

  // Reset to the cycle step whenever the dialog is reopened, so a closed-mid-flow
  // dialog never reopens stuck on the billing-info step.
  const handleClose = useCallback(() => {
    setStep('cycle')
    setError(null)
    onClose()
  }, [onClose])

  // Final leg: the billing profile is already persisted (BillingInfoStep PUTs it
  // before calling us), so create the Mollie checkout session and redirect — the
  // existing 0865 pending-checkout watchdog marker is stamped here as before.
  const proceedToPayment = useCallback(async () => {
    try {
      const res = await createCheckoutSession({
        plan: planId,
        billing_cycle: cycle,
      })
      // Task 1702 — a €0 plan came back already activated: no payment, no
      // redirect. Refresh the parent's plan state and close.
      if (res.activated) {
        showToast({
          icon: 'check',
          title: 'Your plan is activated',
          description: 'This plan is free right now — nothing was charged.',
        })
        onSuccess?.()
        handleClose()
        return
      }
      // Stamp the unified pre-checkout intent (task 0946). The parent owns the
      // live subscription, so it captures the pre-state snapshot; if no callback
      // was wired, fall back to the legacy minimal marker so the abandoned-
      // checkout watchdog still works.
      if (onBeforeRedirect) {
        onBeforeRedirect(planId, cycle, res.payment_id)
      } else {
        try { localStorage.setItem('bb_pending_checkout', JSON.stringify({ kind: 'plan', plan: planId, cycle, ts: Date.now() })) } catch { /* ok */ }
      }
      window.location.href = res.url
    } catch (checkoutErr) {
      // Task 1518 part C — the ordinary upgrade path used to fall through
      // to the generic re-throw below, which BillingInfoStep showed inline
      // under a form for a subscription that no longer exists (the server
      // already reset it to free). Close the dialog and reload plan state
      // instead — same treatment as billing.tsx's resume-checkout path, and
      // via `onSuccess` if the parent wired one (billing.tsx does: reloads
      // its own local subscription state + re-dispatches plan-changed).
      const resetMessage = await handleBillingResetTestMode(checkoutErr, {
        refreshPlanDetails,
        reloadLocal: onSuccess,
      })
      if (resetMessage) {
        showToast({
          icon: 'info',
          title: 'Subscription reset',
          description: resetMessage,
        })
        handleClose()
        return
      }
      if (checkoutErr instanceof Error && 'status' in checkoutErr && (checkoutErr as { status: number }).status === 400) {
        showToast({
          icon: 'x',
          title: 'Billing not configured',
          description: 'Payments are not set up yet. Contact support to upgrade.',
          danger: true,
        })
        handleClose()
        return
      }
      // Task 1707 — the server refused the checkout because this exact
      // plan+cycle is already active (same-plan re-purchase guard; only
      // reachable when the parent's subscription snapshot was stale). Close
      // the dialog with the server's plan+cycle-specific copy — there is no
      // retry to offer.
      if (isSamePlanActiveError(checkoutErr)) {
        showToast({
          icon: 'info',
          title: 'Already subscribed',
          description: samePlanConflictMessage(checkoutErr),
        })
        // Task 1707 review #133-A — the 409 PROVES the parent's subscription
        // snapshot was stale: refresh billing state (no success UX) so the
        // billing page stops rendering the obsolete subscription and
        // re-offering it. Prefer the parent's own reload path (billing.tsx's
        // loadData — distinct from onSuccess, which stays reserved for real
        // completions); the fallback refreshes the shared plan details and
        // fires the app-wide signal the drive context listens on.
        if (onStaleSnapshot) {
          onStaleSnapshot()
        } else {
          refreshPlanDetails()
          try { window.dispatchEvent(new Event('beebeeb:plan-changed')) } catch { /* non-browser env */ }
        }
        handleClose()
        return
      }
      // Re-throw so BillingInfoStep surfaces the error inline and keeps its
      // submitting state from sticking.
      throw new Error(userFriendlyError(checkoutErr))
    }
  }, [planId, cycle, handleClose, showToast, onBeforeRedirect, refreshPlanDetails, onSuccess, onStaleSnapshot])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-label={`Upgrade to ${planName}`} className="relative w-full max-w-[600px] mx-4 bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-[22px] py-3.5 border-b border-line sticky top-0 bg-paper z-10">
          <h3 className="text-base font-bold">
            {step === 'billing-info' ? 'Billing information' : `Upgrade to ${planName}`}
          </h3>
          <button onClick={handleClose} aria-label="Close" className="ml-2 text-ink-3 hover:text-ink transition-colors">
            <Icon name="x" size={16} />
          </button>
        </div>

        {step === 'billing-info' ? (
          <div className="p-[22px]">
            <BillingInfoStep
              planId={planId}
              planName={planName}
              cycle={cycle}
              netCentsFallback={netCentsFallback}
              onProceed={proceedToPayment}
              onBack={() => setStep('cycle')}
            />
          </div>
        ) : (
        <div className="p-[22px]">
          {/* Billing cycle */}
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
            Billing cycle
          </div>
          <div className="grid grid-cols-2 gap-2.5 mb-[18px]">
            <button
              onClick={() => setCycle('monthly')}
              className={`p-3 rounded-md text-left transition-all ${
                cycle === 'monthly'
                  ? 'bg-paper border-[1.5px] border-ink'
                  : 'bg-paper border border-line hover:border-line-2'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center ${
                    cycle === 'monthly' ? 'border-ink' : 'border-line-2'
                  }`}
                >
                  {cycle === 'monthly' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-ink" />
                  )}
                </span>
                <span className="text-[13px] font-medium">Monthly</span>
              </div>
              <div className="font-mono text-[11px] text-ink-3 pl-[22px]">
                EUR {monthlyTotal.toFixed(2)} / mo
              </div>
            </button>
            <button
              onClick={() => setCycle('yearly')}
              className={`p-3 rounded-md text-left transition-all ${
                cycle === 'yearly'
                  ? 'bg-amber-bg border-[1.5px] border-amber-deep'
                  : 'bg-paper border border-line hover:border-line-2'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center ${
                    cycle === 'yearly' ? 'border-amber-deep bg-amber' : 'border-line-2'
                  }`}
                >
                  {cycle === 'yearly' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-ink" />
                  )}
                </span>
                <span className={`text-[13px] ${cycle === 'yearly' ? 'font-semibold' : 'font-medium'}`}>
                  Yearly
                </span>
                <BBChip variant="amber" className="ml-auto">
                  Save EUR {yearlySavings.toFixed(2)}
                </BBChip>
              </div>
              <div className="font-mono text-[11px] text-ink-3 pl-[22px]">
                EUR {yearlyTotal.toFixed(2)} / yr · EUR {monthlyEquiv.toFixed(2)} / mo equiv.
              </div>
            </button>
          </div>

          {/* Add-on coupling note: shown when a storage add-on will also switch cycles */}
          {activeAddOnStorageTb > 0 && cycle === 'yearly' && (
            <p className="text-[11px] text-ink-3 mb-3">
              Your {activeAddOnStorageTb} TB storage add-on will also switch to annual billing.
            </p>
          )}

          {/* Summary */}
          <div className="p-3.5 bg-ink text-paper rounded-md mb-3">
            <div className="flex items-baseline mb-0.5">
              <span className="text-[13px] opacity-70">Due today</span>
              <span className="font-mono text-base font-semibold text-amber ml-auto">
                EUR {cycle === 'yearly' ? yearlyTotal.toFixed(2) : monthlyTotal.toFixed(2)}
              </span>
            </div>
            <div className="text-[11px] opacity-60">
              {dueTodayVatCaption(cycle, cycle === 'yearly' ? yearlyTotal : monthlyTotal)}
            </div>
          </div>

          {error && (
            <div className="text-sm text-red mb-3 text-center">{error}</div>
          )}

          <BBButton
            variant="amber"
            size="lg"
            className="w-full justify-center"
            onClick={() => { setError(null); setStep('billing-info') }}
            disabled={isCurrentPlanCycle}
            data-testid="upgrade-continue"
          >
            {isCurrentPlanCycle ? 'Current plan' : 'Continue'}
            <Icon name="chevron-right" size={13} className="ml-1" />
          </BBButton>

          {/*
            Non-enumerated payment-method copy (0865): we don't list specific
            methods here because the set Mollie actually offers depends on the
            account config Guus controls — advertising one we don't enable would
            be an honest-voice violation. Guus to confirm the enabled method set,
            then we can enumerate (e.g. "Card · iDEAL · SEPA") if desired.
          */}
          <div className="text-[11px] text-ink-4 text-center mt-2">
            Next: billing details, then choose your payment method
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
