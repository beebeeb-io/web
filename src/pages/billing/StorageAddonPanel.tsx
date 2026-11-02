/**
 *  The "Manage storage" slider of the change view: the range input, the live
 *  price, the below-usage warning and the Update/Reset actions. Moved verbatim
 *  out of the page (task W run 5).
 */

import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { formatStorageSI } from '../../lib/format'
import { formatCentsAsEur } from '../../lib/billing/money'
import { useBillingModel } from './model-context'

export function StorageAddonPanel() {
  const {
    navigate,
    noCardTrial,
    addonState,
    sliderTB,
    setSliderTB,
    addonSaving,
    addonPreviewLoading,
    addonPending,
    effectivePlan,
    meta,
    usedBytes,
    canAddStorage,
    baseTB,
    maxExtraTB,
    maxTotalTB,
    currentExtraTB,
    currentTotalStorageBytes,
    currentAllocation,
    sliderChanged,
    addonRateCents,
    currentCostCents,
    newCostCents,
    usedTB,
    sliderMin,
    wouldReduceBelowUsage,
    handlePreviewStorageAddon,
  } = useBillingModel()
  return (
    <>
        {/* ── Manage Storage slider ───────────────────── */}
        {canAddStorage && effectivePlan !== 'free' && !noCardTrial && (
          <div className="border border-line rounded-xl overflow-hidden bg-paper">
            <div className="px-5 py-4 border-b border-line">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                Manage storage
              </div>
              <div className="text-sm text-ink-2">
                Add extra encrypted storage to your {meta.label} plan.
              </div>
            </div>
            <div className="px-5 py-5 space-y-5">
              {/* Current allocation */}
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-ink-2">Current total</span>
                <span className="font-mono text-sm font-semibold text-ink">
                  {formatStorageSI(currentTotalStorageBytes)}
                  {/* Task 1706 review #132-B — the parenthetical must reconcile
                      with the displayed total: a bonus-inclusive server total is
                      larger than base+extra, so the unexplained remainder is
                      rendered as a neutral "additional storage" term (no web
                      payload exposes a bonus-specific field), and when the parts
                      exceed the total the parenthetical is omitted instead of
                      contradicting the number next to it. */}
                  {currentAllocation.show && (
                    <span className="text-ink-3 font-normal ml-1.5">
                      ({formatStorageSI(currentAllocation.baseBytes)} base
                      {currentAllocation.extraBytes != null && ` + ${formatStorageSI(currentAllocation.extraBytes)} extra`}
                      {currentAllocation.remainderBytes != null &&
                        ` + ${formatStorageSI(currentAllocation.remainderBytes)} additional storage`}
                      )
                    </span>
                  )}
                </span>
              </div>

              {/* Slider */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[12px] text-ink-3">Total storage</span>
                  <span className="font-mono text-sm font-bold text-ink">
                    {formatStorageSI((baseTB + sliderTB) * 1_000_000_000_000)}
                  </span>
                </div>
                <input
                  type="range"
                  min={sliderMin}
                  max={maxExtraTB}
                  step={1}
                  value={sliderTB}
                  onChange={(e) => setSliderTB(Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-paper-3 accent-amber"
                  style={{
                    background: `linear-gradient(to right, oklch(0.82 0.17 84) 0%, oklch(0.82 0.17 84) ${maxExtraTB > 0 ? (sliderTB / maxExtraTB) * 100 : 0}%, var(--color-paper-3) ${maxExtraTB > 0 ? (sliderTB / maxExtraTB) * 100 : 0}%, var(--color-paper-3) 100%)`,
                  }}
                />
                <div className="flex justify-between text-[10px] text-ink-4 font-mono mt-1">
                  <span>{formatStorageSI(baseTB * 1_000_000_000_000)}</span>
                  <span>{formatStorageSI(maxTotalTB * 1_000_000_000_000)}</span>
                </div>
                {usedTB > baseTB && (
                  <div className="text-[11px] text-ink-3 mt-1">
                    You're using {formatStorageSI(usedBytes)}. Delete files to reduce below {formatStorageSI(usedTB * 1_000_000_000_000)}.
                  </div>
                )}
              </div>

              {/* Live price preview */}
              {sliderChanged && (
                <div className="rounded-lg bg-paper-2 border border-line px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-ink-2">Monthly price</span>
                    <div className="text-right">
                      <span className="font-mono text-[13px] text-ink-3 line-through mr-2">
                        EUR {formatCentsAsEur(currentCostCents)}/mo
                      </span>
                      <span className="font-mono text-[15px] font-bold text-ink">
                        EUR {formatCentsAsEur(newCostCents)}/mo
                      </span>
                    </div>
                  </div>
                  {sliderTB > currentExtraTB && (
                    <div className="text-[11px] text-ink-3 mt-1 font-mono">
                      +{sliderTB - currentExtraTB} TB x EUR {formatCentsAsEur(addonState?.storage_addon_price_cents ?? addonRateCents)}/TB
                    </div>
                  )}
                  {sliderTB < currentExtraTB && (
                    <div className="text-[11px] text-ink-3 mt-1 font-mono">
                      -{currentExtraTB - sliderTB} TB removed
                    </div>
                  )}
                </div>
              )}

              {/* Warning if reducing below usage */}
              {wouldReduceBelowUsage && sliderChanged && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-red/10 border border-red/20 rounded-lg">
                  <Icon name="shield" size={13} className="text-red shrink-0" />
                  <div className="flex-1">
                    <span className="text-[12px] text-red leading-snug">
                      You are using {formatStorageSI(usedBytes)} — reducing to {formatStorageSI((baseTB + sliderTB) * 1_000_000_000_000)} would exceed your new quota. Delete or move files first.
                    </span>
                    <div className="mt-1">
                      <button className="text-[11px] underline text-ink-3 hover:text-ink" onClick={() => navigate('/?sort=size&order=desc')}>
                        Review files by size
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Deferred SEPA upgrade pending (task 0941) — the mandate was charged
                  but the grant settles in a few days. Honest "pending" state until
                  the webhook confirms. */}
              {addonPending && (
                <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-amber-bg/40 border border-amber/30 rounded-lg">
                  <Icon name="clock" size={13} className="text-amber-deep shrink-0 mt-0.5" />
                  <span className="text-[12px] text-ink-2 leading-snug">
                    Storage upgrade pending — your SEPA mandate is being charged. The
                    extra storage activates in a few days, once the payment settles.
                  </span>
                </div>
              )}

              {/* Action */}
              <div className="flex items-center gap-3">
                <BBButton
                  variant="amber"
                  size="md"
                  onClick={() => void handlePreviewStorageAddon()}
                  disabled={!sliderChanged || addonSaving || addonPreviewLoading || wouldReduceBelowUsage}
                >
                  {addonPreviewLoading ? 'Loading preview...' : addonSaving ? 'Updating...' : 'Update storage'}
                </BBButton>
                {sliderChanged && (
                  <button
                    className="text-[12px] text-ink-3 hover:text-ink transition-colors"
                    onClick={() => setSliderTB(currentExtraTB)}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
    </>
  )
}
