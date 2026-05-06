import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import { formatStorageSI } from '../lib/format'

const DISMISS_KEY = 'bb_quota_warning_dismissed_at'
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours

interface QuotaWarningProps {
  usedBytes: number
  limitBytes: number
}

export function QuotaWarning({ usedBytes, limitBytes }: QuotaWarningProps) {
  const [dismissed, setDismissed] = useState(false)

  const usedPct = limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0

  // Check if previously dismissed within the last 24 hours
  useEffect(() => {
    const stored = localStorage.getItem(DISMISS_KEY)
    if (stored) {
      const dismissedAt = parseInt(stored, 10)
      if (Date.now() - dismissedAt < DISMISS_DURATION_MS) {
        setDismissed(true)
      } else {
        // Expired -- remove stale entry
        localStorage.removeItem(DISMISS_KEY)
      }
    }
  }, [])

  // Don't show below 80%
  if (usedPct < 80) return null

  // Don't show if dismissed (except at 100% -- always show when full)
  if (dismissed && usedPct < 100) return null

  const isFull = usedPct >= 100
  const isCritical = usedPct >= 95

  function handleDismiss() {
    setDismissed(true)
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  return (
    <div
      role="alert"
      className={`px-5 py-3 border-b flex items-center gap-3 text-sm ${
        isFull
          ? 'bg-red/10 border-red/30'
          : 'bg-amber-bg border-amber/30'
      }`}
    >
      <Icon
        name="shield"
        size={16}
        className={`shrink-0 ${isFull ? 'text-red' : 'text-amber-deep'}`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className={`font-medium ${isFull ? 'text-red' : 'text-ink'}`}>
            {isFull
              ? `Storage full. Upgrade your plan to continue uploading.`
              : isCritical
                ? `Almost full -- ${formatStorageSI(usedBytes)} of ${formatStorageSI(limitBytes)} used. New uploads will be blocked when full.`
                : `You've used ${formatStorageSI(usedBytes)} of ${formatStorageSI(limitBytes)}`}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-[3px] w-full max-w-[240px] rounded-full bg-paper-3 overflow-hidden mt-1.5">
          <div
            className={`h-full rounded-full transition-all ${
              isFull ? 'bg-red' : isCritical ? 'bg-red' : 'bg-amber'
            }`}
            style={{ width: `${Math.min(100, usedPct)}%` }}
          />
        </div>
      </div>

      <Link
        to="/billing"
        className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
          isFull
            ? 'bg-red text-paper hover:bg-red/90'
            : 'bg-amber text-ink hover:bg-amber/90'
        }`}
      >
        Upgrade
      </Link>

      {/* Dismiss button -- not shown when storage is full */}
      {!isFull && (
        <button
          onClick={handleDismiss}
          className="shrink-0 p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
          aria-label="Dismiss storage warning"
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  )
}

// ─── Utility for upload rejection ──────────────────

/**
 * Returns the remaining bytes available under the user's quota.
 * Returns null if usage data is not available.
 */
export function getRemainingBytes(
  usedBytes: number | undefined,
  limitBytes: number | undefined,
): number | null {
  if (usedBytes == null || limitBytes == null) return null
  return Math.max(0, limitBytes - usedBytes)
}
