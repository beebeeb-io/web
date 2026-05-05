import { useState, useCallback } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { Icon } from './icons'
import { useToast } from './toast'
import { createCheckoutSession } from '../lib/api'

type BillingCycle = 'monthly' | 'yearly'

interface UpgradeDialogProps {
  planId: string
  planName: string
  /** Monthly price (displayed, not used for calculation — Stripe is source of truth) */
  pricePerSeat: number
  /** Annual total price */
  priceYearlySeat: number
  /** Unused — kept for backward-compat. All plans are single-user. */
  minSeats?: number
  open: boolean
  onClose: () => void
  /** Reserved for future non-redirect upgrade flows. */
  onSuccess?: () => void
}

export function UpgradeDialog({
  planId,
  planName,
  pricePerSeat,
  priceYearlySeat,
  open,
  onClose,
}: UpgradeDialogProps) {
  const [cycle, setCycle] = useState<BillingCycle>('yearly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)
  const { showToast } = useToast()

  // All plans are single-user — no seat multiplier needed
  const monthlyTotal = pricePerSeat
  const yearlyTotal = priceYearlySeat
  const yearlySavings = (monthlyTotal * 12) - yearlyTotal
  const monthlyEquiv = yearlyTotal / 12

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { url } = await createCheckoutSession({
        plan: planId,
        billing_cycle: cycle,
        seats: 1,
      })
      window.location.href = url
    } catch (checkoutErr) {
      if (checkoutErr instanceof Error && 'status' in checkoutErr && (checkoutErr as { status: number }).status === 400) {
        showToast({
          icon: 'x',
          title: 'Billing not configured',
          description: 'Stripe integration is pending. Contact support to upgrade.',
          danger: true,
        })
        onClose()
        return
      }
      setError(checkoutErr instanceof Error ? checkoutErr.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [planId, cycle, onClose, showToast])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />

      {/* Dialog */}
      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-label={`Upgrade to ${planName}`} className="relative w-[600px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-[22px] py-3.5 border-b border-line">
          <h3 className="text-base font-bold">Upgrade to {planName}</h3>
          <button onClick={onClose} aria-label="Close" className="ml-2 text-ink-3 hover:text-ink transition-colors">
            <Icon name="x" size={16} />
          </button>
        </div>

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
              / {cycle === 'yearly' ? 'year' : 'month'} · cancel anytime
            </div>
          </div>

          {error && (
            <div className="text-sm text-red mb-3 text-center">{error}</div>
          )}

          <BBButton
            variant="amber"
            size="lg"
            className="w-full justify-center"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Processing...' : 'Subscribe'}
            {!loading && <Icon name="chevron-right" size={13} className="ml-1" />}
          </BBButton>

          <div className="text-[11px] text-ink-4 text-center mt-2">
            SEPA · card · invoice · PayPal · Bitcoin
          </div>
        </div>
      </div>
    </div>
  )
}
