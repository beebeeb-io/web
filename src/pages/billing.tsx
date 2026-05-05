import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
// Type-only import — no side effects, does NOT load the Stripe.js script
import type { Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { SettingsShell, SettingsHeader } from '../components/settings-shell'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { BBToggle } from '../components/bb-toggle'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'
import { UpgradeDialog } from '../components/upgrade-dialog'
import { useToast } from '../components/toast'
import { allowsFunctional, setConsent } from '../lib/consent'
import {
  getSubscription,
  getInvoices,
  getStorageUsage,
  createPortalSession,
  getPaymentMethod,
  cancelSubscription,
  reactivateSubscription,
  createSetupIntent,
  getPreference,
  setPreference,
  getApiUrl,
  type Subscription,
  type Invoice,
  type StorageUsage,
  type PaymentMethod,
} from '../lib/api'
import { formatStorageSI } from '../lib/format'
import { StorageBreakdown, type StorageSegment } from '../components/storage-breakdown'

/* ── Stripe publishable key ────────────────────────────── */
// NOTE: Do NOT call loadStripe() here at module level.  Module-level calls
// are evaluated whenever this file is imported, which would inject the
// Stripe.js script on every page in the same bundle — causing r.stripe.com
// requests on /drive, /photos, etc.
// Instead we use a lazy useState initializer inside the Billing component so
// Stripe.js only loads when the user actually navigates to /billing.
const STRIPE_PK = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)
  || 'pk_live_51TS19oRS0saULmbDLcvwYgZSxJmSwnCMhvZDKt98q3VmNRxENbr7fHlnDRdPzv2nIEdLPUJcGpFuMxL0DgLLYjjR00hIrdQ8G7'

/* ── Plan metadata ─────────────────────────────────────── */

const planMeta: Record<string, {
  label: string
  priceMonthly: number
  priceYearly: number
  /** Storage in GB (for display — passed to formatStorageSI) */
  storageGB: number
  tagline: string
}> = {
  free:         { label: 'Free',         priceMonthly: 0,      priceYearly: 0,       storageGB: 5,     tagline: 'Get started with encrypted storage' },
  personal:     { label: 'Personal',     priceMonthly: 8.99,   priceYearly: 86.30,   storageGB: 1000,  tagline: '1 TB of truly private storage' },
  pro:          { label: 'Pro',          priceMonthly: 39.95,  priceYearly: 383.52,  storageGB: 5000,  tagline: '5 TB for power users and creators' },
  data_hoarder: { label: 'Data Hoarder', priceMonthly: 139.80, priceYearly: 1342.08, storageGB: 20000, tagline: '20 TB — lowest per-TB price' },
  // Legacy plan IDs kept for users on old subscriptions
  team:         { label: 'Team',         priceMonthly: 6,      priceYearly: 58,      storageGB: 2000,  tagline: 'Legacy team plan' },
  business:     { label: 'Business',     priceMonthly: 12,     priceYearly: 115,     storageGB: 5000,  tagline: 'Legacy business plan' },
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

/* ── Stripe Payment Setup Form ─────────────────────────── */

function PaymentSetupForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const { showToast } = useToast()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    try {
      const { error } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.origin + '/billing' },
        redirect: 'if_required',
      })
      if (error) {
        showToast({ icon: 'x', title: 'Payment setup failed', description: error.message, danger: true })
      } else {
        showToast({ icon: 'check', title: 'Payment method saved' })
        onSuccess()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 mt-3">
      <PaymentElement options={{ layout: 'tabs' }} />
      <div className="flex gap-2">
        <BBButton type="submit" variant="amber" size="sm" disabled={!stripe || submitting}>
          {submitting ? 'Saving...' : 'Save payment method'}
        </BBButton>
        <BBButton type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</BBButton>
      </div>
    </form>
  )
}

/* ── Main component ────────────────────────────────────── */

