/**
 *  The storage add-on confirmation modal: preview of the prorated charge, the
 *  SEPA note and the instant-pay / confirm actions. Moved verbatim out of the
 *  page (task W run 5).
 */

import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useBillingModel } from './model-context'

export function BillingAddonDialog() {
  const {
    addonSaving,
    addonPreview,
    setAddonPreview,
    addonInstantPayLoading,
    meta,
    isSepaMandate,
    handleConfirmStorageAddon,
    handleStorageAddonInstantPay,
  } = useBillingModel()
  return (
    <>
      {/* Storage addon confirmation modal */}
      {addonPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setAddonPreview(null)}
          />

          {/* Modal card */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={addonPreview.is_upgrade ? 'Confirm storage upgrade' : 'Confirm storage change'}
            className="relative w-full max-w-[440px] mx-4 bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <h3 className="text-base font-bold">
                {addonPreview.is_upgrade ? 'Confirm storage upgrade' : 'Confirm storage change'}
              </h3>
              <button
                onClick={() => setAddonPreview(null)}
                className="text-ink-3 hover:text-ink transition-colors"
                aria-label="Close"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-4">
              {/* Prorated charge / credit. SEPA mandates (task 0941) settle off-session,
                  so we drop the "IMMEDIATE CHARGE" framing — the charge is to the SEPA
                  mandate and activates in a few days (the pay-now path below activates
                  instantly). creditcard / null keep the immediate-charge copy. */}
              {addonPreview.is_upgrade && addonPreview.immediate_charge_cents > 0 && (
                isSepaMandate ? (
                  <div className="rounded-lg bg-amber-bg border border-amber/30 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
                      Prorated charge
                    </div>
                    <div className="font-mono text-xl font-bold text-ink">
                      EUR {(addonPreview.immediate_charge_cents / 100).toFixed(2)}
                    </div>
                    <div className="text-[12px] text-ink-3 mt-1">
                      Charged to your SEPA Direct Debit mandate, prorated for the
                      remaining {addonPreview.remaining_days} day{addonPreview.remaining_days !== 1 ? 's' : ''} of your
                      billing period. The extra storage activates in a few days, once
                      the debit settles — or pay now to activate it instantly.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-amber-bg border border-amber/30 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
                      Immediate charge
                    </div>
                    <div className="font-mono text-xl font-bold text-ink">
                      EUR {(addonPreview.immediate_charge_cents / 100).toFixed(2)}
                    </div>
                    <div className="text-[12px] text-ink-3 mt-1">
                      Prorated for the remaining {addonPreview.remaining_days} day{addonPreview.remaining_days !== 1 ? 's' : ''} of your billing period.
                    </div>
                  </div>
                )
              )}

              {!addonPreview.is_upgrade && addonPreview.credit_cents > 0 && (
                <div className="rounded-lg bg-green/5 border border-green/20 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-green mb-1">
                    Credit applied
                  </div>
                  <div className="font-mono text-xl font-bold text-ink">
                    EUR {(addonPreview.credit_cents / 100).toFixed(2)}
                  </div>
                  <div className="text-[12px] text-ink-3 mt-1">
                    This credit will be applied to your next invoice.
                  </div>
                </div>
              )}

              {/* Breakdown */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                  New monthly breakdown
                </div>
                <div className="rounded-lg bg-paper-2 border border-line px-4 py-3 space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-ink-2">{meta.label} plan</span>
                    <span className="font-mono text-[13px] text-ink">
                      EUR {(addonPreview.base_plan_cents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-ink-2">
                      Extra storage ({addonPreview.extra_storage_tb} TB)
                    </span>
                    <span className="font-mono text-[13px] text-ink">
                      EUR {(addonPreview.extra_storage_cents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="border-t border-line pt-1.5 mt-1.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[13px] font-semibold text-ink">Monthly total</span>
                      <span className="font-mono text-[15px] font-bold text-ink">
                        EUR {(addonPreview.new_monthly_total_cents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer. For a SEPA upgrade (task 0941) we offer TWO paths: charge the
                mandate (deferred, settles in a few days) OR pay now to activate
                instantly via a hosted Mollie one-off. Downgrades + non-SEPA keep the
                single Confirm. */}
            {isSepaMandate && addonPreview.is_upgrade ? (
              <div className="flex flex-col gap-2 px-5 py-4 border-t border-line">
                <BBButton
                  size="md"
                  variant="amber"
                  onClick={() => void handleStorageAddonInstantPay()}
                  disabled={addonSaving || addonInstantPayLoading}
                >
                  {addonInstantPayLoading ? 'Redirecting...' : 'Pay now to activate instantly'}
                </BBButton>
                <BBButton
                  size="md"
                  onClick={() => void handleConfirmStorageAddon()}
                  disabled={addonSaving || addonInstantPayLoading}
                >
                  {addonSaving ? 'Charging...' : 'Charge my SEPA mandate'}
                </BBButton>
                <button
                  className="mt-0.5 text-[12px] text-ink-3 hover:text-ink transition-colors disabled:opacity-50"
                  onClick={() => setAddonPreview(null)}
                  disabled={addonSaving || addonInstantPayLoading}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-line">
                <BBButton
                  size="md"
                  variant="ghost"
                  onClick={() => setAddonPreview(null)}
                  disabled={addonSaving}
                >
                  Cancel
                </BBButton>
                <BBButton
                  size="md"
                  variant="amber"
                  onClick={() => void handleConfirmStorageAddon()}
                  disabled={addonSaving}
                >
                  {addonSaving ? 'Updating...' : 'Confirm'}
                </BBButton>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
