import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../components/settings-shell'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { BBToggle } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { UpgradeDialog } from '../components/upgrade-dialog'
import { useToast } from '../components/toast'
import {
  getSubscription,
  getInvoices,
  getStorageUsage,
  getPlans,
  createPortalSession,
  cancelSubscription,
  reactivateSubscription,
  getPreference,
  setPreference,
  type Subscription,
  type Invoice,
  type Plan,
  type StorageUsage,
} from '../lib/api'
import { formatStorageSI } from '../lib/format'
import { StorageBreakdown } from '../components/storage-breakdown'

/* ── Plan metadata ─────────────────────────────────────── */

const planMeta: Record<string, {
  label: string
  priceMonthly: number
  priceYearly: number
  /** Storage in GB (for display — passed to formatStorageSI) */
  storageGB: number
  tagline: string
  features: string[]
}> = {
  free:         { label: 'Free',         priceMonthly: 0,      priceYearly: 0,       storageGB: 5,     tagline: 'Get started with encrypted storage', features: ['Encrypted storage', 'Photo library'] },
  personal:     { label: 'Personal',     priceMonthly: 8.99,   priceYearly: 86.30,   storageGB: 1000,  tagline: '1 TB of truly private storage', features: ['Everything in Free', '30-day version history'] },
  pro:          { label: 'Pro',          priceMonthly: 39.95,  priceYearly: 383.52,  storageGB: 5000,  tagline: '5 TB for power users and creators', features: ['Everything in Personal', '5 TB encrypted storage', 'Unlimited version history', 'Advanced sharing controls'] },
  data_hoarder: { label: 'Data Hoarder', priceMonthly: 139.80, priceYearly: 1342.08, storageGB: 20000, tagline: '20 TB — lowest per-TB price', features: ['Everything in Pro', '20 TB encrypted storage'] },
  // Legacy plan IDs kept for users on old subscriptions
  team:         { label: 'Team',         priceMonthly: 6,      priceYearly: 58,      storageGB: 2000,  tagline: 'Legacy team plan', features: ['Legacy team storage'] },
  business:     { label: 'Business',     priceMonthly: 12,     priceYearly: 115,     storageGB: 5000,  tagline: 'Legacy business plan', features: ['Legacy business storage'] },
}

type UpgradePlanCard = {
  id: string
  label: string
  priceMonthly: number
  priceYearly: number
  storageLabel: string
  features: string[]
  sortOrder: number
}

const fallbackUpgradePlanIds = ['personal', 'pro', 'data_hoarder'] as const
const planRank: Record<string, number> = {
  free: 0,
  personal: 1,
  team: 1.5,
  pro: 2,
  business: 2.5,
  data_hoarder: 3,
}

/* ── Helpers ────────────────────────────────────────────── */

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function invoicePdfUrl(invoice: Invoice): string | undefined {
  // TODO: Remove this fallback once the billing API settles on one invoice PDF field.
  return invoice.pdf_url ?? invoice.url
}

