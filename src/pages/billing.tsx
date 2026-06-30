import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
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
  getBillingInvoices,
  getBillingTransactions,
  getPlans,
  listFiles,
  updatePaymentMethod,
  getPaymentMethod,
  switchBillingCycle,
  cancelSubscription,
  reactivateSubscription,
  pauseSubscription,
  resumeSubscription,
  getWinbackEligible,
  claimWinback,
  getPreference,
  setPreference,
  getStorageAddons,
  updateStorageAddons,
  previewStorageAddons,
  createStorageAddonCheckout,
  exportBillingTransactions,
  startTrial,
  convertTrial,
  ApiError,
  type Subscription,
  type BillingInvoice,
  type BillingTransaction,
  type Plan,
  type DriveFile,
  type StorageAddonState,
  type StorageAddonPreview,
  type PaymentMethod,
  cancelDowngrade,
} from '../lib/api'
import { useDriveData } from '../lib/drive-data-context'
import { useWsEvent } from '../lib/ws-context'

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
import { InvoiceList } from '../components/billing/InvoiceList'
import { TransactionList } from '../components/billing/TransactionList'
import { PLAN_META, PLAN_RANK, getDowngradeOptions, CANONICAL_PLAN_SLUGS, MARKETED_PLAN_SLUGS } from '../lib/plan-constants'

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

const fallbackUpgradePlanIds = ['basic', 'pro', 'business'] as const

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

/* ── Presentational primitives (task 0942 restyle) ─────────
   These are layout/markup helpers ONLY — no state, no handlers, no data
   flow. They exist so the billing markup matches the approved mockups
   (#7 summary, #8 change-plan): hairline-bordered cards, uppercase muted
   section labels, and a storage meter that can render a secondary (muted,
   non-accent) add-on bar alongside the amber primary bar. */

/** A hairline-bordered card matching the mockups' radii + padding. */
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-line rounded-xl bg-paper ${className}`}>{children}</div>
  )
}

/** Uppercase, muted, letter-spaced section label ("CURRENT PLAN", …). */
function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-wider text-ink-4 ${className}`}>
      {children}
    </div>
  )
}

/** A static storage meter. `variant="secondary"` renders a muted/desaturated
    fill (the add-on meter in #7) so it reads as a SECONDARY meter, never a
    second accent. The primary variant keeps the amber usage colour cascade. */
function MeterBar({
  percent,
  variant = 'primary',
  usagePercent,
}: {
  percent: number
  variant?: 'primary' | 'secondary'
  /** For the primary bar, drive the colour cascade off actual usage. */
  usagePercent?: number
}) {
  const up = usagePercent ?? percent
  const fill =
    variant === 'secondary'
      ? 'bg-ink-4'
      : up > 90
        ? 'bg-red'
        : up > 75
          ? 'bg-amber'
          : 'bg-amber-deep'
  return (
    <div className="relative h-2 rounded-full bg-paper-3 overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${fill}`}
        style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }}
      />
    </div>
  )
}

/* ── Checkout watchdog + pre-checkout intent (task 0946) ───

   A persisted "intent" is written to localStorage just before EVERY redirect to
   the hosted Mollie checkout — plan upgrade, billing-cycle switch, trial convert,
   AND storage instant-pay. It carries two things:

   - `pre`: the subscription state captured *before* the redirect (plan, cycle,
     status, extra_storage_tb, storage_tb_quantity, current_period_end,
     mandate_method). This is the ground truth the reconcile-on-load compares a
     fresh subscription against — NOT a post-reload baseline (which would already
     be the upgraded value if the grant landed before the reload). Comparing to
     `pre` is what makes confirmation survive a reload of /billing?upgraded=true.
   - `target`: what the user bought, so we can confirm an exact plan/cycle match.

   `kind` distinguishes a storage add-on (plan/cycle unchanged, only storage
   rises) from a plan checkout. 24h TTL, same as the legacy record. */

const PENDING_CHECKOUT_KEY = 'bb_pending_checkout'

interface CheckoutPreState {
  plan: string
  cycle: string | undefined
  status: string | undefined
  periodEnd: string | null | undefined
  extraStorageTb: number
  storageTbQuantity: number
  mandateMethod: 'creditcard' | 'directdebit' | null | undefined
}

interface PendingCheckout {
  // 'plan' = plan upgrade / cycle switch / trial convert; 'storage' = add-on.
  kind: 'plan' | 'storage'
  // What was bought. For storage, `cycle` mirrors the current cycle (unused by
  // the storage reconcile path, which keys off the storage delta).
  plan: string
  cycle: string
  // Pre-checkout server truth — the reconcile baseline.
  pre: CheckoutPreState
  ts: number
}

function makePreState(sub: Subscription | null | undefined): CheckoutPreState {
  return {
    plan: sub?.plan ?? 'free',
    cycle: sub?.billing_cycle,
    status: sub?.status,
    periodEnd: sub?.current_period_end,
    extraStorageTb: sub?.extra_storage_tb ?? 0,
    storageTbQuantity: sub?.storage_tb_quantity ?? 0,
    mandateMethod: sub?.mandate_method,
  }
}

function setPendingCheckout(
  kind: 'plan' | 'storage',
  plan: string,
  cycle: string,
  pre: CheckoutPreState,
) {
  try {
    localStorage.setItem(
      PENDING_CHECKOUT_KEY,
      JSON.stringify({ kind, plan, cycle, pre, ts: Date.now() } satisfies PendingCheckout),
    )
  } catch { /* storage unavailable — watchdog/reconcile simply won't fire */ }
}

function clearPendingCheckout() {
  localStorage.removeItem(PENDING_CHECKOUT_KEY)
}

