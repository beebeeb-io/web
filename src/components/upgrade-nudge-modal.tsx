/**
 * Upgrade nudge modal — shown when the user hits 80% or 100% storage quota.
 *
 * Rules:
 *   - Triggers at used/quota >= 0.80
 *   - Auto-recommends the next plan tier (free → basic → pro → business)
 *   - "Upgrade now" creates a Stripe Checkout session directly
 *   - "View all plans" navigates to /billing
 *   - Shown once per browser session (sessionStorage flag)
 *   - Top-of-drive banner at 100% is always visible (separate export)
 */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { createCheckoutSession } from '../lib/api'
import { formatBytes } from '../lib/format'

// ── Plan metadata ────────────────────────────────────────────────────────────
// Mirrors billing.tsx planMeta — keep in sync if prices change.

interface PlanInfo {
  label: string
  priceMonthly: number
  priceYearly: number
  storageGB: number
}

const PLAN_INFO: Record<string, PlanInfo> = {
  free:     { label: 'Free',     priceMonthly: 0,      priceYearly: 0,        storageGB: 5 },
  basic:    { label: 'Basic',    priceMonthly: 8.99,   priceYearly: 86.30,    storageGB: 1000 },
  pro:      { label: 'Pro',      priceMonthly: 39.95,  priceYearly: 383.52,   storageGB: 5000 },
  business: { label: 'Business', priceMonthly: 139.80, priceYearly: 1342.08,  storageGB: 20000 },
  // Legacy slug aliases: the server is migrating personal → basic and
  // data_hoarder → business. Keep entries here so live data on older sessions
  // still resolves to the new label.
  personal:     { label: 'Basic',    priceMonthly: 8.99,   priceYearly: 86.30,    storageGB: 1000 },
  data_hoarder: { label: 'Business', priceMonthly: 139.80, priceYearly: 1342.08,  storageGB: 20000 },
}