export function Billing() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const [sub, setSub] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [storage, setStorage] = useState<StorageUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradePlan, setUpgradePlan] = useState<string>('pro')
  const [portalLoading, setPortalLoading] = useState(false)
  const [payment, setPayment] = useState<PaymentMethod | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [reactivateLoading, setReactivateLoading] = useState(false)
  const [showPaymentSetup, setShowPaymentSetup] = useState(false)
  const [setupSecret, setSetupSecret] = useState<string | null>(null)
  const [setupLoading, setSetupLoading] = useState(false)

  // Consent-gated Stripe initializer.
  // Stripe.js (and r.stripe.com requests) only load when:
  //   1. The user is on /billing (lazy mount — already guaranteed), AND
  //   2. They have consented to functional cookies ('all').
  // If they chose 'essential only', stripePromise stays null and the UI shows
  // a notice with a session-allow button.
  const [stripeFunctionalAllowed, setStripeFunctionalAllowed] = useState(allowsFunctional)
  const [stripePromise] = useState<Promise<Stripe | null>>(() => {
    if (!allowsFunctional()) return Promise.resolve(null)
    return import('@stripe/stripe-js').then(({ loadStripe }) => loadStripe(STRIPE_PK))
  })
  const stripeLoadedRef = useRef<boolean>(false)

  // Invoice preferences
  const [invoiceSendEmail, setInvoiceSendEmail] = useState(true)
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [savingInvoicePrefs, setSavingInvoicePrefs] = useState(false)

  const showSuccess = searchParams.get('success') === 'true'

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [subData, invData, storageData, paymentData, invoicePref] = await Promise.all([
        getSubscription(),
        getInvoices(),
        getStorageUsage().catch(() => null),
        getPaymentMethod().catch(() => null),
        getPreference<{ send_email: boolean; invoice_email: string }>('invoice_settings').catch(() => null),
      ])
      setSub(subData)
      setInvoices(invData)
      setStorage(storageData)
      setPayment(paymentData)
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

  const storageSegments: StorageSegment[] = usedBytes > 0 ? [
    { label: 'Files', bytes: Math.round(usedBytes * 0.55), color: 'oklch(0.66 0.15 72)' },
    { label: 'Photos', bytes: Math.round(usedBytes * 0.30), color: 'oklch(0.72 0.16 155)' },
    { label: 'Shared', bytes: Math.round(usedBytes * 0.15), color: 'oklch(0.70 0.14 250)' },
  ] : []

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
      await reactivateSubscription()
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

  async function handleAddPaymentMethod() {
    setSetupLoading(true)
    try {
      const { client_secret } = await createSetupIntent()
      setSetupSecret(client_secret)
      setShowPaymentSetup(true)
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not initialize payment setup',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setSetupLoading(false)
    }
  }

  function handlePaymentSetupSuccess() {
    setShowPaymentSetup(false)
    setSetupSecret(null)
    void loadData()
  }

  function handlePaymentSetupCancel() {
    setShowPaymentSetup(false)
    setSetupSecret(null)
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
              onClick={() => void handleAddPaymentMethod()}
              disabled={setupLoading || showPaymentSetup}
            >
              {setupLoading ? 'Loading...' : 'Update payment method'}
            </BBButton>
          </div>
        )}

        {/* ── Plan summary + Payment methods ─────────── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1.2fr 1fr' }}>

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
                      Upgrade to {planMeta[nextPlan]?.label}
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

          {/* Payment method */}
          <div className="border border-line rounded-xl p-5 bg-paper flex flex-col">
            <div className="flex items-center mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                Payment method
              </div>
            </div>

            {effectivePlan === 'free' ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
                <div className="w-10 h-10 rounded-xl bg-paper-2 border border-line flex items-center justify-center mb-3">
                  <Icon name="shield" size={16} className="text-ink-3" />
                </div>
                <div className="text-sm text-ink-3 mb-1">No payment method needed</div>
                <div className="text-xs text-ink-4">
                  Upgrade to add a payment method and unlock more storage.
                </div>
              </div>
            ) : showPaymentSetup && !stripeFunctionalAllowed ? (
              /* Stripe blocked by consent — ask user to allow for this session */
              <div className="flex flex-col gap-3 p-4 rounded-lg border border-line bg-paper-2">
                <div className="flex items-start gap-2.5">
                  <Icon name="lock" size={13} className="text-ink-3 shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-ink-2 leading-relaxed">
                    Payment processing requires Stripe cookies. You chose to allow essential cookies only.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConsent('all')
                      setStripeFunctionalAllowed(true)
                      stripeLoadedRef.current = true
                      // Reload the page so the Stripe Promise initializer re-runs
                      window.location.reload()
                    }}
                    className="text-[12.5px] font-medium text-amber-deep hover:underline"
                  >
                    Allow payment cookies for this session
                  </button>
                  <span className="text-ink-4 text-[12px]">·</span>
                  <button
                    type="button"
                    onClick={() => setShowPaymentSetup(false)}
                    className="text-[12.5px] text-ink-3 hover:text-ink transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[11px] text-ink-4">
                  Stripe processes the payment — Beebeeb never sees your card details.{' '}
                  <a href="/cookies" className="underline hover:text-ink-3">Cookie details</a>
                </p>
              </div>
            ) : showPaymentSetup && setupSecret ? (
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret: setupSecret,
                  appearance: { theme: 'flat', variables: { fontFamily: 'Inter, sans-serif', borderRadius: '6px' } },
                }}
              >
                <PaymentSetupForm onSuccess={handlePaymentSetupSuccess} onCancel={handlePaymentSetupCancel} />
              </Elements>
            ) : payment ? (
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-3 p-3 rounded-lg border border-line bg-paper-2">
                  <div className="w-[36px] h-[24px] rounded bg-ink text-paper text-[9px] font-bold flex items-center justify-center tracking-wider uppercase shrink-0">
                    {payment.type === 'sepa_debit' ? 'SEPA' : (payment.brand ?? payment.type).slice(0, 4)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs font-medium">
                      ···· {payment.last4 ?? payment.iban_last4}
                      {payment.type === 'card' && payment.exp_month != null && payment.exp_year != null && (
                        <span className="text-ink-3 font-normal ml-2">
                          {payment.exp_month}/{String(payment.exp_year).slice(-2)}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-3">
                      {payment.type === 'sepa_debit'
                        ? 'Direct debit'
                        : payment.brand
                          ? payment.brand.charAt(0).toUpperCase() + payment.brand.slice(1)
                          : 'Card'}
                    </div>
                  </div>
                  <BBChip variant="green">Default</BBChip>
                </div>
                <BBButton
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  onClick={() => void handleAddPaymentMethod()}
                  disabled={setupLoading}
                >
                  {setupLoading ? 'Loading...' : 'Update payment method'}
                </BBButton>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
                <div className="w-10 h-10 rounded-xl bg-paper-2 border border-line flex items-center justify-center mb-3">
                  <Icon name="file-text" size={16} className="text-ink-3" />
                </div>
                <div className="text-sm text-ink-3 mb-1">No payment method on file</div>
                <div className="text-xs text-ink-4 mb-3">
                  Add one to keep your subscription active.
                </div>
                <BBButton
                  size="sm"
                  variant="amber"
                  onClick={() => void handleAddPaymentMethod()}
                  disabled={setupLoading}
                >
                  {setupLoading ? 'Loading...' : 'Add payment method'}
                </BBButton>
              </div>
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
              segments={storageSegments}
              totalBytes={totalStorageBytes}
            />
          </div>
        )}

        {/* ── Upgrade CTAs for free plan ─────────────── */}
        {effectivePlan === 'free' && (
          <div className="border border-line rounded-xl overflow-hidden bg-paper">
            <div className="px-5 py-4 border-b border-line">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                Unlock more
              </div>
              <div className="text-sm text-ink-2">
                All paid plans include encrypted storage, photo library, and EU data residency.
              </div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-line">
              {(['personal', 'pro', 'data_hoarder'] as const).map((planId) => {
                const p = planMeta[planId]
                return (
                  <button
                    key={planId}
                    onClick={() => openUpgrade(planId)}
                    className="p-5 text-left hover:bg-paper-2 transition-colors cursor-pointer group"
                  >
                    <div className="text-sm font-semibold mb-0.5 group-hover:text-amber-deep transition-colors">
                      {p.label}
                    </div>
                    <div className="flex items-baseline gap-1 mb-2">
                      <span className="font-mono text-lg font-bold">
                        EUR {p.priceMonthly % 1 === 0 ? p.priceMonthly : p.priceMonthly.toFixed(2)}
                      </span>
                      <span className="text-xs text-ink-3">/ month</span>
                    </div>
                    <div className="text-xs text-ink-3 mb-3">
                      {formatStorageSI(p.storageGB * 1_000_000_000)}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-deep">
                      Subscribe
                      <Icon name="chevron-right" size={10} />
                    </span>
                  </button>
                )
              })}
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
              <BBButton size="sm" variant="ghost" className="ml-auto">
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
                      <BBButton size="sm" variant="ghost">
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
              All invoices are VAT-compliant (EU reverse charge). Signed DPA on file.
            </span>
            <BBButton
              size="sm"
              variant="ghost"
              onClick={() => window.open(`${getApiUrl()}/api/v1/legal/dpa`, '_blank')}
            >
              Download DPA
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
        planName={planMeta[upgradePlan]?.label ?? 'Pro'}
        pricePerSeat={planMeta[upgradePlan]?.priceMonthly ?? 39.95}
        priceYearlySeat={planMeta[upgradePlan]?.priceYearly ?? 383.52}
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