function getPendingCheckout(): PendingCheckout | null {
  try {
    const raw = localStorage.getItem(PENDING_CHECKOUT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<PendingCheckout> & { ts?: number }
    if (typeof data.ts !== 'number' || Date.now() - data.ts > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(PENDING_CHECKOUT_KEY)
      return null
    }
    // Back-compat: a legacy record ({plan,cycle,ts}) has no kind/pre. Treat it as
    // a plan checkout with an empty pre-state — the reconcile then falls back to
    // the target-match / any-change heuristics rather than a delta compare.
    return {
      kind: data.kind === 'storage' ? 'storage' : 'plan',
      plan: data.plan ?? 'free',
      cycle: data.cycle ?? 'monthly',
      pre: data.pre ?? makePreState(null),
      ts: data.ts,
    }
  } catch { return null }
}

/* ── Main component ────────────────────────────────────── */

export function Billing() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const navigate = useNavigate()
  // Presentational view toggle (task 0942) — backed by the router URL so the
  // change-plan view is linkable, refresh-stable, and Back-button-friendly
  // (task 0944). 'summary' = the /billing summary (mockup #7); 'change' =
  // ?view=change, the change-plan view (mockup #8) the "Change plan" button
  // opens. Both views render the SAME handlers/modals/state machines; this only
  // regroups the markup.
  const view: 'summary' | 'change' = searchParams.get('view') === 'change' ? 'change' : 'summary'
  const setView = useCallback((next: 'summary' | 'change') => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'change') p.set('view', 'change')
        else p.delete('view')
        return p
      },
      { replace: true },
    )
  }, [setSearchParams])
  const { usage: contextUsage, planDetails: contextPlanDetails, refreshPlanDetails } = useDriveData()
  // sub comes from context; re-synced after cancel/reactivate via loadData
  const [sub, setSub] = useState<Subscription | null>(contextPlanDetails.subscription)
  const [invoices, setInvoices] = useState<BillingInvoice[]>([])
  const [transactions, setTransactions] = useState<BillingTransaction[]>([])
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [files, setFiles] = useState<DriveFile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradePlan, setUpgradePlan] = useState<string>('pro')
  const [portalLoading, setPortalLoading] = useState(false)
  // Cancel flow is a four-step machine (task 0544 added 'pause'):
  //   'idle'    — initial state, "Cancel plan" link is visible
  //   'offer'   — win-back offer card (50% off / 3 months); only when eligible
  //   'pause'   — "Pause instead?" card with 30/60/90-day options
  //   'confirm' — final cancel-confirmation panel
  // `cancelConfirm` is derived as `cancelStep === 'confirm'` so the existing
  // JSX condition keeps working unchanged.
  const [cancelStep, setCancelStep] = useState<'idle' | 'offer' | 'pause' | 'confirm'>('idle')
  const cancelConfirm = cancelStep === 'confirm'
  const setCancelConfirm = (v: boolean) => setCancelStep(v ? 'confirm' : 'idle')
  const [cancelLoading, setCancelLoading] = useState(false)
  const [winbackStartingLoading, setWinbackStartingLoading] = useState(false)
  const [winbackAcceptLoading, setWinbackAcceptLoading] = useState(false)
  const [reactivateLoading, setReactivateLoading] = useState(false)
  // Pause flow (task 0544)
  const [pauseLoading, setPauseLoading] = useState<30 | 60 | 90 | null>(null)
  const [resumeLoading, setResumeLoading] = useState(false)
  const [showComparison, setShowComparison] = useState(false)
  // Billing cycle switch confirmation
  const [cycleSwitchConfirm, setCycleSwitchConfirm] = useState<'monthly' | 'yearly' | null>(null)
  const [cycleSwitchLoading, setCycleSwitchLoading] = useState(false)
  // 14-day free trial (task 0905). `trialStarting` tracks the plan currently
  // being started; `trialUsed` is set when the server reports the user already
  // had a trial (409 trial_already_used) so we hide the CTA and fall back to the
  // normal paid checkout. `convertLoading` tracks the convert/add-payment flow.
  const [trialStarting, setTrialStarting] = useState<string | null>(null)
  const [trialUsed, setTrialUsed] = useState(false)
  const [convertLoading, setConvertLoading] = useState(false)
  // Upgraded return — the user came back from the provider's hosted checkout.
  // Provisioning is async (the payment webhook writes the subscription row, NOT
  // the redirect), and the provider reuses ONE redirect URL for paid/cancelled/
  // expired, so `?upgraded=true` alone cannot assert success. We poll the
  // subscription and only claim "Upgrade complete" once it actually reflects the
  // change; otherwise we show an honest neutral "still processing" state. (0865)
  const showUpgraded = searchParams.get('upgraded') === 'true' || Boolean(searchParams.get('session_id'))
  const upgradedDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 'finalizing' = polling; 'complete' = subscription reflects the upgrade;
  // 'unconfirmed' = poll window elapsed without a change (payment may still be
  // processing, or was cancelled/not completed — never a false success).
  const [upgradeConfirm, setUpgradeConfirm] = useState<'finalizing' | 'complete' | 'unconfirmed'>('finalizing')
  // The pre-checkout intent persisted to localStorage just before the redirect
  // (task 0946). This — not a post-reload, context-derived baseline — is the
  // ground truth confirmation compares against. Read it ONCE on first render and
  // pin it to a ref so it survives the `clearPendingCheckout()` that runs on the
  // upgraded return: clearing the storage key must NOT lose the reconcile
  // baseline mid-flow. `null` when the user landed on /billing with no in-flight
  // checkout (a direct visit, or a stale/expired record).
  const intentRef = useRef<PendingCheckout | null>(null)
  const intentReadRef = useRef(false)
  if (!intentReadRef.current) {
    intentReadRef.current = true
    intentRef.current = getPendingCheckout()
  }
  // The intent's mandate method drives SEPA-aware copy from the very first frame
  // (before any subscription refetch lands). directdebit = settles over days.
  const intentMandate = intentRef.current?.pre.mandateMethod ?? null
  // Checkout watchdog — detects abandoned checkouts
  const [pendingCheckout, setPendingCheckoutState] = useState<PendingCheckout | null>(null)

  useEffect(() => {
    if (showUpgraded || searchParams.get('cancelled') === 'true') {
      clearPendingCheckout()
      setPendingCheckoutState(null)
    } else {
      const pending = getPendingCheckout()
      if (pending) setPendingCheckoutState(pending)
    }
  }, [showUpgraded, searchParams])

  // Does a freshly-fetched subscription reflect the upgrade the user just made?
  // Shared by the poll (fallback), the WS handler, AND the reconcile-on-load —
  // all three agree on what "confirmed" means by comparing the fresh sub against
  // the PRE-checkout state persisted in the intent (task 0946), not a post-reload
  // baseline. Comparing to pre-checkout truth is what fixes F1/F7: on a reload of
  // /billing?upgraded=true the context subscription is ALREADY the upgraded value,
  // so a delta against it can never trip — but the delta against `intent.pre`
  // (captured before the redirect) still does.
  const reflectsUpgrade = useCallback((s: Subscription): boolean => {
    const intent = intentRef.current
    if (!intent) return false
    const pre = intent.pre
    const ACTIVE_STATUSES = new Set(['active', 'trialing'])
    // Storage add-on. An instant-pay STORAGE upgrade leaves plan/cycle/status
    // unchanged and only raises extra_storage_tb (or the pinned
    // storage_tb_quantity). Detect that FIRST — before the plan-target path —
    // so it confirms even when plan/cycle never move. Compared against the
    // PRE-checkout storage, so it trips on a reload after the grant landed.
    const extraNow = s.extra_storage_tb ?? 0
    const qtyNow = s.storage_tb_quantity ?? 0
    if (
      ACTIVE_STATUSES.has(s.status) &&
      (extraNow > pre.extraStorageTb || qtyNow > pre.storageTbQuantity)
    ) {
      return true
    }
    // A storage-kind intent confirms ONLY via the storage delta above; never via
    // the plan/cycle heuristics (the plan is expected to stay the same).
    if (intent.kind === 'storage') return false
    // Most precise: the subscription matches exactly what the user just bought.
    return s.plan === intent.plan
      && s.billing_cycle === intent.cycle
      && ACTIVE_STATUSES.has(s.status)
      // …but only if that is actually a CHANGE from the pre-state (a no-op
      // "match" against an unchanged sub is not a confirmation), OR the pre-state
      // wasn't active (a fresh paid provision from free/expired).
      && (s.plan !== pre.plan
        || s.billing_cycle !== pre.cycle
        || !ACTIVE_STATUSES.has(pre.status ?? '')
        // Trial conversion keeps the SAME plan/cycle and only moves
        // trialing → active; both are "active" so the clause above won't fire and
        // current_period_end may not advance (the existing period is honored).
        // That status transition IS the confirmation signal — without this a
        // convert-to-paid would spin to `unconfirmed` despite succeeding.
        || (pre.status === 'trialing' && s.status === 'active')
        || (!!pre.periodEnd && !!s.current_period_end && s.current_period_end > pre.periodEnd))
  }, [])

  // The `billing_updated` WS subscription (task 0943, part B) is defined AFTER
  // `loadData` (below) to avoid a temporal-dead-zone on its const binding.

  // Reconcile-on-load + poll the subscription on the upgraded return (task 0946).
  //
  // Reconcile-on-load: the moment we land — regardless of whether `?upgraded` is
  // in the URL — if a persisted pre-checkout intent exists, fetch a FRESH
  // subscription IMMEDIATELY and compare it to `intent.pre`. If storage increased
  // vs the pre-state, or plan/cycle now match the target, or status went active,
  // confirm and clear the intent. This is the fix for the founder's stuck banner:
  // when the grant landed BEFORE the reload, the very first reconcile sees the
  // delta against the pre-checkout truth and flips to `complete` without spinning.
  //
  // The 2s→4s / 30s poll remains the fallback for the slow-webhook case where the
  // grant has NOT yet landed when the page loads. An &upgraded URL is what shows
  // the finalizing banner; the reconcile runs even without it (so a back/forward
  // re-arm — F7 — still resolves), but only flips visible banner state when the
  // banner is showing.
  useEffect(() => {
    const intent = intentRef.current
    // Nothing to reconcile and not an upgraded return → nothing to do.
    if (!intent && !showUpgraded) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const deadline = Date.now() + 30_000
    if (showUpgraded) setUpgradeConfirm('finalizing')

    const confirmComplete = (latest: Subscription) => {
      setSub(latest)
      setUpgradeConfirm('complete')
      // The upgrade is confirmed — the intent has done its job. Clear it so a
      // later reload / back-forward does not re-arm against a now-stale record.
      clearPendingCheckout()
      intentRef.current = null
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      void loadData()
    }

    // A confirmation signal when there is NO intent to compare against — a legacy
    // direct visit to ?upgraded=true with no persisted pre-state. Accept any
    // active paid subscription as the best-effort signal (the historical 0865
    // behaviour); with an intent we always use the precise reflectsUpgrade().
    const confirmed = (s: Subscription): boolean =>
      intent
        ? reflectsUpgrade(s)
        : (s.plan !== 'free' && new Set(['active', 'trialing']).has(s.status))

    let attempt = 0
    const poll = async () => {
      if (cancelled) return
      try {
        const latest = await getSubscription()
        if (cancelled) return
        if (confirmed(latest)) {
          confirmComplete(latest)
          return
        }
      } catch {
        // Transient fetch failure — keep polling until the deadline.
      }
      if (cancelled) return
      // Only the upgraded-return banner has a 30s "give up" deadline. A silent
      // reconcile (intent but no ?upgraded) just runs one immediate check and
      // a short poll, never forcing an `unconfirmed` banner.
      if (Date.now() >= deadline) {
        if (showUpgraded) setUpgradeConfirm('unconfirmed')
        return
      }
      attempt += 1
      // Gentle backoff: 2s, then creeping toward 4s, capped so we stay responsive.
      const delay = Math.min(2000 + attempt * 250, 4000)
      timer = setTimeout(() => { void poll() }, delay)
    }
    // Reconcile-on-load: run the FIRST check immediately (not after a 2s wait) so
    // an already-landed grant confirms on the first frame instead of spinning.
    void poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUpgraded])

  // Storage add-on state
  const [addonState, setAddonState] = useState<StorageAddonState | null>(null)
  const [sliderTB, setSliderTB] = useState<number>(0)
  const [addonSaving, setAddonSaving] = useState(false)
  const [addonPreview, setAddonPreview] = useState<StorageAddonPreview | null>(null)
  const [addonPreviewLoading, setAddonPreviewLoading] = useState(false)
  // SEPA two-path storage update (task 0941). `addonInstantPayLoading` tracks the
  // pay-now-to-activate-instantly redirect; `addonPending` becomes true after a
  // SEPA-mandate charge whose grant is deferred until the debit settles.
  const [addonInstantPayLoading, setAddonInstantPayLoading] = useState(false)
  const [addonPending, setAddonPending] = useState(false)

  // Downgrade state
  const [downgradeTarget, setDowngradeTarget] = useState<string | null>(null)
  const [cancellingDowngrade, setCancellingDowngrade] = useState(false)

  // Invoice preferences
  const [invoiceSendEmail, setInvoiceSendEmail] = useState(true)
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [savingInvoicePrefs, setSavingInvoicePrefs] = useState(false)

  // Payment method on file (task 0925). `null` = no card (server 404) or not yet
  // loaded; `pmLoaded` distinguishes "fetched, none on file" from "still loading"
  // so the card only renders an honest state once the fetch settles.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [pmLoaded, setPmLoaded] = useState(false)
  // CSV export of the payment history (#7 "Export all", task 0942).
  const [exportingTransactions, setExportingTransactions] = useState(false)

  const showSuccess = searchParams.get('success') === 'true'

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // getSubscription is fetched fresh here so cancel/reactivate flows see
      // the updated status immediately. getPlans is needed for the upgrade
      // cards section (context only stores the matched current-user plan).
      const [subData, invData, txnData, invoicePref, plansData, filesData, addonsData, pmData] = await Promise.all([
        getSubscription(),
        getBillingInvoices().catch(() => [] as BillingInvoice[]),
        getBillingTransactions().catch(() => [] as BillingTransaction[]),
        getPreference<{ send_email: boolean; invoice_email: string }>('invoice_settings').catch(() => null),
        getPlans().catch(() => null),
        listFiles(undefined, false).catch(() => null),
        getStorageAddons().catch(() => null),
        // 404 = no card on file (not an error) → null. Any other failure also
        // resolves null so a missing payment-method endpoint never breaks the page.
        getPaymentMethod().catch(() => null),
      ])
      setSub(subData)
      setInvoices(invData ?? [])
      setTransactions(txnData ?? [])
      setPlans(plansData)
      setFiles(filesData)
      setPaymentMethod(pmData)
      setPmLoaded(true)
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

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Real-time confirmation (task 0943, part B). The server emits a per-user
  // `billing_updated` WS event the instant a billing change is APPLIED (Mollie
  // webhook grant, plan provision, renewal, cancel/downgrade). On receipt:
  // refetch the subscription, keep app-wide plan/quota UI fresh, and — if a
  // `?upgraded=true` return is still finalizing and the new sub reflects the
  // change — confirm IMMEDIATELY instead of waiting for the next poll tick. The
  // 30s poll above stays as the fallback for a dropped/missed WS event.
  useWsEvent(['billing_updated'], useCallback(() => {
    void (async () => {
      let latest: Subscription
      try {
        latest = await getSubscription()
      } catch {
        // Couldn't refetch — the poll fallback will catch up.
        return
      }
      setSub(latest)
      // Always refresh app-wide storage/quota UI on a billing change.
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      // If a checkout return banner is still showing AND this update is the one
      // we were waiting for, flip to complete now (no poll-tick latency). F5:
      // accept the flip from EITHER `finalizing` (poll still running) OR
      // `unconfirmed` (the 30s poll already gave up) — a genuine later WS event
      // for a slow webhook / settled SEPA debit must still resolve the banner,
      // not just silently refresh the data underneath a stuck "still processing".
      if (showUpgraded && upgradeConfirm !== 'complete' && reflectsUpgrade(latest)) {
        setUpgradeConfirm('complete')
        clearPendingCheckout()
        intentRef.current = null
        void loadData()
      }
    })()
  }, [showUpgraded, upgradeConfirm, reflectsUpgrade, refreshPlanDetails, loadData]))

  // Auto-dismiss the celebration card 10 s after the upgrade is CONFIRMED.
  // While finalizing (still polling) or unconfirmed ("updates automatically")
  // we keep the card up so the user isn't dropped mid-flow.
  useEffect(() => {
    if (!showUpgraded || upgradeConfirm !== 'complete') return
    upgradedDismissTimer.current = setTimeout(() => {
      setSearchParams({}, { replace: true })
    }, 10_000)
    return () => {
      if (upgradedDismissTimer.current) clearTimeout(upgradedDismissTimer.current)
    }
  }, [showUpgraded, upgradeConfirm, setSearchParams])

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

  // SEPA two-path (task 0941). A directdebit mandate can only be charged
  // off-session (settles in a few days), so the storage-update dialog offers an
  // extra "pay now to activate instantly" path. creditcard / null keep the
  // immediate-charge UX.
  const isSepaMandate = sub?.mandate_method === 'directdebit'
  // For checkout-return banners, prefer the intent's captured mandate_method
  // (known on the first frame, before `sub` refetches) and fall back to the live
  // subscription (task 0946, F4). A SEPA charge is "settling", never "failed".
  const checkoutIsSepa = intentMandate === 'directdebit' || isSepaMandate

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

  // Entry point for the cancel flow. Checks win-back eligibility before
  // jumping straight to the cancel-confirmation panel. The full sequence is
  //   offer (if eligible) → pause → confirm
  // — each step has a "no thanks" link to the next, so users always have a
  // softer landing before committing to cancel.
  //
  // The 'pause' step only exists when the active billing provider supports
  // pause/resume (task 0924). Under Mollie (`pause_supported === false`) there
  // is no native pause, so we NEVER route to 'pause' — eligible users still see
  // the retention offer (then continue straight to confirm), and ineligible
  // users go directly to confirm.
  const pauseSupported = sub?.pause_supported ?? false
  async function startCancelFlow() {
    setWinbackStartingLoading(true)
    try {
      const { eligible } = await getWinbackEligible()
      setCancelStep(eligible ? 'offer' : pauseSupported ? 'pause' : 'confirm')
    } catch {
      // Don't block cancel if eligibility check fails — skip the offer and go
      // to the pause card (or straight to confirm when pause isn't supported).
      setCancelStep(pauseSupported ? 'pause' : 'confirm')
    } finally {
      setWinbackStartingLoading(false)
    }
  }

  async function handlePauseSubscription(days: 30 | 60 | 90) {
    setPauseLoading(days)
    try {
      const result = await pauseSubscription(days)
      setCancelStep('idle')
      showToast({
        icon: 'check',
        title: `Plan paused for ${days} days`,
        description: `Billing resumes on ${formatDate(result.pause_until)}. Your data stays accessible.`,
      })
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      await loadData()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not pause plan',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setPauseLoading(null)
    }
  }

  async function handleResumeSubscription() {
    setResumeLoading(true)
    try {
      await resumeSubscription()
      showToast({ icon: 'check', title: 'Plan resumed', description: 'Billing has restarted.' })
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      await loadData()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not resume plan',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setResumeLoading(false)
    }
  }

  async function handleAcceptWinback() {
    setWinbackAcceptLoading(true)
    try {
      const result = await claimWinback()
      setCancelStep('idle')
      showToast({
        icon: 'check',
        title: 'Discount applied',
        description: `${result.discount_pct}% off for the next ${result.months} months — it shows up on your next invoice.`,
      })
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      await loadData()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not apply discount',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setWinbackAcceptLoading(false)
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

  /**
   * Native payment-method update (task 0925). Provider-agnostic: the server
   * returns a hosted card re-auth checkout (Mollie) or a Stripe portal URL
   * (legacy Stripe customers); either way we just redirect. No Stripe-hosted
   * "manage billing" portal is surfaced — everything else is native on this page.
   * `portalLoading` keeps the redirect spinner; the intent is now "update payment
   * method", not "open the portal".
   */
  async function handleUpdatePaymentMethod() {
    setPortalLoading(true)
    try {
      const result = await updatePaymentMethod()
      window.location.href = result.url
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not update payment method',
        description: err instanceof Error ? err.message : 'Please try again.',
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
        // Redirect to the native payment-method update flow (Mollie checkout /
        // legacy Stripe portal) so the user can add a card, then come back.
        try {
          const result = await updatePaymentMethod()
          window.location.href = result.url
          return
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
      // SEPA mandate charges settle off-session (a few days) — the apply response
      // carries pending:true and the grant is deferred. Surface an honest pending
      // state instead of claiming the vault already grew. (task 0941)
      if (result.pending) {
        setAddonPending(true)
        showToast({
          icon: 'clock',
          title: 'Storage upgrade pending',
          description: 'Your SEPA mandate is being charged — the extra storage activates in a few days, once the payment settles.',
        })
      } else {
        showToast({
          icon: 'check',
          title: 'Storage updated',
          description: `Your vault is now ${formatStorageSI(result.effective_storage_bytes)}.`,
        })
      }
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

  /**
   * Pay-now-to-activate-instantly path (task 0941, SEPA two-path). Instead of
   * charging the SEPA mandate (which settles in a few days), redirect to a hosted
   * Mollie one-off payment that grants the storage instantly via webhook. Creates
   * NO mandate charge. Mirrors createCheckoutSession's redirect.
   */
  async function handleStorageAddonInstantPay() {
    setAddonInstantPayLoading(true)
    try {
      const { checkout_url } = await createStorageAddonCheckout({ extra_storage_tb: sliderTB })
      // F2 (task 0946): persist a pre-checkout intent so the upgraded return can
      // reconcile against the PRE-state (a storage add-on leaves plan/cycle
      // untouched — only extra_storage_tb rises — so without a pre snapshot the
      // confirmation had no baseline and false-failed). kind:'storage' routes the
      // reconcile to the storage-delta path. cycle mirrors the current cycle.
      setPendingCheckout(
        'storage',
        effectivePlan,
        sub?.billing_cycle ?? 'monthly',
        makePreState(sub),
      )
      window.location.href = checkout_url
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not start instant payment',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
      setAddonInstantPayLoading(false)
    }
  }

  /** Download the full payment history as CSV (#7 "Export all", task 0942). */
  async function handleExportTransactions() {
    setExportingTransactions(true)
    try {
      await exportBillingTransactions()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not export payment history',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setExportingTransactions(false)
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
      const result = await switchBillingCycle(cycle)
      setCycleSwitchConfirm(null)
      showToast({
        icon: 'check',
        title: cycle === 'yearly' ? 'Switched to annual billing' : 'Switched to monthly billing',
        description: result.annual_billing_start
          ? `Your annual billing starts on ${formatDate(result.annual_billing_start)}.`
          : 'The change takes effect at the start of your next billing period.',
      })
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

  /**
   * Start a 14-day free trial (task 0905, Pattern B — no card). On success the
   * subscription flips to `trialing` immediately; we refresh state so the page
   * shows the trialing summary + the global "N days left" banner. A 409
   * `trial_already_used` is honest signal that this account already had a trial —
   * we hide the trial CTA and fall back to the normal paid checkout.
   */
  async function handleStartTrial(plan: string) {
    setTrialStarting(plan)
    try {
      await startTrial({ plan, billing_cycle: 'monthly' })
      showToast({
        icon: 'check',
        title: 'Your free trial has started',
        description: '14 days of full access. No card required — cancel anytime, you keep your files.',
      })
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      await loadData()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'trial_already_used') {
        setTrialUsed(true)
        showToast({
          icon: 'clock',
          title: 'You have already used your free trial',
          description: 'Subscribe to keep full access — your files stay encrypted either way.',
        })
        openUpgrade(plan)
        return
      }
      if (err instanceof ApiError && err.code === 'trial_has_active_subscription') {
        showToast({
          icon: 'check',
          title: 'You already have a plan',
          description: 'Manage it from billing below.',
        })
        await loadData()
        return
      }
      showToast({
        icon: 'x',
        title: 'Could not start your trial',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setTrialStarting(null)
    }
  }

  /**
   * Convert an active trial to a paid subscription (task 0905, UNIT B). REUSES
   * the 0865 redirect + poll-confirmed return machine: stamp the pending-checkout
   * marker, then redirect to the Mollie hosted checkout the server returns. The
   * two typed 409s route the user: a lapsed trial → normal upgrade picker; an
   * already-converted trial → billing management (this page, refreshed).
   */
  async function handleConvertTrial() {
    setConvertLoading(true)
    try {
      const { url } = await convertTrial()
      setPendingCheckout(
        'plan',
        sub?.plan ?? effectivePlan,
        sub?.billing_cycle ?? 'monthly',
        makePreState(sub),
      )
      window.location.href = url
    } catch (err) {
      if (err instanceof ApiError && err.code === 'trial_not_active') {
        showToast({
          icon: 'clock',
          title: 'Your trial has ended',
          description: 'Choose a plan to keep your extra storage.',
        })
        await loadData()
        setConvertLoading(false)
        return
      }
      if (err instanceof ApiError && err.code === 'trial_already_subscribed') {
        showToast({
          icon: 'check',
          title: 'You are already subscribed',
          description: 'Your trial has already been converted.',
        })
        window.dispatchEvent(new Event('beebeeb:plan-changed'))
        refreshPlanDetails()
        await loadData()
        setConvertLoading(false)
        return
      }
      showToast({
        icon: 'x',
        title: 'Could not add a payment method',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
      setConvertLoading(false)
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

  const allUpgradePlans = plans?.length
    ? plans
        .filter((plan) => plan.id !== 'free' && plan.is_active !== false)
        .map(upgradeCardFromApiPlan)
    : fallbackUpgradePlanIds.map(upgradeCardFromFallback)
  const currentSortOrder = allUpgradePlans.find((plan) => plan.id === effectivePlan)?.sortOrder ?? planRank[effectivePlan]
  // Only plans strictly ABOVE the user's current tier are real upgrade targets.
  // Teams (slug `business`) is now a marketed, purchasable top tier — a Pro user
  // can upgrade to Teams; a Teams user has no higher tier.
  const upgradePlans = allUpgradePlans
    .filter((plan) => plan.id !== effectivePlan)
    .filter((plan) => currentSortOrder === undefined || plan.sortOrder > currentSortOrder)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  // Derive the primary-CTA target from the CURRENT plan: the lowest tier strictly
  // above what the user holds. When none exists (e.g. on Pro), there is no upgrade
  // CTA at all — never offer an upgrade to the tier the user is already on.
  const nextPlanDetails = upgradePlans[0] ?? null
  const nextPlan = nextPlanDetails?.id ?? null
  const selectedApiPlan = plans?.find((plan) => plan.id === upgradePlan)
  const upgradePlanDetails = selectedApiPlan
    ? upgradeCardFromApiPlan(selectedApiPlan, 0)
    : upgradeCardFromPlanMeta(upgradePlan)

  const billingInterval = sub?.billing_cycle === 'yearly' ? 'year' : 'month'

  /* ── Plan-price breakdown from SERVER truth (task 0947) ──────────────
     The headline used to lump base plan + every extra-TB add-on into one
     number, recomputed CLIENT-SIDE via the WASM `planMonthlyCostCents` with a
     hard-coded €10.99/TB — which could drift from what Mollie actually bills
     (the founder saw a bare "EUR 373.66 / month"). We now render a coherent
     breakdown straight from the `/billing/subscription` response:
       - basePlanCents:    server `base_plan_cents` (catalog base, no add-ons)
       - addonPerTbCents:  server `addon_per_tb_cents` (per-TB price, NOT a literal)
       - extraStorageCostCents: extra TB × the server per-TB price
       - basePriceCents:   the authoritative monthly/period TOTAL —
                           `mollie_amount_cents` when present, else base + add-on.
     Fallbacks keep this working before the server field change is deployed
     (server fields absent → fall back to the old client recompute). */
  const serverBasePlanCents = sub?.base_plan_cents
  const serverAddonCents = sub?.addon_cents
  const serverAddonPerTbCents = sub?.addon_per_tb_cents
  const serverMollieAmountCents = sub?.mollie_amount_cents

  // Per-TB price: server truth first, else derive from the WASM ladder (the
  // marginal cost of 1 extra TB), else the historical 1099 constant.
  const addonPerTbCents =
    serverAddonPerTbCents != null && serverAddonPerTbCents > 0
      ? serverAddonPerTbCents
      : (planMonthlyCostCents(effectivePlan, 1) - planMonthlyCostCents(effectivePlan, 0)) || 1099

  const basePlanCents =
    serverBasePlanCents != null && serverBasePlanCents > 0
      ? serverBasePlanCents
      : (sub?.billing_cycle === 'yearly' ? Math.round(currentPriceYearly * 100) : Math.round(currentPriceMonthly * 100))

  const extraStorageCostCents =
    serverAddonCents != null
      ? serverAddonCents
      : (currentExtraTB > 0 ? currentExtraTB * addonPerTbCents : 0)

  // Authoritative period total: prefer what Mollie actually charges; else
  // base + add-on (server-derived where available, else the old WASM recompute).
  const basePriceCents =
    serverMollieAmountCents != null && serverMollieAmountCents > 0
      ? serverMollieAmountCents
      : (serverBasePlanCents != null
          ? basePlanCents + extraStorageCostCents
          : (currentCostCents > 0
              ? currentCostCents
              : (sub?.billing_cycle === 'yearly' ? Math.round(currentPriceYearly * 100) : Math.round(currentPriceMonthly * 100))))

  /* ── Status badge ──────────────────────────────────── */

  function statusBadge() {
    if (effectivePlan === 'free') return null
    const cfg =
      sub?.status === 'trialing'   ? { bg: 'bg-amber-bg', text: 'text-amber-deep', dot: 'bg-amber-deep', label: 'Trial' }      :
      sub?.status === 'cancelling' ? { bg: 'bg-amber-bg', text: 'text-amber-deep', dot: 'bg-amber-deep', label: 'Cancelling' } :
      sub?.status === 'past_due'   ? { bg: 'bg-red/10',   text: 'text-red',        dot: 'bg-red',        label: 'Past due' }   :
      sub?.status === 'paused'     ? { bg: 'bg-paper-3',  text: 'text-ink-2',      dot: 'bg-ink-3',      label: 'Paused' }     :
                                     // Active plan-state pill is AMBER (task 0942 — the encryption/primary accent),
                                     // distinct from the transaction status chips (Paid/Issued) which stay green.
                                     { bg: 'bg-amber-bg', text: 'text-amber-deep', dot: 'bg-amber-deep', label: 'Active' }
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
      {/* Title differs by view (task 0942): the summary (#7) is the account-level
          "Billing" overview; the change view (#8) keeps the plan-centric heading. */}
      {view === 'summary' ? (
        <SettingsHeader
          title="Billing"
          subtitle="Manage your plan, payment method, and invoices."
        />
      ) : (
        <SettingsHeader
          title="Plan & billing"
          subtitle={meta.tagline}
        />
      )}

      <div className="p-7 space-y-6">
        {/* Checkout return — provisioning is async, so we poll before claiming
            success. Three states: finalizing (polling) → complete (confirmed) or
            unconfirmed (poll window elapsed; honest "still processing"). (0865) */}
        {showUpgraded && upgradeConfirm === 'finalizing' && (
          <div className="rounded-xl border border-amber/60 bg-amber-bg px-6 py-5">
            <div className="flex items-start gap-4">
              <svg className="animate-spin h-5 w-5 text-amber-deep shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
                  {intentMandate === 'directdebit' ? 'Upgrade on its way' : 'Finalizing your upgrade'}
                </div>
                <h2 className="text-xl font-bold text-ink leading-snug mb-1">
                  {intentMandate === 'directdebit' ? 'Your SEPA debit is settling' : 'Confirming your payment'}
                </h2>
                {/* SEPA-aware copy from the FIRST frame (task 0946, F4): the
                    intent's mandate_method is known before any refetch, so a
                    directdebit charge never promises "a few seconds" — SEPA
                    debits settle over the next few days. */}
                <p className="text-[13.5px] text-ink-2 leading-relaxed">
                  {intentMandate === 'directdebit'
                    ? 'Your payment was charged to your SEPA mandate. SEPA debits settle over the next few days — your upgrade activates automatically once it clears. You can safely leave this page; it updates on its own.'
                    : 'We are confirming your payment with our processor. This usually takes a few seconds — this page updates automatically.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {showUpgraded && upgradeConfirm === 'complete' && (
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

        {showUpgraded && upgradeConfirm === 'unconfirmed' && (
          <div className="rounded-xl border border-line-2 bg-paper-2 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                {/* Honest "still processing" state (task 0943). The redirect return
                    cannot tell a deferred-SEPA charge (settles in a few days) from a
                    slow webhook, so the copy never implies failure — it says the
                    payment is settling and the page updates itself. A SEPA-mandate
                    sub gets the explicit "charged to your SEPA mandate" wording. */}
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
                  {checkoutIsSepa ? 'Upgrade pending' : 'Still processing'}
                </div>
                <h2 className="text-lg font-bold text-ink leading-snug mb-1">
                  {checkoutIsSepa
                    ? 'Your upgrade is on its way'
                    : 'We are still confirming your payment'}
                </h2>
                <p className="text-[13.5px] text-ink-2 leading-relaxed">
                  {checkoutIsSepa
                    ? 'Your payment was charged to your SEPA mandate. SEPA debits settle in a few days — your upgrade activates automatically once it clears. You can safely leave this page; this updates on its own.'
                    : 'Your payment is still settling with our processor — this can take a moment. This page updates automatically the instant it confirms, so there is nothing else you need to do.'}
                </p>
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

        {/* Checkout watchdog. Two distinct realities share this slot (task 0946):
            - A SEPA-mandate charge WAS made and is settling over a few days — it
              is NOT an abandoned checkout, so it must never say "didn't complete
              checkout" or offer a "Continue" CTA. Honest "settling" copy only.
            - A genuinely abandoned hosted-checkout (no SEPA charge): offer to
              resume. Plan vs storage intent get their own copy + resume action. */}
        {pendingCheckout && !showUpgraded && (
          pendingCheckout.pre.mandateMethod === 'directdebit' ? (
            <div className="flex items-center gap-3 p-3.5 bg-amber-bg border border-amber/30 rounded-lg text-sm">
              <Icon name="clock" size={14} className="text-amber-deep shrink-0" />
              <span className="flex-1 text-ink-2">
                Your payment was charged to your SEPA mandate and is settling — SEPA debits clear over the next few days, and your upgrade activates automatically once it does.
              </span>
              <button
                onClick={() => { clearPendingCheckout(); setPendingCheckoutState(null) }}
                className="text-ink-3 hover:text-ink transition-colors shrink-0"
                aria-label="Dismiss"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3.5 bg-amber-bg border border-amber/30 rounded-lg text-sm">
              <Icon name="clock" size={14} className="text-amber-deep shrink-0" />
              <span className="flex-1 text-ink-2">
                {pendingCheckout.kind === 'storage' ? (
                  <>You started adding storage but didn't complete checkout.</>
                ) : (
                  <>You started switching to <span className="font-semibold text-ink">{pendingCheckout.cycle}</span> billing but didn't complete checkout.</>
                )}
              </span>
              {pendingCheckout.kind === 'plan' && (
                <BBButton
                  size="sm"
                  variant="amber"
                  onClick={() => void handleSwitchBillingCycle(pendingCheckout.cycle as 'monthly' | 'yearly')}
                >
                  Continue
                </BBButton>
              )}
              <button
                onClick={() => { clearPendingCheckout(); setPendingCheckoutState(null) }}
                className="text-ink-3 hover:text-ink transition-colors shrink-0"
                aria-label="Dismiss"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )
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
              onClick={() => void handleUpdatePaymentMethod()}
              disabled={portalLoading}
            >
              {portalLoading ? 'Redirecting...' : 'Update payment method'}
            </BBButton>
          </div>
        )}

        {/* Trial summary (task 0905) — only for an active trial with a future
            end date. A lapsed trial has status back to a non-trialing value, so
            this also guards against a stale "trialing" panel. Honest copy near
            expiry; the day count is mono (it reads like data); amber on the
            primary convert CTA only. */}
        {sub?.status === 'trialing' && sub.trial_ends_at && remainingDays(sub.trial_ends_at) > 0 && (
          <div className="rounded-xl border border-amber/60 bg-amber-bg px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
                  Free trial
                </div>
                {remainingDays(sub.trial_ends_at) <= 2 ? (
                  <h2 className="text-lg font-bold text-ink leading-snug mb-1">
                    Your trial ends in{' '}
                    <span className="font-mono">{remainingDays(sub.trial_ends_at)}</span>{' '}
                    {remainingDays(sub.trial_ends_at) === 1 ? 'day' : 'days'} — add a payment method to keep {meta.label}
                  </h2>
                ) : (
                  <h2 className="text-lg font-bold text-ink leading-snug mb-1">
                    <span className="font-mono">{remainingDays(sub.trial_ends_at)}</span> days left in your free trial
                  </h2>
                )}
                <p className="text-[13.5px] text-ink-2 leading-relaxed mb-4">
                  You have full {meta.label} access until{' '}
                  <strong className="font-mono">{formatDate(sub.trial_ends_at)}</strong>.
                  No card required — if you do nothing, your account simply returns to Free (5 GB).
                  Your files stay encrypted either way.
                </p>
                <BBButton
                  variant="amber"
                  size="md"
                  onClick={() => void handleConvertTrial()}
                  disabled={convertLoading}
                >
                  {convertLoading ? 'Redirecting...' : 'Add payment method'}
                  {!convertLoading && <Icon name="chevron-right" size={13} className="ml-1.5" />}
                </BBButton>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════
            SUMMARY VIEW (mockup #7) — the default /billing view.
            Compact current-plan card with side-by-side storage meters,
            payment-method SEPA row, and the payment-history table. The
            "Change plan" button flips to the change-plan view (#8). All
            handlers/derived values are the SAME ones used below. (0942)
           ════════════════════════════════════════════════ */}
        {view === 'summary' && (
          <div className="space-y-4">
            {/* Current Plan card */}
            <Card className="overflow-hidden">
              <div className="p-5 grid gap-6 md:grid-cols-2">
                {/* Left: plan + price + actions */}
                <div>
                  <SectionLabel className="mb-2">Current plan</SectionLabel>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-[28px] font-bold tracking-tight leading-none">
                      {meta.label}
                    </span>
                    {effectivePlan !== 'free' && statusBadge()}
                  </div>
                  {effectivePlan !== 'free' && (
                    <div className="font-mono text-[13px] text-ink-2">
                      EUR {formatCentsAsEur(basePriceCents)} / {billingInterval}
                      <span className="text-ink-3">
                        {' · '}billed {sub?.billing_cycle === 'yearly' ? 'annually' : 'monthly'}
                      </span>
                      {/* Coherent breakdown from server truth (task 0947): show
                          the base plan and the storage add-on as their own line
                          instead of one lumped figure, with the per-TB price from
                          the server's storage_addon_price_cents (not hard-coded). */}
                      {currentExtraTB > 0 && (
                        <div className="text-[11px] text-ink-3 mt-0.5">
                          {meta.label} EUR {formatCentsAsEur(basePlanCents)} + {currentExtraTB} TB × EUR {formatCentsAsEur(addonPerTbCents)}/{billingInterval}
                        </div>
                      )}
                    </div>
                  )}
                  {effectivePlan === 'free' && (
                    <div className="text-[13px] text-ink-3">5 GB encrypted storage</div>
                  )}

                  <div className="mt-5 flex items-center gap-3">
                    <BBButton variant="amber" size="md" onClick={() => setView('change')}>
                      <Icon name="arrow-up" size={13} className="mr-1.5" />
                      {effectivePlan === 'free' ? 'Choose a plan' : 'Change plan'}
                    </BBButton>
                    {effectivePlan !== 'free' &&
                      sub?.status !== 'cancelling' &&
                      sub?.status !== 'paused' &&
                      sub?.status !== 'trialing' && (
                        <button
                          className="text-[13px] text-ink-3 hover:text-red transition-colors disabled:opacity-50"
                          onClick={() => setView('change')}
                        >
                          Cancel
                        </button>
                      )}
                  </div>
                </div>

                {/* Right: storage meters (primary amber + secondary add-on) */}
                <div className="md:pl-2">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[13px] text-ink-2">Storage</span>
                    <span className="font-mono text-[13px] font-semibold">
                      {formatStorageSI(usedBytes)}
                      <span className="text-ink-3 font-normal"> / {formatStorageSI(totalStorageBytes)}</span>
                    </span>
                  </div>
                  <MeterBar percent={usedPercent} usagePercent={usedPercent} />

                  {currentExtraTB > 0 && (
                    <>
                      <div className="flex items-baseline justify-between mt-4 mb-2">
                        <span className="text-[13px] text-ink-2">Add-on storage</span>
                        <span className="font-mono text-[13px] font-semibold text-ink-2">
                          +{currentExtraTB} TB
                        </span>
                      </div>
                      <MeterBar percent={100} variant="secondary" />
                      <div className="font-mono text-[11px] text-ink-4 mt-1.5">
                        EUR 10.99 / extra TB · billed {sub?.billing_cycle === 'yearly' ? 'annually' : 'monthly'}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Footer strip: next charge / renews */}
              {sub?.current_period_end &&
                effectivePlan !== 'free' &&
                sub.status !== 'cancelling' &&
                sub.status !== 'paused' && (
                  <div className="flex items-center gap-3 px-5 py-3 border-t border-line bg-paper-2 text-xs">
                    <Icon name="clock" size={13} className="text-ink-3 shrink-0" />
                    <span className="flex-1 text-ink-2">
                      Renews <strong className="font-mono text-ink">{formatDate(sub.current_period_end)}</strong>
                      {paymentMethod?.brand && (
                        <> via <span className="text-ink">{paymentMethod.brand}</span></>
                      )}
                    </span>
                    {currentExtraTB > 0 && (
                      <span className="font-mono text-ink-4">incl. add-on storage</span>
                    )}
                  </div>
                )}
            </Card>

            {/* Payment Method card (#7) — restyled. Binds ONLY to real
                PaymentMethod fields (type/brand/last4/iban_last4/is_default);
                same data + same Update/Add handler as the detailed view. */}
            {effectivePlan !== 'free' && sub?.status !== 'trialing' && pmLoaded && (
              <Card className="overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between border-b border-line">
                  <SectionLabel>Payment method</SectionLabel>
                  <button
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-deep hover:text-amber transition-colors disabled:opacity-50"
                    onClick={() => void handleUpdatePaymentMethod()}
                    disabled={portalLoading}
                  >
                    <Icon name="plus" size={12} />
                    {portalLoading ? 'Redirecting...' : paymentMethod ? 'Update method' : 'Add method'}
                  </button>
                </div>
                <div className="px-5 py-4 flex items-center justify-between gap-4">
                  {paymentMethod ? (
                    // SEPA mandate (#7): a "SEPA" badge + the masked IBAN (mono) and a
                    // muted "{holder} · mandate {ref}" line. We treat it as SEPA when the
                    // method type is directdebit OR the new mandate fields are present.
                    paymentMethod.type === 'directdebit' || paymentMethod.iban_masked || paymentMethod.mandate_reference ? (
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="shrink-0 inline-flex items-center justify-center px-2 py-1 rounded-md border border-line bg-paper-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-2">
                          SEPA
                        </span>
                        <div className="min-w-0">
                          <div className="font-mono text-[13px] text-ink truncate">
                            {paymentMethod.iban_masked
                              ?? (paymentMethod.iban_last4 ? `•••• ${paymentMethod.iban_last4}` : 'SEPA Direct Debit')}
                          </div>
                          {(paymentMethod.account_holder_name || paymentMethod.mandate_reference) && (
                            <div className="text-[11.5px] text-ink-3 mt-0.5 truncate">
                              {paymentMethod.account_holder_name && (
                                <span>{paymentMethod.account_holder_name}</span>
                              )}
                              {paymentMethod.account_holder_name && paymentMethod.mandate_reference && ' · '}
                              {paymentMethod.mandate_reference && (
                                <>mandate <span className="font-mono">{paymentMethod.mandate_reference}</span></>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="shrink-0 inline-flex items-center justify-center px-2 py-1 rounded-md border border-line bg-paper-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-2">
                        {paymentMethod.brand ?? 'Card'}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{paymentMethod.brand ?? 'Card'}</span>
                          {(paymentMethod.iban_last4 || paymentMethod.last4) && (
                            <span className="font-mono text-ink-2">
                              •••• {paymentMethod.iban_last4 ?? paymentMethod.last4}
                            </span>
                          )}
                        </div>
                        {paymentMethod.exp_month && paymentMethod.exp_year && (
                          <div className="text-[11.5px] text-ink-3 mt-0.5">
                            Expires{' '}
                            <span className="font-mono">
                              {String(paymentMethod.exp_month).padStart(2, '0')}/{paymentMethod.exp_year}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    )
                  ) : (
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon name="shield" size={16} className="text-ink-3 shrink-0" />
                      <div className="text-[13px] text-ink-2">No payment method on file</div>
                    </div>
                  )}
                  {paymentMethod?.is_default && (
                    <BBChip variant="green">Default</BBChip>
                  )}
                </div>
              </Card>
            )}

            {/* Payment History (#7) — the 0936 transactions view, restyled, with
                the "Export all" CSV affordance (task 0942) in the header. */}
            <TransactionList
              transactions={transactions}
              variant="card"
              onExport={() => void handleExportTransactions()}
              exporting={exportingTransactions}
            />

            {/* Invoices — the legal VAT documents, downloadable. */}
            <InvoiceList
              invoices={invoices}
              onError={(message) =>
                showToast({ icon: 'download', title: 'Could not download invoice', description: message, danger: true })
              }
            />

            {/* Compliance footer line (#7) */}
            <div className="flex items-center gap-2.5 px-1 pt-1 text-[11.5px] text-ink-3">
              <Icon name="shield" size={13} className="text-ink-4 shrink-0" />
              <span>
                VAT-compliant invoices · Operated by Initlabs B.V. · Stored in Europe under EU law.
              </span>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════
            CHANGE-PLAN VIEW (mockup #8) — opened by "Change plan".
            Identical handlers/state/modals to before; just gated behind the
            view toggle, with a back affordance + the switch-plan tier grid. (0942)
           ════════════════════════════════════════════════ */}
        {view === 'change' && (
        <div className="space-y-6">
        <button
          onClick={() => setView('summary')}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink transition-colors"
        >
          <Icon name="chevron-right" size={13} className="rotate-180" />
          Back to billing
        </button>

        {/* ── Plan summary ──────────────────────────── */}
        <div className="grid gap-4">

          {/* Annual savings prompt — shown to monthly paid subscribers. Moved ABOVE
              the Current plan card (task 0942) to match mockup #8's order:
              savings banner → current plan → switch plan → manage storage → cancel. */}
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
                    Annual billing starts on{' '}
                    <strong className="font-mono">{formatDate(sub?.current_period_end ?? null)}</strong>.
                    Your current monthly period stays active until then — no double charge.
                  </p>
                  {(sub?.extra_storage_tb ?? 0) > 0 && (
                    <p className="text-xs text-ink-3">
                      Your storage add-on ({sub!.extra_storage_tb} TB) will also switch to annual billing on the same date.
                    </p>
                  )}
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
                          {meta.label} EUR {formatCentsAsEur(basePlanCents)} + {currentExtraTB} TB x EUR {formatCentsAsEur(addonPerTbCents)}
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
            {sub?.current_period_end && effectivePlan !== 'free' && sub.status !== 'cancelling' && sub.status !== 'paused' && (
              <div className="flex items-center gap-3 p-3 bg-paper-2 border border-line rounded-lg text-xs">
                <Icon name="clock" size={13} className="text-ink-3 shrink-0" />
                <span className="flex-1">
                  Renews <strong>{formatDate(sub.current_period_end)}</strong>
                </span>
              </div>
            )}

            {/* Paused state — billing collection paused via Stripe pause_collection (task 0544) */}
            {sub?.status === 'paused' && (
              <div className="rounded-lg border border-line-2 bg-paper-2 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Icon name="clock" size={14} className="text-ink-3 shrink-0" />
                      <span className="text-sm font-semibold text-ink">
                        Plan paused
                      </span>
                    </div>
                    <p className="text-xs text-ink-2 leading-relaxed">
                      No charges while paused. Your files stay encrypted and
                      accessible.
                      {sub.pause_until && (
                        <> Billing resumes on{' '}
                          <strong className="font-mono">{formatDate(sub.pause_until)}</strong>.
                        </>
                      )}
                    </p>
                  </div>
                  <BBButton
                    size="sm"
                    variant="amber"
                    onClick={() => void handleResumeSubscription()}
                    disabled={resumeLoading}
                  >
                    {resumeLoading ? 'Resuming...' : 'Resume now'}
                  </BBButton>
                </div>
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
                /* Free plan. When the user is eligible (status not already
                   trialing, trial not previously used), the amber primary action
                   is "Start 14-day free trial" (task 0905, Pattern B — no card).
                   A 409 trial_already_used flips `trialUsed` and we fall back to
                   the normal paid checkout entry. */
                sub?.status !== 'trialing' && !trialUsed ? (
                  <>
                    <BBButton
                      variant="amber"
                      size="md"
                      onClick={() => void handleStartTrial('pro')}
                      disabled={trialStarting !== null}
                    >
                      {trialStarting ? 'Starting trial...' : 'Start 14-day free trial'}
                    </BBButton>
                    <BBButton
                      size="md"
                      onClick={() => openUpgrade('basic')}
                    >
                      Subscribe to Basic
                    </BBButton>
                  </>
                ) : (
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
                )
              ) : sub?.status === 'trialing' ? (
                /* Trialing on a paid plan (task 0905). The user has no Mollie
                   customer yet, so "Manage billing" would dead-end — the primary
                   action is the convert/add-payment CTA instead. */
                <BBButton
                  variant="amber"
                  size="md"
                  onClick={() => void handleConvertTrial()}
                  disabled={convertLoading}
                >
                  {convertLoading ? 'Redirecting...' : 'Add payment method'}
                  {!convertLoading && <Icon name="chevron-right" size={13} className="ml-1.5" />}
                </BBButton>
              ) : (
                // Paid, non-trialing, not cancelling/paused: only show an upgrade
                // CTA when a strictly-higher purchasable tier exists. `nextPlan`
                // is null on the top tier (Pro today), so a Pro user sees no
                // "Upgrade to Pro" — the annual-switch + cancel flows below still
                // render. (task 0934)
                nextPlan && nextPlanDetails && sub?.status !== 'cancelling' && sub?.status !== 'paused' ? (
                  <BBButton
                    variant="amber"
                    size="md"
                    onClick={() => openUpgrade(nextPlan)}
                  >
                    Upgrade to {nextPlanDetails.label}
                  </BBButton>
                ) : null
              )}
            </div>

            {/* Trial offer subtext — honest, no emojis. Only under the Free-plan
                eligible state (task 0905). */}
            {effectivePlan === 'free' && sub?.status !== 'trialing' && !trialUsed && (
              <p className="mt-2.5 text-[11.5px] text-ink-3">
                14 days free. No card required. Cancel anytime — you keep your files.
              </p>
            )}

            {/* Cancel plan — paid plans only, not already cancelling or paused.
                Four steps (task 0544 added 'pause'):
                  idle    → "Cancel plan" link
                  offer   → win-back 50%-off-3-months card (only when eligible)
                  pause   → "Pause instead?" card with 30/60/90-day options
                  confirm → existing cancel-confirmation panel
            */}
            {effectivePlan !== 'free' && sub?.status !== 'cancelling' && sub?.status !== 'paused' && sub?.status !== 'trialing' && (
              cancelStep === 'offer' ? (
                <div className="mt-3 p-3.5 bg-amber-bg/40 border border-amber/30 rounded-lg space-y-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep">
                    Before you go
                  </div>
                  <div className="text-sm text-ink">
                    Wait — stay with us. Get 50% off for the next 3 months.
                  </div>
                  <p className="text-xs text-ink-3">
                    One-time offer, applied to your next invoice. If it still
                    isn&apos;t the right fit after that, you can cancel any
                    time.
                  </p>
                  <div className="flex gap-2">
                    <BBButton
                      size="sm"
                      onClick={() => void handleAcceptWinback()}
                      disabled={winbackAcceptLoading}
                    >
                      {winbackAcceptLoading ? 'Applying...' : 'Accept offer'}
                    </BBButton>
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={() => setCancelStep(pauseSupported ? 'pause' : 'confirm')}
                      disabled={winbackAcceptLoading}
                    >
                      No thanks
                    </BBButton>
                  </div>
                </div>
              ) : cancelStep === 'pause' && pauseSupported ? (
                <div className="mt-3 p-3.5 bg-paper-2 border border-line rounded-lg space-y-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                    Pause instead?
                  </div>
                  <div className="text-sm text-ink">
                    Take a break without losing your data. We stop charging,
                    your files stay encrypted and accessible.
                  </div>
                  <p className="text-xs text-ink-3">
                    Billing resumes automatically when the pause ends. You can
                    resume anytime before then.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {([30, 60, 90] as const).map((days) => (
                      <BBButton
                        key={days}
                        size="sm"
                        onClick={() => void handlePauseSubscription(days)}
                        disabled={pauseLoading !== null}
                      >
                        {pauseLoading === days ? 'Pausing...' : `Pause ${days} days`}
                      </BBButton>
                    ))}
                  </div>
                  <div>
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={() => setCancelStep('confirm')}
                      disabled={pauseLoading !== null}
                    >
                      No thanks, cancel my plan
                    </BBButton>
                  </div>
                </div>
              ) : cancelConfirm ? (
                // Flattened cancel-to-Free panel (task 0944): ONE calm level.
                // No card-in-card. Period-end facts are plain prose; the downsell
                // is a single inline secondary option, not a nested card.
                <div className="mt-3 p-4 bg-paper-2 border border-line rounded-lg space-y-3.5">
                  <div className="text-sm font-semibold text-ink">Cancel your plan?</div>

                  {/* What changes — plain prose, mono for the dates/sizes-as-data */}
                  <p className="text-[13px] text-ink-2 leading-relaxed">
                    Your {meta.label} plan{currentExtraTB > 0 ? ` and ${currentExtraTB} TB of extra storage` : ''} ends{' '}
                    <span className="font-mono text-ink">{formatDate(sub?.current_period_end ?? null)}</span>.
                    After that, your storage drops to <span className="font-mono text-ink">5 GB</span> (Free).
                  </p>
                  {sub?.billing_cycle === 'yearly' && sub.current_period_end && remainingDays(sub.current_period_end) > 0 && (
                    <p className="text-[12px] text-ink-3 leading-relaxed">
                      You have pre-paid <span className="font-mono">EUR {currentPriceYearly.toFixed(2)}</span> for the year — you keep full access until then.
                    </p>
                  )}

                  {/* Honest usage warning + inline Review link */}
                  {usedBytes > 5_000_000_000 && (
                    <p className="text-[13px] text-red leading-relaxed">
                      You&apos;re using <span className="font-mono">{formatStorageSI(usedBytes)}</span> — export anything you need before your plan ends.{' '}
                      <a
                        href="/?sort=size&order=desc"
                        onClick={(e) => { e.preventDefault(); navigate('/?sort=size&order=desc'); setCancelConfirm(false); }}
                        className="underline text-red hover:text-ink transition-colors"
                      >
                        Review my files
                      </a>
                    </p>
                  )}

                  {/* Secondary downsell — a single inline option, NOT a nested card */}
                  {(() => {
                    const currentRank = planRank[effectivePlan] ?? 0
                    const lowerPlans = orderedPaidPlans
                      .filter((p) => (planRank[p] ?? 0) < currentRank && (planRank[p] ?? 0) > 0)
                      .map((p) => ({ id: p, ...(planMeta[p] ?? planMeta.free) }))
                    if (lowerPlans.length === 0) return null
                    return (
                      <div className="pt-1 text-[12.5px] text-ink-3 leading-relaxed">
                        Not ready to lose your storage? Keep more for less:{' '}
                        {lowerPlans.map((lp, i) => (
                          <span key={lp.id}>
                            {i > 0 && <span className="text-ink-4"> · </span>}
                            <button
                              onClick={() => { setCancelConfirm(false); setDowngradeTarget(lp.id); }}
                              className="font-medium text-amber-deep hover:text-amber underline transition-colors"
                            >
                              Switch to {lp.label} (<span className="font-mono">EUR {lp.priceMonthly.toFixed(2)}/mo · {formatStorageSI(lp.storageGB * 1_000_000_000)}</span>)
                            </button>
                          </span>
                        ))}
                      </div>
                    )
                  })()}

                  {/* Actions — Keep plan primary, Cancel plan danger-secondary */}
                  <div className="flex gap-2 pt-1">
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
                    className="text-[11.5px] text-ink-4 hover:text-red transition-colors disabled:opacity-50"
                    onClick={() => void startCancelFlow()}
                    disabled={winbackStartingLoading}
                  >
                    {winbackStartingLoading ? 'Cancel plan...' : 'Cancel plan'}
                  </button>
                </div>
              )
            )}
          </div>

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

        {/* ── Switch Plan tier grid (mockup #8) ───────────
            Presentational tier selector. Each tier routes through the SAME
            existing handlers: an upgrade opens UpgradeDialog (openUpgrade);
            a downgrade opens DowngradeDialog (setDowngradeTarget); the current
            tier is just marked. No new data flow. */}
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-line">
            <SectionLabel className="mb-1">Switch plan</SectionLabel>
            <div className="text-sm text-ink-2">
              Move to a different tier. Changes apply at your next renewal.
            </div>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(() => {
              // Same downgrade set the (now-removed) legacy "smaller plan" block
              // used, so the tier grid's downgrade affordances route identically.
              const downgradeSet = new Set(getDowngradeOptions(effectivePlan))
              // Pricing v2: show the marketed tiers (Basic, Pro, Teams). Free is
              // not marketed, but a subscriber currently ON it must still see
              // their own tier, so include effectivePlan.
              // Order follows CANONICAL_PLAN_SLUGS for a stable low→high layout.
              const marketedSet = new Set<string>(MARKETED_PLAN_SLUGS)
              const tierSlugs = CANONICAL_PLAN_SLUGS.filter(
                (slug) => marketedSet.has(slug) || slug === effectivePlan,
              )
              return tierSlugs.map((slug) => {
              const pm = planMeta[slug]
              if (!pm) return null
              const isCurrent = slug === effectivePlan
              const currentRank = planRank[effectivePlan] ?? 0
              const slugRank = planRank[slug] ?? 0
              const isUpgrade = slugRank > currentRank && pm.comingSoon !== true
              const isDown = downgradeSet.has(slug) || (slug === 'free' && effectivePlan !== 'free')
              const comingSoon = pm.comingSoon === true
              return (
                <div
                  key={slug}
                  className={`relative rounded-lg border p-4 flex flex-col ${
                    isCurrent ? 'border-amber bg-amber-bg/30' : 'border-line bg-paper'
                  }`}
                >
                  {isCurrent && (
                    <span className="absolute -top-2 right-3 px-1.5 py-0.5 rounded bg-amber text-[oklch(0.22_0.01_70)] text-[9px] font-bold uppercase tracking-wider">
                      Current
                    </span>
                  )}
                  {!isCurrent && comingSoon && (
                    <span className="absolute -top-2 right-3 px-1.5 py-0.5 rounded bg-paper-3 border border-line text-ink-3 text-[9px] font-bold uppercase tracking-wider">
                      Later this year
                    </span>
                  )}
                  <div className={`text-sm font-bold mb-0.5 ${comingSoon && !isCurrent ? 'text-ink-3' : 'text-ink'}`}>
                    {pm.label}
                  </div>
                  <div className="font-mono text-[12px] text-ink-2 mb-0.5">
                    {pm.priceMonthly === 0 ? 'EUR 0/mo' : `EUR ${pm.priceMonthly.toFixed(2)}/mo`}
                  </div>
                  <div className="text-[11px] text-ink-3 mb-3">
                    {slug === 'free'
                      ? '5 GB'
                      : slug === 'business'
                        ? `${formatStorageSI(pm.storageGB * 1_000_000_000)} · 2 seats`
                        : `${formatStorageSI(pm.storageGB * 1_000_000_000)} base`}
                  </div>
                  <div className="mt-auto">
                    {isCurrent ? (
                      <span className="text-[11px] text-ink-3">Your plan</span>
                    ) : comingSoon ? (
                      <span className="text-[11px] text-ink-4">Notify me</span>
                    ) : isUpgrade ? (
                      <button
                        onClick={() => openUpgrade(slug)}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-amber-deep hover:text-amber transition-colors"
                      >
                        Upgrade
                        <Icon name="chevron-right" size={11} />
                      </button>
                    ) : isDown ? (
                      <button
                        onClick={() => slug === 'free' ? void startCancelFlow() : setDowngradeTarget(slug)}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-3 hover:text-ink transition-colors"
                      >
                        Downgrade
                        <Icon name="chevron-right" size={11} />
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })
            })()}
          </div>
        </Card>

        {/* ── Payment method (native, task 0925) ─────────
            Paid, non-trialing subscribers manage their card here — no Stripe
            hosted portal. Shows the card on file (brand + last4 + expiry, digits
            in mono) with a secondary "Update payment method", or an honest "No
            payment method on file" + "Add payment method" when the server has
            none (404). The button redirects to the provider's hosted re-auth. */}
        {effectivePlan !== 'free' && sub?.status !== 'trialing' && pmLoaded && (
          <div className="border border-line rounded-xl overflow-hidden bg-paper">
            <div className="px-5 py-4 border-b border-line">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                Payment method
              </div>
            </div>
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              {paymentMethod ? (
                <div className="flex items-center gap-3 min-w-0">
                  <Icon name="shield" size={16} className="text-ink-3 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{paymentMethod.brand ?? 'Card'}</span>
                      {paymentMethod.last4 && (
                        <span className="font-mono text-ink-2">•••• {paymentMethod.last4}</span>
                      )}
                    </div>
                    {paymentMethod.exp_month && paymentMethod.exp_year && (
                      <div className="text-[11.5px] text-ink-3 mt-0.5">
                        Expires{' '}
                        <span className="font-mono">
                          {String(paymentMethod.exp_month).padStart(2, '0')}/{paymentMethod.exp_year}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 min-w-0">
                  <Icon name="shield" size={16} className="text-ink-3 shrink-0" />
                  <div className="text-[13px] text-ink-2">No payment method on file</div>
                </div>
              )}
              <BBButton
                size="sm"
                variant="ghost"
                onClick={() => void handleUpdatePaymentMethod()}
                disabled={portalLoading}
              >
                {portalLoading
                  ? 'Redirecting...'
                  : paymentMethod
                    ? 'Update payment method'
                    : 'Add payment method'}
              </BBButton>
            </div>
          </div>
        )}

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

        {/* Legacy "Switch to a smaller plan" downgrade cards removed in 0942 —
            the Switch Plan tier grid above now drives downgrades via the SAME
            setDowngradeTarget handler (and getDowngradeOptions). The pending-
            downgrade status + cooldown still surface in the Current plan card. */}

        {/* Payment history + invoices live in the summary view (#7); not
            duplicated here. Invoice preferences (a management setting) stays. */}

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
        </div>
        )}

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

      {/* Upgrade dialog */}
      <UpgradeDialog
        planId={upgradePlan}
        planName={upgradePlanDetails?.label ?? 'Pro'}
        pricePerSeat={upgradePlanDetails?.priceMonthly ?? 39.95}
        priceYearlySeat={upgradePlanDetails?.priceYearly ?? 383.52}
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        onBeforeRedirect={(plan, cycle) => setPendingCheckout('plan', plan, cycle, makePreState(sub))}
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
