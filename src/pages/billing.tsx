import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../components/settings-shell'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { BBToggle } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { UpgradeDialog } from '../components/upgrade-dialog'
import { DowngradeDialog } from '../components/downgrade-dialog'
import { useToast } from '../components/toast'
import {
  getSubscription,
  getInvoices,
  getPlans,
  listFiles,
  createPortalSession,
  cancelSubscription,
  reactivateSubscription,
  switchBillingCycle,
  getPreference,
  setPreference,
  getStorageAddons,
  updateStorageAddons,
  previewStorageAddons,
  type Subscription,
  type Invoice,
  type Plan,
  type DriveFile,
  type StorageAddonState,
  type StorageAddonPreview,
  cancelDowngrade,
} from '../lib/api'
import { useDriveData } from '../lib/drive-data-context'

import { formatStorageSI } from '../lib/format'
import { StorageBreakdown } from '../components/storage-breakdown'
import {
  planCanAddStorage,
  planMaxExtraTB,
  planBaseTB,
  planMonthlyCostCents,
  formatCentsAsEur,
} from '../lib/plan-pricing'
import { PlanComparisonTable } from '../components/plan-comparison'
import { PLAN_META, PLAN_RANK, getDowngradeOptions } from '../lib/plan-constants'

/* ── Plan metadata (imported from plan-constants.ts) ──── */

const planMeta = PLAN_META
const planRank = PLAN_RANK

type UpgradePlanCard = {
  id: string
  label: string
  priceMonthly: number
  priceYearly: number
  storageLabel: string
  features: string[]
  sortOrder: number
}

const fallbackUpgradePlanIds = ['basic', 'pro'] as const

/* ── Helpers ────────────────────────────────────────────── */

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Compute remaining time until a future ISO date as a human-readable string. */
function formatRemainingTime(iso: string | null): string | null {
  if (!iso) return null
  const now = new Date()
  const end = new Date(iso)
  const diffMs = end.getTime() - now.getTime()
  if (diffMs <= 0) return null

  const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const months = Math.floor(totalDays / 30)
  const days = totalDays - months * 30

  if (months >= 1 && days > 0) return `${months} month${months !== 1 ? 's' : ''}, ${days} day${days !== 1 ? 's' : ''} remaining`
  if (months >= 1) return `${months} month${months !== 1 ? 's' : ''} remaining`
  return `${totalDays} day${totalDays !== 1 ? 's' : ''} remaining`
}

/** Get the number of remaining days until an ISO date. */
function remainingDays(iso: string | null): number {
  if (!iso) return 0
  const diffMs = new Date(iso).getTime() - Date.now()
  return diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0
}

/** Plans ordered by tier, used for downgrade suggestions. */
const orderedPaidPlans = ['basic', 'pro', 'business'] as const

function invoicePdfUrl(invoice: Invoice): string | undefined {
  // TODO: Remove this fallback once the billing API settles on one invoice PDF field.
  return invoice.pdf_url ?? invoice.url
}

function formatEuro(amount: number): string {
  if (!Number.isFinite(amount)) return '€0.00'
  return `€${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`
}

function upgradeCardFromApiPlan(plan: Plan, fallbackSortOrder: number): UpgradePlanCard {
  return {
    id: plan.id,
    label: plan.name,
    priceMonthly: plan.price_eur,
    priceYearly: plan.price_yearly_eur,
    storageLabel: plan.storage_label,
    features: plan.features,
    sortOrder: plan.sort_order ?? planRank[plan.id] ?? fallbackSortOrder,
  }
}

function upgradeCardFromFallback(planId: (typeof fallbackUpgradePlanIds)[number], fallbackSortOrder: number): UpgradePlanCard {
  const meta = planMeta[planId]
  return {
    id: planId,
    label: meta.label,
    priceMonthly: meta.priceMonthly,
    priceYearly: meta.priceYearly,
    storageLabel: formatStorageSI(meta.storageGB * 1_000_000_000),
    features: meta.features,
    sortOrder: planRank[planId] ?? fallbackSortOrder,
  }
}

function upgradeCardFromPlanMeta(planId: string): UpgradePlanCard | null {
  const meta = planMeta[planId]
  if (!meta) return null
  return {
    id: planId,
    label: meta.label,
    priceMonthly: meta.priceMonthly,
    priceYearly: meta.priceYearly,
    storageLabel: formatStorageSI(meta.storageGB * 1_000_000_000),
    features: meta.features,
    sortOrder: planRank[planId] ?? 0,
  }
}

/* ── Animated progress bar ─────────────────────────────── */

