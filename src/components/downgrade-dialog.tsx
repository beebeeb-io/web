import { useState, useCallback } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useToast } from './toast'
import { downgradePlan } from '../lib/api'
import { PLAN_META } from '../lib/plan-constants'
import { formatStorageSI } from '../lib/format'

interface DowngradeDialogProps {
  currentPlan: string
  targetPlan: string
  currentUsageBytes: number
  effectiveDate: string | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function DowngradeDialog({
  currentPlan,
  targetPlan,
  currentUsageBytes,
  effectiveDate,
  open,
  onClose,
  onSuccess,
}: DowngradeDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open)
  const { showToast } = useToast()

  const targetMeta = PLAN_META[targetPlan] ?? PLAN_META.free
  const currentMeta = PLAN_META[currentPlan] ?? PLAN_META.free
  const targetQuotaBytes = targetMeta.storageGB * 1_000_000_000
  const isOverQuota = currentUsageBytes > targetQuotaBytes
  const formattedDate = effectiveDate
    ? new Date(effectiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'end of billing period'

  const graceDeadline = effectiveDate
    ? new Date(new Date(effectiveDate).getTime() + 60 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  const handleConfirm = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await downgradePlan({ plan: targetPlan })
      showToast({
        icon: 'check',
        title: `Switching to ${targetMeta.label}`,
        description: `Your plan will change on ${formattedDate}.`,
      })
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [targetPlan, targetMeta.label, formattedDate, onSuccess, onClose, showToast])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />

      <div ref={focusTrapRef} role="dialog" aria-modal="true" aria-label={`Switch to ${targetMeta.label}`}
        className="relative w-[520px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">

        <div className="flex items-center gap-2.5 px-[22px] py-3.5 border-b border-line">
          <h3 className="text-base font-bold">Switch to {targetMeta.label}</h3>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-ink-3 hover:text-ink transition-colors">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="p-[22px] space-y-4">
          <div className="text-[13px] text-ink-2 leading-relaxed">
            <p>Your plan will change to <strong className="text-ink">{targetMeta.label}</strong> on <strong className="font-mono text-ink">{formattedDate}</strong>.</p>
            <p className="mt-1">Until then, you keep full {currentMeta.label} access.</p>
          </div>

          <div className="rounded-md border border-line bg-paper-2 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2">After {formattedDate}</div>
            <ul className="space-y-1.5 text-[12.5px] text-ink-2">
              <li className="flex gap-2">
                <Icon name="cloud" size={12} className="text-ink-3 mt-0.5 shrink-0" />
                <span>{targetMeta.label} (<span className="font-mono">{formatStorageSI(targetQuotaBytes)}</span>) at <span className="font-mono">EUR {targetMeta.priceMonthly.toFixed(2)}</span>/mo</span>
              </li>
              {targetMeta.storageGB < currentMeta.storageGB && (
                <li className="flex gap-2">
                  {/* arrow-up rotated 180deg used as arrow-down — arrow-down is not in the icon set */}
                  <Icon name="arrow-up" size={12} className="text-ink-3 mt-0.5 shrink-0 rotate-180" />
                  <span>Storage reduced from {formatStorageSI(currentMeta.storageGB * 1_000_000_000)} to {formatStorageSI(targetQuotaBytes)}</span>
                </li>
              )}
            </ul>
          </div>

          {isOverQuota && (
            <div className="rounded-md border border-red/30 bg-red/5 p-3.5">
              <div className="flex items-center gap-2 mb-2">
                {/* alert-triangle is not in the icon set — using info as the closest warning indicator */}
                <Icon name="info" size={14} className="text-red shrink-0" />
                <span className="text-[13px] font-semibold text-ink">
                  You are using {formatStorageSI(currentUsageBytes)} of {formatStorageSI(targetQuotaBytes)}
                </span>
              </div>
              <ul className="space-y-1 text-[12.5px] text-ink-2 ml-[22px]">
                <li>Uploads are blocked until you are under {formatStorageSI(targetQuotaBytes)}</li>
                <li>You have 60 days to reduce your storage</li>
                {graceDeadline && (
                  <li>After {graceDeadline}, your oldest files will be automatically deleted until you are under the limit</li>
                )}
                <li>Starred files are deleted last</li>
              </ul>
            </div>
          )}

          {error && (
            <div className="text-sm text-red text-center">{error}</div>
          )}

          <BBButton
            variant={isOverQuota ? 'danger' : 'default'}
            size="lg"
            className="w-full justify-center"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading
              ? 'Processing...'
              : isOverQuota
              ? `I understand, switch to ${targetMeta.label}`
              : 'Confirm switch'}
          </BBButton>
        </div>
      </div>
    </div>
  )
}