function formatEuro(amount: number): string {
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
  const [sub, setSub] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [storage, setStorage] = useState<StorageUsage | null>(null)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradePlan, setUpgradePlan] = useState<string>('pro')
  const [portalLoading, setPortalLoading] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [reactivateLoading, setReactivateLoading] = useState(false)

  // Invoice preferences
  const [invoiceSendEmail, setInvoiceSendEmail] = useState(true)
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [savingInvoicePrefs, setSavingInvoicePrefs] = useState(false)

  const showSuccess = searchParams.get('success') === 'true'

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [subData, invData, storageData, invoicePref, plansData] = await Promise.all([
        getSubscription(),
        getInvoices(),
        getStorageUsage().catch(() => null),
        getPreference<{ send_email: boolean; invoice_email: string }>('invoice_settings').catch(() => null),
        getPlans().catch(() => null),
      ])
      setSub(subData)
      setInvoices(invData)
      setStorage(storageData)
      setPlans(plansData)
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

  // Use the effective plan for display: cancelled → show as free
  const effectivePlan = sub?.status === 'cancelled' ? 'free' : (sub?.plan ?? 'free')
  const meta = planMeta[effectivePlan] ?? planMeta.free
  const totalStorageGB = meta.storageGB
  const totalStorageBytes = totalStorageGB * 1024 * 1024 * 1024
  const usedBytes = storage?.used_bytes ?? 0
  const usedPercent = totalStorageBytes > 0 ? (usedBytes / totalStorageBytes) * 100 : 0

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
    effectivePlan === 'free' ? 'personal' :
    effectivePlan === 'personal' ? 'pro' :
    effectivePlan === 'pro' ? 'data_hoarder' : 'data_hoarder'

  const allUpgradePlans = plans?.length
    ? plans
        .filter((plan) => plan.id !== 'free' && plan.is_active !== false)
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

  const priceDisplay = effectivePlan === 'free'
    ? null
    : sub?.billing_cycle === 'yearly'
      ? `${meta.priceYearly.toFixed(2)} / year`
      : `${meta.priceMonthly.toFixed(2)} / month`

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
        {/* Success banner after Stripe checkout */}
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
                {priceDisplay && (
                  <div className="text-xs text-ink-3 mt-1 font-mono">
                    EUR {priceDisplay}
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
                  <span className="text-ink-3 font-normal"> / {formatStorageSI(totalStorageGB * 1_000_000_000)}</span>
                </div>
              </div>
              <AnimatedProgress percent={usedPercent} />
              {usedPercent > 90 && (
                <div className="text-[11px] text-red mt-1.5">
                  Storage almost full. Consider upgrading your plan.
                </div>
              )}
            </div>

            {/* Next billing / cancels on */}
            {sub?.current_period_end && effectivePlan !== 'free' && (
              <div className="flex items-center gap-3 p-3 bg-paper-2 border border-line rounded-lg text-xs">
                <Icon name="clock" size={13} className="text-ink-3 shrink-0" />
                <span className="flex-1">
                  {sub.status === 'cancelling'
                    ? <>Cancels <strong>{formatDate(sub.current_period_end)}</strong></>
                    : <>Renews <strong>{formatDate(sub.current_period_end)}</strong></>
                  }
                </span>
                {sub.status === 'cancelling' && (
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleReactivate()}
                    disabled={reactivateLoading}
                  >
                    {reactivateLoading ? 'Reactivating...' : 'Reactivate'}
                  </BBButton>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex gap-2">
              {effectivePlan === 'free' ? (
                <>
                  <BBButton
                    variant="amber"
                    size="md"
                    onClick={() => openUpgrade('personal')}
                  >
                    Upgrade to Personal
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
                <div className="mt-3 p-3.5 bg-red/5 border border-red/20 rounded-lg">
                  <div className="text-[12px] font-medium text-ink mb-1">Cancel your plan?</div>
                  <div className="text-[11.5px] text-ink-3 mb-3 leading-relaxed">
                    Your plan will remain active until {formatDate(sub?.current_period_end ?? null)}.
                    After that, your account will be downgraded to Free.
                  </div>
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
            />
          </div>
        )}

        {/* ── Upgrade CTAs ───────────────────────────── */}
        {upgradePlans.length > 0 && (
          <div className="border border-line rounded-xl overflow-hidden bg-paper">
            <div className="px-5 py-4 border-b border-line">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                Unlock more
              </div>
              <div className="text-sm text-ink-2">
                All paid plans include encrypted storage, photo library, and EU data residency.
              </div>
            </div>
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
          </div>
        )}

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
            <div className="border border-line rounded-xl overflow-hidden">
              <div
                className="grid gap-4 px-5 py-2.5 border-b border-line bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-4"
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
                    className="grid gap-4 px-5 py-3 border-b border-line items-center last:border-b-0 hover:bg-paper-2/50 transition-colors"
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
    </SettingsShell>
  )
}