function AnimatedProgress({ percent, className = '' }: { percent: number; className?: string }) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setWidth(Math.min(percent, 100)), 80)
    return () => clearTimeout(t)
  }, [percent])

  const barColor =
    percent > 90 ? 'bg-red' :
    percent > 75 ? 'bg-amber' :
    'bg-amber-deep'

  return (
    <div className={`relative h-2 rounded-full bg-paper-3 overflow-hidden ${className}`}>
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${barColor}`}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

/* ── Main component ────────────────────────────────────── */

export function Billing() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const { usage: contextUsage, planDetails: contextPlanDetails, refreshPlanDetails } = useDriveData()
  // sub comes from context; re-synced after cancel/reactivate via loadData
  const [sub, setSub] = useState<Subscription | null>(contextPlanDetails.subscription)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [files, setFiles] = useState<DriveFile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradePlan, setUpgradePlan] = useState<string>('pro')
  const [portalLoading, setPortalLoading] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [reactivateLoading, setReactivateLoading] = useState(false)
  const [showComparison, setShowComparison] = useState(false)
  // Billing cycle switch confirmation
  const [cycleSwitchConfirm, setCycleSwitchConfirm] = useState<'monthly' | 'yearly' | null>(null)
  const [cycleSwitchLoading, setCycleSwitchLoading] = useState(false)
  // Upgraded celebration card
  const showUpgraded = searchParams.get('upgraded') === 'true' || Boolean(searchParams.get('session_id'))
  const upgradedDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Storage add-on state
  const [addonState, setAddonState] = useState<StorageAddonState | null>(null)
  const [sliderTB, setSliderTB] = useState<number>(0)
  const [addonSaving, setAddonSaving] = useState(false)
  const [addonPreview, setAddonPreview] = useState<StorageAddonPreview | null>(null)
  const [addonPreviewLoading, setAddonPreviewLoading] = useState(false)

  // Downgrade state
  const [downgradeTarget, setDowngradeTarget] = useState<string | null>(null)
  const [cancellingDowngrade, setCancellingDowngrade] = useState(false)

  // Invoice preferences
  const [invoiceSendEmail, setInvoiceSendEmail] = useState(true)
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [savingInvoicePrefs, setSavingInvoicePrefs] = useState(false)

  const showSuccess = searchParams.get('success') === 'true'

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // getSubscription is fetched fresh here so cancel/reactivate flows see
      // the updated status immediately. getPlans is needed for the upgrade
      // cards section (context only stores the matched current-user plan).
      const [subData, invData, invoicePref, plansData, filesData, addonsData] = await Promise.all([
        getSubscription(),
        getInvoices().catch(() => [] as Invoice[]),
        getPreference<{ send_email: boolean; invoice_email: string }>('invoice_settings').catch(() => null),
        getPlans().catch(() => null),
        listFiles(undefined, false).catch(() => null),
        getStorageAddons().catch(() => null),
      ])
      setSub(subData)
      setInvoices(invData ?? [])
      setPlans(plansData)
      setFiles(filesData)
      if (addonsData) {
        setAddonState(addonsData)
        setSliderTB(addonsData.extra_storage_tb)
      }
      if (invoicePref) {
        setInvoiceSendEmail(invoicePref.send_email ?? true)
        setInvoiceEmail(invoicePref.invoice_email ?? '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDownloadInvoice = useCallback((invoice: Invoice) => {
    const url = invoicePdfUrl(invoice)
    if (!url) {
      showToast({ icon: 'download', title: 'Invoice unavailable', description: 'No PDF URL was provided for this invoice.', danger: true })
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [showToast])

  const handleDownloadAllInvoices = useCallback(() => {
    const urls = invoices.map(invoicePdfUrl).filter((url): url is string => Boolean(url))
    if (urls.length === 0) {
      showToast({ icon: 'download', title: 'Invoices unavailable', description: 'No PDF URLs were provided for these invoices.', danger: true })
      return
    }
    urls.forEach((url) => window.open(url, '_blank', 'noopener,noreferrer'))
  }, [invoices, showToast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Auto-dismiss the upgraded celebration card after 10 s
  useEffect(() => {
    if (!showUpgraded) return
    upgradedDismissTimer.current = setTimeout(() => {
      setSearchParams({}, { replace: true })
    }, 10_000)
    return () => {
      if (upgradedDismissTimer.current) clearTimeout(upgradedDismissTimer.current)
    }
  }, [showUpgraded, setSearchParams])

  function dismissUpgraded() {
    if (upgradedDismissTimer.current) clearTimeout(upgradedDismissTimer.current)
    setSearchParams({}, { replace: true })
  }

  // Use the effective plan for display:
  // - 'cancelling' = user cancelled but still has access until current_period_end → show actual plan
  // - 'cancelled'  = subscription has ended (period expired) → show as free
  const effectivePlan =
    sub?.status === 'cancelled' ? 'free' :
    sub?.status === 'cancelling' ? (sub.plan ?? 'free') :
    (sub?.plan ?? 'free')
  const meta = planMeta[effectivePlan] ?? planMeta.free
  const apiPlan = plans?.find(p => p.id === effectivePlan)
  const currentPriceMonthly = apiPlan?.price_eur ?? meta.priceMonthly
  const currentPriceYearly = apiPlan?.price_yearly_eur ?? meta.priceYearly
  // When addon data is available, use the effective storage (base + extra).
  // Otherwise fall back to the plan-level storage from planMeta.
  const rawTotalStorageBytes = addonState
    ? addonState.effective_storage_bytes
    : meta.storageGB * 1_000_000_000
  // Guard against NaN/undefined — show 0 rather than NaN in the UI
  const totalStorageBytes = Number.isFinite(rawTotalStorageBytes) && rawTotalStorageBytes > 0
    ? rawTotalStorageBytes
    : meta.storageGB * 1_000_000_000
  const usedBytes = contextUsage?.used_bytes ?? 0
  const usedPercent = totalStorageBytes > 0 ? (usedBytes / totalStorageBytes) * 100 : 0

  // Storage slider derived values
  const canAddStorage = planCanAddStorage(effectivePlan)
  const baseTB = addonState?.base_storage_tb || planBaseTB(effectivePlan)
  const rawMaxExtraTB = addonState
    ? addonState.max_storage_tb - addonState.base_storage_tb
    : planMaxExtraTB(effectivePlan)
  const maxExtraTB = Number.isFinite(rawMaxExtraTB) && rawMaxExtraTB > 0 ? rawMaxExtraTB : 0
  const maxTotalTB = baseTB + maxExtraTB
  const currentExtraTB = addonState?.extra_storage_tb ?? 0
  const sliderChanged = sliderTB !== currentExtraTB
  const currentCostCents = planMonthlyCostCents(effectivePlan, currentExtraTB)
  const newCostCents = planMonthlyCostCents(effectivePlan, sliderTB)
  const usedTB = Math.ceil(usedBytes / 1_000_000_000_000)
  const sliderMin = Math.max(0, usedTB - baseTB)
  const wouldReduceBelowUsage = (baseTB + sliderTB) * 1_000_000_000_000 < usedBytes

function openUpgrade(plan: string) {
    setUpgradePlan(plan)
    setUpgradeOpen(true)
  }

  function dismissSuccess() {
    setSearchParams({}, { replace: true })
  }

  async function handleCancelSubscription() {
    setCancelLoading(true)
    setCancelConfirm(false)
    try {
      await cancelSubscription()
      showToast({
        icon: 'check',
        title: 'Plan cancelled',
        description: 'Your plan remains active until the end of the billing period.',
      })
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      await loadData()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not cancel plan',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setCancelLoading(false)
    }
  }

  async function handleReactivate() {
    setReactivateLoading(true)
    try {
      const result = await reactivateSubscription()
      if (result.action === 'checkout' && result.url) {
        window.location.href = result.url
        return
      }
      showToast({ icon: 'check', title: 'Plan reactivated' })
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      await loadData()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not reactivate plan',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setReactivateLoading(false)
    }
  }

  async function handleManageBilling() {
    setPortalLoading(true)
    try {
      const result = await createPortalSession()
      if (result === null) {
        // Endpoint not yet deployed (404) — show friendly notice
        showToast({
          icon: 'cloud',
          title: 'Billing portal not available yet',
          description: 'Stripe billing is being set up. Check back soon, or email billing@beebeeb.io.',
        })
        setPortalLoading(false)
        return
      }
      // Navigate to Stripe-hosted portal (returns to /settings/billing)
      window.location.href = result.url
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Billing portal unavailable',
        description: err instanceof Error ? err.message : 'Could not open billing portal.',
        danger: true,
      })
      setPortalLoading(false)
    }
  }

  async function handlePreviewStorageAddon() {
    setAddonPreviewLoading(true)
    try {
      const preview = await previewStorageAddons({ extra_storage_tb: sliderTB })
      if (preview.requires_payment_method) {
        // Redirect to Stripe portal to add payment method
        try {
          const result = await createPortalSession()
          if (result) {
            window.location.href = result.url
            return
          }
        } catch {
          // fall through
        }
        showToast({
          icon: 'x',
          title: 'Payment method required',
          description: 'Add a payment method before upgrading storage.',
          danger: true,
        })
        return
      }
      setAddonPreview(preview)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not preview storage change',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setAddonPreviewLoading(false)
    }
  }

  async function handleConfirmStorageAddon() {
    setAddonSaving(true)
    try {
      const result = await updateStorageAddons({ extra_storage_tb: sliderTB })
      setAddonState(result)
      setAddonPreview(null)
      showToast({
        icon: 'check',
        title: 'Storage updated',
        description: `Your vault is now ${formatStorageSI(result.effective_storage_bytes)}.`,
      })
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not update storage',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setAddonSaving(false)
    }
  }

  async function handleSaveInvoicePrefs() {
    setSavingInvoicePrefs(true)
    try {
      await setPreference('invoice_settings', { send_email: invoiceSendEmail, invoice_email: invoiceEmail })
      showToast({ icon: 'check', title: 'Invoice preferences saved' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to save preferences', danger: true })
    } finally {
      setSavingInvoicePrefs(false)
    }
  }

  async function handleSwitchBillingCycle(cycle: 'monthly' | 'yearly') {
    setCycleSwitchLoading(true)
    try {
      await switchBillingCycle(cycle)
      setCycleSwitchConfirm(null)
      showToast({
        icon: 'check',
        title: cycle === 'yearly' ? 'Switched to annual billing' : 'Switched to monthly billing',
        description: cycle === 'yearly'
          ? 'Your savings start with the next billing period.'
          : 'You will be billed monthly from the next billing period.',
      })
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      await loadData()
    } catch (e) {
      showToast({
        icon: 'x',
        title: 'Failed to switch billing cycle',
        description: e instanceof Error ? e.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setCycleSwitchLoading(false)
    }
  }

  /* ── Loading state ─────────────────────────────────── */

  if (loading) {
    return (
      <SettingsShell activeSection="billing">
        <SettingsHeader title="Plan & billing" subtitle="Loading..." />
        <div className="flex items-center justify-center py-16">
          <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </SettingsShell>
    )
  }

  /* ── Error state ───────────────────────────────────── */

  if (error) {
    return (
      <SettingsShell activeSection="billing">
        <SettingsHeader title="Plan & billing" />
        <div className="py-16 text-center">
          <div className="text-sm text-red mb-2">{error}</div>
          <BBButton size="sm" variant="ghost" onClick={() => void loadData()}>Retry</BBButton>
        </div>
      </SettingsShell>
    )
  }

  /* ── Computed values for the template ──────────────── */

  const nextPlan =
    effectivePlan === 'free' ? 'basic' :
    effectivePlan === 'basic' || effectivePlan === 'personal' ? 'pro' : 'pro'

  const allUpgradePlans = plans?.length
    ? plans
        .filter((plan) => plan.id !== 'free' && plan.id !== 'business' && plan.is_active !== false)
        .map(upgradeCardFromApiPlan)
    : fallbackUpgradePlanIds.map(upgradeCardFromFallback)
  const currentSortOrder = allUpgradePlans.find((plan) => plan.id === effectivePlan)?.sortOrder ?? planRank[effectivePlan]
  const upgradePlans = allUpgradePlans
    .filter((plan) => plan.id !== effectivePlan)
    .filter((plan) => currentSortOrder === undefined || plan.sortOrder > currentSortOrder)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const nextPlanDetails = allUpgradePlans.find((plan) => plan.id === nextPlan) ?? upgradeCardFromPlanMeta(nextPlan)
  const selectedApiPlan = plans?.find((plan) => plan.id === upgradePlan)
  const upgradePlanDetails = selectedApiPlan
    ? upgradeCardFromApiPlan(selectedApiPlan, 0)
    : upgradeCardFromPlanMeta(upgradePlan)

  const billingInterval = sub?.billing_cycle === 'yearly' ? 'year' : 'month'
  const basePriceCents = currentCostCents > 0 ? currentCostCents : (sub?.billing_cycle === 'yearly' ? Math.round(currentPriceYearly * 100) : Math.round(currentPriceMonthly * 100))
  const extraStorageCostCents = currentExtraTB > 0 ? currentExtraTB * 1099 : 0
  const basePlanCents = basePriceCents - extraStorageCostCents

  /* ── Status badge ──────────────────────────────────── */

  function statusBadge() {
    if (effectivePlan === 'free') return null
    const cfg =
      sub?.status === 'cancelling' ? { bg: 'bg-amber-bg', text: 'text-amber-deep', dot: 'bg-amber-deep', label: 'Cancelling' } :
      sub?.status === 'past_due'   ? { bg: 'bg-red/10',   text: 'text-red',        dot: 'bg-red',        label: 'Past due' }   :
                                     { bg: 'bg-green/10', text: 'text-green',       dot: 'bg-green',      label: 'Active' }
    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${cfg.bg} ${cfg.text} text-[11px] font-medium`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </div>
    )
  }

  /* ── Render ────────────────────────────────────────── */

  return (
    <SettingsShell activeSection="billing">
      <SettingsHeader
        title="Plan & billing"
        subtitle={meta.tagline}
      />

      <div className="p-7 space-y-6">
        {/* Upgraded celebration card — shown after Stripe redirect */}
        {showUpgraded && (
          <div className="relative rounded-xl border border-amber/60 bg-amber-bg overflow-hidden">
            <div className="px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
                    Upgrade complete
                  </div>
                  <h2 className="text-xl font-bold text-ink leading-snug mb-1">
                    Welcome to {meta.label}
                  </h2>
                  <p className="text-[13.5px] text-ink-2 leading-relaxed mb-4">
                    Your vault just got bigger. You now have{' '}
                    <span className="font-semibold text-ink">{formatStorageSI(totalStorageBytes)}</span>{' '}
                    of encrypted storage — stored in Falkenstein, Germany.
                  </p>
                  <BBButton
                    variant="amber"
                    size="md"
                    onClick={() => { void navigate('/') }}
                  >
                    Go to my vault
                    <Icon name="chevron-right" size={13} className="ml-1.5" />
                  </BBButton>
                </div>
                <button
                  onClick={dismissUpgraded}
                  className="text-ink-3 hover:text-ink transition-colors mt-0.5 shrink-0"
                  aria-label="Dismiss"
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            </div>
            {/* Animated amber progress bar at bottom */}
            <div className="h-0.5 bg-amber/30">
              <div
                className="h-full bg-amber-deep transition-all ease-linear"
                style={{ width: '100%', animation: 'shrink-width 10s linear forwards' }}
              />
            </div>
          </div>
        )}

        {/* Success banner after Stripe checkout (legacy ?success=true) */}
        {showSuccess && (
          <div className="flex items-center gap-3 p-3.5 bg-green/10 border border-green/30 rounded-lg text-sm">
            <Icon name="check" size={14} className="text-green shrink-0" />
            <span className="flex-1">Your subscription is now active. Welcome aboard.</span>
            <button
              onClick={dismissSuccess}
              className="text-ink-3 hover:text-ink transition-colors"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {/* Past due warning banner */}
        {sub?.status === 'past_due' && (
          <div className="flex items-center gap-3 p-3.5 bg-red/10 border border-red/30 rounded-lg text-sm">
            <Icon name="x" size={14} className="text-red shrink-0" />
            <span className="flex-1">
              Your last payment failed. Update your payment method to avoid losing access.
            </span>
            <BBButton
              size="sm"
              variant="danger"
              onClick={() => void handleManageBilling()}
              disabled={portalLoading}
            >
              {portalLoading ? 'Redirecting...' : 'Update payment method'}
            </BBButton>
          </div>
        )}

        {/* ── Plan summary ──────────────────────────── */}
        <div className="grid gap-4">

          {/* Current plan card */}
          <div className="border border-line rounded-xl p-5 bg-paper relative">
            {/* Plan badge */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                  Current plan
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-[28px] font-bold tracking-tight leading-none">
                    {meta.label}
                  </span>
                  {sub?.billing_cycle === 'yearly' && effectivePlan !== 'free' && (
                    <BBChip variant="amber">Yearly</BBChip>
                  )}
                  {sub?.billing_cycle === 'monthly' && effectivePlan !== 'free' && (
                    <BBChip>Monthly</BBChip>
                  )}
                </div>
                {effectivePlan !== 'free' && (
                  <div className="mt-1.5 space-y-0.5">
                    {currentExtraTB > 0 ? (
                      <>
                        <div className="font-mono text-sm font-semibold">
                          EUR {formatCentsAsEur(basePriceCents)} / {billingInterval}
                        </div>
                        <div className="text-[11px] text-ink-3 font-mono">
                          {meta.label} EUR {formatCentsAsEur(basePlanCents)} + {currentExtraTB} TB x EUR 10.99
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-ink-3 font-mono">
                        EUR {formatCentsAsEur(basePriceCents)} / {billingInterval}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {statusBadge()}
            </div>

            {/* Storage usage */}
            <div className="mb-4">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-[11px] text-ink-4 font-medium">Storage</div>
                <div className="font-mono text-sm font-semibold">
                  {formatStorageSI(usedBytes)}
                  <span className="text-ink-3 font-normal"> / {formatStorageSI(totalStorageBytes)}</span>
                </div>
              </div>
              {currentExtraTB > 0 && (
                <div className="text-[11px] text-ink-3 mb-1.5">
                  {formatStorageSI(baseTB * 1_000_000_000_000)} base + {formatStorageSI(currentExtraTB * 1_000_000_000_000)} extra
                </div>
              )}
              <AnimatedProgress percent={usedPercent} />
              {usedPercent > 90 && (
                <div className="text-[11px] text-red mt-1.5">
                  {canAddStorage
                    ? 'Storage almost full. Add more storage below.'
                    : 'Storage almost full. Consider upgrading your plan.'}
                </div>
              )}
            </div>

            {/* Next billing / cancels on */}
            {sub?.current_period_end && effectivePlan !== 'free' && sub.status !== 'cancelling' && (
              <div className="flex items-center gap-3 p-3 bg-paper-2 border border-line rounded-lg text-xs">
                <Icon name="clock" size={13} className="text-ink-3 shrink-0" />
                <span className="flex-1">
                  Renews <strong>{formatDate(sub.current_period_end)}</strong>
                </span>
              </div>
            )}

            {/* Cancelling state — prominent remaining period display */}
            {sub?.current_period_end && sub.status === 'cancelling' && (
              <div className="rounded-lg border border-amber/40 bg-amber-bg/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Icon name="clock" size={14} className="text-amber-deep shrink-0" />
                      <span className="text-sm font-semibold text-ink">
                        {formatRemainingTime(sub.current_period_end) ?? 'Expires soon'}
                      </span>
                    </div>
                    <p className="text-xs text-ink-2 leading-relaxed">
                      Your {meta.label} plan is active until{' '}
                      <strong className="font-mono">{formatDate(sub.current_period_end)}</strong>.
                      {sub.billing_cycle === 'yearly' && remainingDays(sub.current_period_end) > 30 && (
                        <> You have pre-paid for the full year.</>
                      )}
                    </p>
                    <p className="text-xs text-ink-3">
                      After {formatDate(sub.current_period_end)}, your account drops to Free (5 GB).
                      {usedBytes > 5_000_000_000 && (
                        <> Make sure to export files above the limit.</>
                      )}
                    </p>
                  </div>
                  <BBButton
                    size="sm"
                    variant="amber"
                    onClick={() => void handleReactivate()}
                    disabled={reactivateLoading}
                  >
                    {reactivateLoading ? 'Reactivating...' : 'Reactivate'}
                  </BBButton>
                </div>
              </div>
            )}

            {/* Pending downgrade status */}
            {sub?.pending_downgrade_plan && sub?.status !== 'cancelling' && (
              <div className="rounded-lg border border-line-2 bg-paper-2 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Icon name="clock" size={14} className="text-ink-3 shrink-0" />
                      <span className="text-sm font-semibold text-ink">
                        Switching to {planMeta[sub.pending_downgrade_plan]?.label ?? sub.pending_downgrade_plan} on {formatDate(sub.current_period_end)}
                      </span>
                    </div>
                    <p className="text-xs text-ink-2">
                      You keep full {meta.label} access until then.
                    </p>
                  </div>
                  <BBButton
                    variant="default"
                    size="sm"
                    onClick={async () => {
                      setCancellingDowngrade(true)
                      try {
                        await cancelDowngrade()
                        showToast({ icon: 'check', title: `Staying on ${meta.label}` })
                        window.dispatchEvent(new Event('beebeeb:plan-changed'))
                        loadData()
                      } catch (err) {
                        showToast({ icon: 'x', title: 'Could not cancel downgrade', description: err instanceof Error ? err.message : '', danger: true })
                      } finally {
                        setCancellingDowngrade(false)
                      }
                    }}
                    disabled={cancellingDowngrade}
                  >
                    {cancellingDowngrade ? 'Keeping...' : `Keep ${meta.label}`}
                  </BBButton>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex gap-2">
              {effectivePlan === 'free' ? (
                <>
                  <BBButton
                    variant="amber"
                    size="md"
                    onClick={() => openUpgrade('basic')}
                  >
                    Upgrade to Basic
                  </BBButton>
                  <BBButton
                    size="md"
                    onClick={() => openUpgrade('pro')}
                  >
                    Explore Pro
                  </BBButton>
                </>
              ) : (
                <>
                  <BBButton
                    variant="amber"
                    size="md"
                    onClick={() => void handleManageBilling()}
                    disabled={portalLoading}
                  >
                    <Icon name="settings" size={13} className="mr-1.5" />
                    {portalLoading ? 'Redirecting...' : 'Manage billing'}
                  </BBButton>
                  {effectivePlan !== 'business' && sub?.status !== 'cancelling' && (
                    <BBButton
                      size="md"
                      onClick={() => openUpgrade(nextPlan)}
                    >
                      Upgrade to {nextPlanDetails?.label ?? planMeta[nextPlan]?.label}
                    </BBButton>
                  )}
                </>
              )}
            </div>

            {/* Cancel plan — paid plans only, not already cancelling */}
            {effectivePlan !== 'free' && sub?.status !== 'cancelling' && (
              cancelConfirm ? (
                <div className="mt-3 p-3.5 bg-red/5 border border-red/20 rounded-lg space-y-4">
                  <div className="text-[12px] font-medium text-ink">Cancel your plan?</div>

                  {/* Current plan + price summary */}
                  <div className="rounded-md bg-paper-2 border border-line px-3.5 py-3 space-y-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-ink-2">{meta.label} plan</span>
                      <span className="font-mono font-semibold text-ink">
                        EUR {formatCentsAsEur(basePriceCents)} / {billingInterval}
                      </span>
                    </div>
                    {sub?.billing_cycle === 'yearly' && sub.current_period_end && remainingDays(sub.current_period_end) > 0 && (
                      <div className="text-[11px] text-ink-3">
                        You have pre-paid EUR {currentPriceYearly.toFixed(2)} for the year.
                        Your access continues until <strong className="font-mono">{formatDate(sub.current_period_end)}</strong>.
                      </div>
                    )}
                    {sub?.billing_cycle !== 'yearly' && sub?.current_period_end && (
                      <div className="text-[11px] text-ink-3">
                        Your access continues until <strong className="font-mono">{formatDate(sub.current_period_end)}</strong>.
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-ink-3">
                    Your plan{currentExtraTB > 0 ? ` and ${currentExtraTB} TB of extra storage` : ''} will
                    end on <strong>{formatDate(sub?.current_period_end ?? null)}</strong>.
                    After that, your storage drops to <strong>5 GB</strong> (Free tier).
                  </p>

                  {usedBytes > 5_000_000_000 && (
                    <>
                      <p className="text-xs text-red">
                        You are currently using {formatStorageSI(usedBytes)} — make sure to export anything you need before your plan ends.
                      </p>
                      <div className="flex gap-2">
                        <BBButton size="sm" variant="ghost" onClick={() => { navigate('/?sort=size&order=desc'); setCancelConfirm(false); }}>
                          Review my files
                        </BBButton>
                      </div>
                    </>
                  )}

                  {/* Downgrade suggestion — offer lower paid tiers instead of cancelling */}
                  {(() => {
                    const currentRank = planRank[effectivePlan] ?? 0
                    const lowerPlans = orderedPaidPlans
                      .filter((p) => (planRank[p] ?? 0) < currentRank && (planRank[p] ?? 0) > 0)
                      .map((p) => ({ id: p, ...(planMeta[p] ?? planMeta.free) }))
                    if (lowerPlans.length === 0) return null
                    return (
                      <div className="rounded-md border border-amber/30 bg-amber-bg/30 px-3.5 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-2">
                          Instead of cancelling
                        </div>
                        <div className="space-y-2">
                          {lowerPlans.map((lp) => (
                            <button
                              key={lp.id}
                              onClick={() => { setCancelConfirm(false); setDowngradeTarget(lp.id); }}
                              className="w-full flex items-center justify-between rounded-md border border-line bg-paper px-3 py-2.5 text-left hover:border-amber/50 hover:bg-amber-bg/20 transition-colors group"
                            >
                              <div>
                                <div className="text-xs font-semibold text-ink group-hover:text-amber-deep transition-colors">
                                  Switch to {lp.label}
                                </div>
                                <div className="text-[11px] text-ink-3 font-mono mt-0.5">
                                  EUR {lp.priceMonthly.toFixed(2)}/mo — {formatStorageSI(lp.storageGB * 1_000_000_000)}
                                </div>
                              </div>
                              <Icon name="chevron-right" size={12} className="text-ink-4 group-hover:text-amber-deep transition-colors shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  <div className="flex gap-2">
                    <BBButton size="sm" onClick={() => setCancelConfirm(false)}>
                      Keep plan
                    </BBButton>
                    <BBButton
                      size="sm"
                      variant="danger"
                      onClick={() => void handleCancelSubscription()}
                      disabled={cancelLoading}
                    >
                      {cancelLoading ? 'Cancelling...' : 'Cancel plan'}
                    </BBButton>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <button
                    className="text-[11.5px] text-ink-4 hover:text-red transition-colors"
                    onClick={() => setCancelConfirm(true)}
                  >
                    Cancel plan
                  </button>
                </div>
              )
            )}
          </div>

          {/* Annual savings prompt — shown to monthly paid subscribers */}
          {sub?.billing_cycle === 'monthly' && effectivePlan !== 'free' && (
            <div className="border border-amber/30 bg-amber-bg/30 rounded-xl p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
                Save on your plan
              </div>
              <p className="text-sm text-ink-2 mb-3">
                Switch to annual billing and save{' '}
                <span className="font-semibold text-ink">
                  EUR {((currentPriceMonthly * 12 - currentPriceYearly) || 0).toFixed(2)}
                </span>{' '}
                per year.
              </p>
              <div className="flex items-center gap-4 text-xs font-mono text-ink-3 mb-3">
                <span>Monthly: EUR {currentPriceMonthly.toFixed(2)}/mo</span>
                <span>Annual: EUR {(currentPriceYearly / 12).toFixed(2)}/mo</span>
              </div>
              {cycleSwitchConfirm === 'yearly' ? (
                <div className="rounded-lg bg-paper border border-line px-4 py-3.5 space-y-3">
                  <div className="text-[12px] font-medium text-ink">Switch to annual billing?</div>
                  <div className="rounded-md bg-paper-2 border border-line px-3.5 py-3 space-y-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-ink-2">New price</span>
                      <span className="font-mono font-semibold text-ink">
                        EUR {currentPriceYearly.toFixed(2)} / year
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-3">
                      That is EUR {(currentPriceYearly / 12).toFixed(2)}/mo instead of EUR {currentPriceMonthly.toFixed(2)}/mo.
                    </div>
                  </div>
                  <p className="text-xs text-ink-3">
                    The change takes effect at the start of your next billing period.
                  </p>
                  <div className="flex gap-2">
                    <BBButton
                      size="sm"
                      onClick={() => setCycleSwitchConfirm(null)}
                      disabled={cycleSwitchLoading}
                    >
                      Cancel
                    </BBButton>
                    <BBButton
                      size="sm"
                      variant="amber"
                      onClick={() => void handleSwitchBillingCycle('yearly')}
                      disabled={cycleSwitchLoading}
                    >
                      {cycleSwitchLoading ? 'Switching...' : 'Confirm switch to annual'}
                    </BBButton>
                  </div>
                </div>
              ) : (
                <BBButton size="sm" variant="amber" onClick={() => setCycleSwitchConfirm('yearly')}>
                  Switch to annual
                </BBButton>
              )}
            </div>
          )}

          {/* Monthly switch prompt — shown to yearly paid subscribers */}
          {sub?.billing_cycle === 'yearly' && effectivePlan !== 'free' && sub.status !== 'cancelling' && (
            <div className="border border-line rounded-xl p-5 bg-paper">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                Billing cycle
              </div>
              <p className="text-sm text-ink-2 mb-3">
                Currently on annual billing at{' '}
                <span className="font-semibold text-ink font-mono">
                  EUR {currentPriceYearly.toFixed(2)}/yr
                </span>
                .{' '}
                You can switch to monthly billing at{' '}
                <span className="font-semibold text-ink font-mono">
                  EUR {currentPriceMonthly.toFixed(2)}/mo
                </span>
                .
              </p>
              {cycleSwitchConfirm === 'monthly' ? (
                <div className="rounded-lg bg-paper-2 border border-line px-4 py-3.5 space-y-3">
                  <div className="text-[12px] font-medium text-ink">Switch to monthly billing?</div>
                  <div className="rounded-md bg-paper border border-line px-3.5 py-3 space-y-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-ink-2">New price</span>
                      <span className="font-mono font-semibold text-ink">
                        EUR {currentPriceMonthly.toFixed(2)} / month
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-3">
                      Annual cost: EUR {(currentPriceMonthly * 12).toFixed(2)}/yr instead of EUR {currentPriceYearly.toFixed(2)}/yr.
                    </div>
                  </div>
                  <p className="text-xs text-ink-3">
                    The change takes effect at the start of your next billing period.
                    Your current annual period remains active until{' '}
                    <strong className="font-mono">{formatDate(sub.current_period_end ?? null)}</strong>.
                  </p>
                  <div className="flex gap-2">
                    <BBButton
                      size="sm"
                      onClick={() => setCycleSwitchConfirm(null)}
                      disabled={cycleSwitchLoading}
                    >
                      Cancel
                    </BBButton>
                    <BBButton
                      size="sm"
                      variant="amber"
                      onClick={() => void handleSwitchBillingCycle('monthly')}
                      disabled={cycleSwitchLoading}
                    >
                      {cycleSwitchLoading ? 'Switching...' : 'Confirm switch to monthly'}
                    </BBButton>
                  </div>
                </div>
              ) : (
                <BBButton size="sm" onClick={() => setCycleSwitchConfirm('monthly')}>
                  Switch to monthly
                </BBButton>
              )}
            </div>
          )}
        </div>

        {/* ── Storage breakdown ──────────────────────── */}
        {usedBytes > 0 && (
          <div className="border border-line rounded-xl p-5 bg-paper">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-3">
              Storage breakdown
            </div>
            <StorageBreakdown
              usageBytes={usedBytes}
              quotaBytes={totalStorageBytes}
              planName={effectivePlan}
              files={files ?? undefined}
            />
          </div>
        )}

        {/* ── Manage Storage slider ───────────────────── */}
        {canAddStorage && effectivePlan !== 'free' && (
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
                  {formatStorageSI((baseTB + currentExtraTB) * 1_000_000_000_000)}
                  {currentExtraTB > 0 && (
                    <span className="text-ink-3 font-normal ml-1.5">
                      ({formatStorageSI(baseTB * 1_000_000_000_000)} base + {formatStorageSI(currentExtraTB * 1_000_000_000_000)} extra)
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
                      +{sliderTB - currentExtraTB} TB x EUR {formatCentsAsEur(addonState?.storage_addon_price_cents ?? (planMonthlyCostCents(effectivePlan, 1) - planMonthlyCostCents(effectivePlan, 0)))}/TB
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

        {/* ── Upgrade CTAs ───────────────────────────── */}
        {upgradePlans.length > 0 && (
          <div className="border border-line rounded-xl overflow-hidden bg-paper">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                  Unlock more
                </div>
                <div className="text-sm text-ink-2">
                  All paid plans include encrypted storage, photo library, and EU data residency.
                </div>
              </div>
              <button
                onClick={() => setShowComparison(!showComparison)}
                className="text-[12px] text-amber-deep hover:text-amber font-medium transition-colors shrink-0 ml-4"
              >
                {showComparison ? 'Hide comparison' : 'Compare all plans'}
              </button>
            </div>
            {showComparison ? (
              <div className="p-5">
                <PlanComparisonTable currentPlan={effectivePlan} onUpgrade={openUpgrade} />
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line">
              {upgradePlans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => openUpgrade(plan.id)}
                  className="p-5 text-left hover:bg-paper-2 transition-colors cursor-pointer group"
                >
                  <div className="text-sm font-semibold mb-0.5 group-hover:text-amber-deep transition-colors">
                    {plan.label}
                  </div>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="font-mono text-lg font-bold">
                      {formatEuro(plan.priceMonthly)}
                    </span>
                    <span className="text-xs text-ink-3">/mo</span>
                  </div>
                  <div className="text-xs text-ink-3 mb-3">{plan.storageLabel}</div>
                  {plan.features.length > 0 && (
                    <ul className="space-y-1 mb-4">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex gap-1.5 text-xs leading-snug text-ink-3">
                          <span className="text-amber-deep">-</span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-deep">
                    Subscribe
                    <Icon name="chevron-right" size={10} />
                  </span>
                </button>
              ))}
            </div>
            )}
          </div>
        )}

        {/* ── Downgrade options ────────────────────── */}
        {(() => {
          if (effectivePlan === 'free') return null
          if (sub?.pending_downgrade_plan) return null
          if (sub?.status === 'cancelling') return null

          const cooldownUntil = sub?.downgrade_cooldown_until
          const inCooldown = cooldownUntil ? new Date(cooldownUntil).getTime() > Date.now() : false

          const downgradeOptions = getDowngradeOptions(effectivePlan)
            .filter((slug) => slug !== 'business')

          if (downgradeOptions.length === 0) return null

          return (
            <div className="border border-line rounded-xl overflow-hidden bg-paper">
              <div className="px-5 py-4 border-b border-line">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                  {inCooldown ? 'Downgrade unavailable' : 'Switch to a smaller plan'}
                </div>
                {inCooldown && (
                  <div className="text-sm text-ink-2">
                    You can downgrade again after {formatDate(cooldownUntil!)}.
                  </div>
                )}
              </div>
              {!inCooldown && (
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line">
                  {downgradeOptions.map((slug) => {
                    const pm = planMeta[slug]
                    if (!pm) return null
                    return (
                      <button
                        key={slug}
                        onClick={() => setDowngradeTarget(slug)}
                        className="p-5 text-left hover:bg-paper-2 transition-colors cursor-pointer group"
                      >
                        <div className="text-sm font-semibold mb-0.5 group-hover:text-ink transition-colors">
                          {pm.label}
                        </div>
                        <div className="flex items-baseline gap-1 mb-2">
                          <span className="font-mono text-lg font-bold">
                            {formatEuro(pm.priceMonthly)}
                          </span>
                          <span className="text-xs text-ink-3">/mo</span>
                        </div>
                        <div className="text-xs text-ink-3 mb-3">
                          {formatStorageSI(pm.storageGB * 1_000_000_000)}
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-3 group-hover:text-ink transition-colors">
                          Switch plan
                          <Icon name="chevron-right" size={10} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Invoices ───────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2.5 mb-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
              Invoices
            </span>
            {invoices.length > 0 && (
              <BBButton size="sm" variant="ghost" className="ml-auto" onClick={handleDownloadAllInvoices}>
                <Icon name="download" size={11} className="mr-1" />
                Download all
              </BBButton>
            )}
          </div>

          {invoices.length === 0 ? (
            <div className="border border-line rounded-xl bg-paper-2 py-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-paper border border-line flex items-center justify-center mx-auto mb-3">
                <Icon name="file-text" size={16} className="text-ink-3" />
              </div>
              <div className="text-sm text-ink-3 mb-0.5">No invoices yet</div>
              <div className="text-xs text-ink-4">
                Invoices will appear here after your first payment.
              </div>
            </div>
          ) : (
            <div className="border border-line rounded-xl overflow-x-auto">
              <div
                className="grid gap-4 px-5 py-2.5 border-b border-line bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-4 min-w-[500px]"
                style={{ gridTemplateColumns: '1.2fr 1fr 100px 100px 40px' }}
              >
                <span>Number</span>
                <span>Date</span>
                <span>Amount</span>
                <span>Status</span>
                <span />
              </div>

              {invoices.map((inv) => {
                const isPaid = inv.status === 'paid'
                const isUpcoming = inv.status === 'upcoming' || inv.status === 'open'
                return (
                  <div
                    key={inv.id}
                    className="grid gap-4 px-5 py-3 border-b border-line items-center last:border-b-0 hover:bg-paper-2/50 transition-colors min-w-[500px]"
                    style={{ gridTemplateColumns: '1.2fr 1fr 100px 100px 40px' }}
                  >
                    <span className="font-mono text-xs font-medium">{inv.number}</span>
                    <span className="text-[12.5px] text-ink-2">{formatDate(inv.date)}</span>
                    <span className="font-mono text-xs font-semibold">
                      EUR {inv.amount_eur.toFixed(2)}
                    </span>
                    <span>
                      <BBChip variant={isPaid ? 'green' : isUpcoming ? 'amber' : 'default'}>
                        {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                      </BBChip>
                    </span>
                    <div className="flex justify-end">
                      <BBButton size="sm" variant="ghost" onClick={() => handleDownloadInvoice(inv)}>
                        <Icon name="download" size={12} />
                      </BBButton>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Invoice preferences ────────────────────── */}
        <div className="border border-line rounded-xl overflow-hidden bg-paper">
          <div className="px-5 py-4 border-b border-line">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
              Invoice preferences
            </div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-ink">Send invoices via email</div>
                <div className="text-[11.5px] text-ink-3 mt-0.5">
                  Receive a PDF invoice for each payment.
                </div>
              </div>
              <BBToggle on={invoiceSendEmail} onChange={setInvoiceSendEmail} />
            </div>
            {invoiceSendEmail && (
              <div>
                <label className="text-[11.5px] text-ink-3 mb-1.5 block">
                  Invoice email
                </label>
                <BBInput
                  value={invoiceEmail}
                  onChange={(e) => setInvoiceEmail(e.target.value)}
                  placeholder="billing@company.com"
                  type="email"
                  className="max-w-[340px]"
                />
                <div className="text-[11px] text-ink-4 mt-1.5">
                  Defaults to your account email. Use a different address for a billing team.
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <BBButton
                size="sm"
                variant="amber"
                onClick={() => void handleSaveInvoicePrefs()}
                disabled={savingInvoicePrefs}
              >
                {savingInvoicePrefs ? 'Saving...' : 'Save preferences'}
              </BBButton>
            </div>
          </div>
        </div>

        {/* ── Footer: VAT + DPA + Need help ──────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-3.5 px-5 py-3.5 bg-paper-2 border border-line rounded-xl text-[11.5px] text-ink-3">
            <Icon name="shield" size={13} className="text-amber-deep shrink-0" />
            <span className="flex-1">
              All invoices are VAT-compliant (EU reverse charge). Standard DPA available.
            </span>
            <BBButton
              size="sm"
              variant="ghost"
              onClick={() => window.open('https://beebeeb.io/dpa', '_blank')}
            >
              Review DPA
            </BBButton>
          </div>

          <div className="flex items-center gap-3.5 px-5 py-3.5 border border-line rounded-xl text-[11.5px]">
            <Icon name="mail" size={13} className="text-ink-3 shrink-0" />
            <div className="flex-1">
              <span className="text-ink-2">Need help with billing?</span>
              <span className="text-ink-3 ml-1">
                Reach us at{' '}
                <a
                  href="mailto:billing@beebeeb.io"
                  className="text-amber-deep hover:underline font-medium"
                >
                  billing@beebeeb.io
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>

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
              {/* Prorated charge / credit */}
              {addonPreview.is_upgrade && addonPreview.immediate_charge_cents > 0 && (
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

            {/* Footer */}
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
          </div>
        </div>
      )}

      {/* Upgrade dialog */}
      <UpgradeDialog
        planId={upgradePlan}
        planName={upgradePlanDetails?.label ?? 'Pro'}
        pricePerSeat={upgradePlanDetails?.priceMonthly ?? 39.95}
        priceYearlySeat={upgradePlanDetails?.priceYearly ?? 383.52}
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onSuccess={() => {
          void loadData()
          window.dispatchEvent(new Event('beebeeb:plan-changed'))
        }}
      />

      {/* Downgrade dialog */}
      {downgradeTarget && (
        <DowngradeDialog
          currentPlan={effectivePlan}
          targetPlan={downgradeTarget}
          currentUsageBytes={usedBytes}
          effectiveDate={sub?.current_period_end ?? null}
          open={!!downgradeTarget}
          onClose={() => setDowngradeTarget(null)}
          onSuccess={() => {
            window.dispatchEvent(new Event('beebeeb:plan-changed'))
            loadData()
          }}
        />
      )}
    </SettingsShell>
  )
}
