import { useState, useCallback } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useToast } from './toast'
import { createCheckoutSession } from '../lib/api'
import { userFriendlyError } from '../lib/user-friendly-error'
import { BillingInfoStep } from './billing/BillingInfoStep'

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
   */
  onBeforeRedirect?: (plan: string, cycle: BillingCycle) => void
  /**
   * TB of active storage add-on on the current subscription. When non-zero,
   * the cycle selector shows a note that the add-on will also switch cycles.
   */
  activeAddOnStorageTb?: number
}

export function UpgradeDialog({
  planId,
  planName,
  pricePerSeat,
  priceYearlySeat,
  open,
  onClose,
  onBeforeRedirect,
  activeAddOnStorageTb = 0,
}: UpgradeDialogProps) {
  const [cycle, setCycle] = useState<BillingCycle>('yearly')
  const [step, setStep] = useState<Step>('cycle')
  const [error, setError] = useState<string | null>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)
  const { showToast } = useToast()

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
      const { url } = await createCheckoutSession({
        plan: planId,
        billing_cycle: cycle,
      })
      // Stamp the unified pre-checkout intent (task 0946). The parent owns the
      // live subscription, so it captures the pre-state snapshot; if no callback
      // was wired, fall back to the legacy minimal marker so the abandoned-
      // checkout watchdog still works.
      if (onBeforeRedirect) {
        onBeforeRedirect(planId, cycle)
      } else {
        try { localStorage.setItem('bb_pending_checkout', JSON.stringify({ kind: 'plan', plan: planId, cycle, ts: Date.now() })) } catch { /* ok */ }
      }
      window.location.href = url
    } catch (checkoutErr) {
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
      // Re-throw so BillingInfoStep surfaces the error inline and keeps its
      // submitting state from sticking.
      throw new Error(userFriendlyError(checkoutErr))
    }
  }, [planId, cycle, handleClose, showToast, onBeforeRedirect])

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
              EUR {cycle === 'yearly' ? yearlyTotal.toFixed(2) : monthlyTotal.toFixed(2)}{' '}
              / {cycle === 'yearly' ? 'year' : 'month'} excl. VAT · cancel anytime
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
            data-testid="upgrade-continue"
          >
            Continue
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