const UPGRADE_CHAIN: Record<string, string> = {
  free:  'basic',
  basic: 'pro',
  pro:   'business',
  // Legacy slug aliases.
  personal:     'pro',
  data_hoarder: 'business',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_KEY = 'beebeeb_upgrade_nudge_dismissed'

function storageLabel(gb: number): string {
  return gb >= 1000 ? `${gb / 1000} TB` : `${gb} GB`
}

function multiplierLabel(currentGB: number, nextGB: number): string {
  const x = Math.round(nextGB / currentGB)
  return x > 1 ? `${x}x the storage` : ''
}

// ── Nudge gate ────────────────────────────────────────────────────────────────

/**
 * Returns true if the upgrade nudge modal should be shown.
 * Checks quota threshold (>= 80%) and sessionStorage dismissal flag.
 */
export function shouldShowUpgradeNudge(usedBytes: number, quotaBytes: number): boolean {
  if (quotaBytes <= 0) return false
  if (usedBytes / quotaBytes < 0.8) return false
  try {
    if (sessionStorage.getItem(SESSION_KEY) === '1') return false
  } catch { /* ignore — private mode */ }
  return true
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export interface UpgradeNudgeModalProps {
  usedBytes: number
  quotaBytes: number
  /** Plan slug from /api/v1/files/usage — e.g. "free", "basic" */
  currentPlan: string
  onClose: () => void
}

export function UpgradeNudgeModal({
  usedBytes,
  quotaBytes,
  currentPlan,
  onClose,
}: UpgradeNudgeModalProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const nextSlug = UPGRADE_CHAIN[currentPlan] ?? null
  const currentInfo = PLAN_INFO[currentPlan] ?? PLAN_INFO.free
  const nextInfo = nextSlug ? PLAN_INFO[nextSlug] : null

  const pctUsed = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0

  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(SESSION_KEY, '1') } catch { /* ignore */ }
    onClose()
  }, [onClose])

  const handleUpgrade = useCallback(async () => {
    if (!nextSlug) return
    setLoading(true)
    setCheckoutError(null)
    try {
      const { url } = await createCheckoutSession({
        plan: nextSlug,
        billing_cycle: 'yearly',
        seats: 1,
      })
      window.location.href = url
    } catch (err) {
      // Stripe not configured or error — fall through to billing page
      setLoading(false)
      setCheckoutError(err instanceof Error ? err.message : 'Could not start checkout')
      navigate('/billing')
    }
  }, [nextSlug, navigate])

  const handleViewPlans = useCallback(() => {
    dismiss()
    navigate('/billing')
  }, [dismiss, navigate])

  // Can't upgrade beyond top tier
  if (!nextInfo) return null

  const mult = multiplierLabel(currentInfo.storageGB, nextInfo.storageGB)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px]"
        onClick={dismiss}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-label={`Upgrade to ${nextInfo.label}`}
      >
        <div className="pointer-events-auto w-full max-w-[460px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">

          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-3">
            <div className="pr-2">
              <p className="text-[12.5px] text-ink-3 mb-1 leading-snug">
                You've used{' '}
                <span className="font-semibold text-ink">{pctUsed}%</span>
                {' '}of your{' '}
                <span className="font-semibold text-ink">{formatBytes(quotaBytes)}</span>
                {' '}{currentInfo.label} storage
              </p>
              <h2 className="text-[17px] font-bold text-ink">
                Upgrade to {nextInfo.label}
              </h2>
            </div>
            <button
              onClick={dismiss}
              className="text-ink-4 hover:text-ink transition-colors p-0.5 mt-0.5 shrink-0"
              aria-label="Dismiss"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Plan callout */}
          <div className="mx-5 mb-4 rounded-lg bg-amber-bg border border-amber/30 px-4 py-3.5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[15px] font-bold text-ink">{nextInfo.label}</div>
                <div className="text-[13px] text-ink-2 mt-0.5">
                  {storageLabel(nextInfo.storageGB)} storage
                  {mult && (
                    <span className="ml-1.5 text-[11px] font-semibold text-amber-deep">
                      — {mult}
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-ink-3 mt-1.5">
                  Same encryption. Same EU hosting.
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-[18px] font-bold text-ink leading-none">
                  {nextInfo.priceMonthly === 0 ? 'Free' : `€${nextInfo.priceMonthly.toFixed(2)}`}
                  {nextInfo.priceMonthly > 0 && (
                    <span className="text-[12px] font-normal text-ink-3">/mo</span>
                  )}
                </div>
                {nextInfo.priceYearly > 0 && (
                  <div className="font-mono text-[10.5px] text-ink-4 mt-1">
                    €{nextInfo.priceYearly.toFixed(2)}/yr billed annually
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Error */}
          {checkoutError && (
            <p className="px-5 pb-3 text-[12px] text-red">{checkoutError}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2.5 px-5 pb-5">
            <BBButton
              variant="amber"
              size="lg"
              className="flex-1 justify-center"
              onClick={() => void handleUpgrade()}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 inline-block shrink-0" />
                  Redirecting…
                </>
              ) : (
                'Upgrade now'
              )}
            </BBButton>
            <BBButton variant="ghost" size="lg" onClick={handleViewPlans} disabled={loading}>
              View all plans
            </BBButton>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Storage-full banner ───────────────────────────────────────────────────────

export interface StorageFullBannerProps {
  currentPlan: string
  onUpgrade: () => void
}

/**
 * Persistent full-width amber banner shown when storage is at 100%.
 * Shown regardless of the session dismissal flag (always visible when full).
 */
export function StorageFullBanner({ currentPlan, onUpgrade }: StorageFullBannerProps) {
  const navigate = useNavigate()
  const nextSlug = UPGRADE_CHAIN[currentPlan] ?? null
  const nextInfo = nextSlug ? PLAN_INFO[nextSlug] : null

  return (
    <div
      className="px-5 py-2.5 border-b border-amber/40 bg-amber flex items-center gap-3"
      role="alert"
    >
      <Icon name="upload" size={13} className="text-ink shrink-0" />
      <span className="text-[13px] font-medium text-ink flex-1">
        Storage full — uploads are paused.
      </span>
      {nextInfo ? (
        <button
          onClick={onUpgrade}
          className="shrink-0 text-[12.5px] font-semibold text-ink underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          Upgrade to {nextInfo.label}
        </button>
      ) : (
        <button
          onClick={() => navigate('/billing')}
          className="shrink-0 text-[12.5px] font-semibold text-ink underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          View plans
        </button>
      )}
    </div>
  )
}
