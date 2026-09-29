/**
 * /choose-plan — start the trial with a payment mandate (task 1037).
 *
 * Every new account lands here after onboarding (there are no free accounts),
 * and the needs_plan route gate sends such an account back here from every
 * other app route. Flow:
 *
 *   1. plan + cycle (preselected from the signup plan intent) + payment method
 *      (Card: €0 authorization / iDEAL: €0.01 verification, refunded)
 *   2. billing details — the SAME BillingInfoStep the paid checkout uses:
 *      `/billing/trial/checkout` resolves VAT exactly like `/billing/checkout`
 *      and refuses with `billing_profile_required` without a profile. Its
 *      vat-preview shows the VAT-inclusive price charged after the trial.
 *   3. `POST /billing/trial/checkout` → persist a pending `kind: 'trial'`
 *      intent with the payment id → Mollie.
 *   4. Mollie returns to `/choose-plan?returned=1`: reconcile against
 *      `GET /billing/payment/{id}/status` + `GET /billing/subscription` (and the
 *      `billing_updated` WS event) until the subscription is trialing, then go
 *      to the drive. A failed/cancelled/expired payment shows an inline error
 *      and lets the user try again.
 *
 * A `trial_already_used` 409 goes to normal paid checkout (/billing?view=change).
 * The pure decisions live in `src/lib/trial-checkout.ts` (unit-tested).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BBButton, Icon } from '@beebeeb/shared'
import { AuthShell } from '../components/auth-shell'
import { BillingInfoStep } from '../components/billing/BillingInfoStep'
import { TrialMethodPicker, TrialPlanPicker } from '../components/trial-plan-picker'
import { useToast } from '../components/toast'
import { useAuth } from '../lib/auth-context'
import { useDriveData } from '../lib/drive-data-context'
import { useWsEvent } from '../lib/ws-context'
import { useKeys } from '../lib/key-context'
import { flushDeferredWelcomeFile } from '../lib/welcome-file-upload'
import {
  createCheckoutSession,
  getPaymentStatus,
  getPlans,
  getSubscription,
  startTrialCheckout,
  type Plan,
  type Subscription,
} from '../lib/api'
import { resolveAccountState, PAID_CHECKOUT_PATH } from '../lib/account-state'
import { resolveHasUsedTrial } from '../lib/trial-eligibility'
import {
  clearPlanIntent,
  parsePlanIntent,
  readPlanIntent,
  savePlanIntent,
  type BillingCycle,
} from '../lib/plan-intent'
import {
  clearPendingCheckout,
  getPendingCheckout,
  makePreState,
  setPendingCheckout,
} from '../lib/pending-checkout'
import {
  DEFAULT_TRIAL_PLAN,
  buildTrialPlanOptions,
  choosePlanEntry,
  classifyTrialCheckoutError,
  formatEur,
  isTrialPlanSlug,
  startTrialLabel,
  trialChargeDate,
  trialPriceLabel,
  trialReturnFailedCopy,
  trialReturnOutcome,
  trialTermsCopy,
  trialBlockedCopy,
  type MandatePaymentStatus,
  type TrialMethod,
  type TrialPlanSlug,
} from '../lib/trial-checkout'
import { userFriendlyError } from '../lib/user-friendly-error'

type Step = 'pick' | 'billing' | 'reconcile' | 'blocked'
/** What the billing-details step leads to: the trial mandate, or (when this
 *  card / bank account already had a trial) a normal paid checkout. */
type BillingPurpose = 'trial' | 'paid'
type ReconcileState =
  | { kind: 'checking' }
  | { kind: 'slow' }
  | { kind: 'failed'; status: MandatePaymentStatus | null }

/** How long the return screen polls before it says "still waiting". */
const RECONCILE_WINDOW_MS = 60_000

function toTrialPlan(slug: string | null | undefined): TrialPlanSlug | null {
  if (isTrialPlanSlug(slug)) return slug
  return slug === 'personal' ? 'basic' : null
}

export function ChoosePlan() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { user } = useAuth()
  const { getMasterKey } = useKeys()
  const { planDetails, applySubscription, refreshPlanDetails } = useDriveData()
  const sub = planDetails.subscription

  const returned = searchParams.get('returned') === '1'
  const fromBilling = searchParams.get('from') === 'billing'

  // Preselection: an explicit ?plan=&cycle= (billing, onboarding) wins over the
  // intent saved on /signup; Basic monthly when there is neither.
  const initialIntent = useMemo(
    () => parsePlanIntent(searchParams.get('plan'), searchParams.get('cycle')) ?? readPlanIntent(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first render only
    [],
  )
  const [plan, setPlan] = useState<TrialPlanSlug>(toTrialPlan(initialIntent?.plan) ?? DEFAULT_TRIAL_PLAN)
  const [cycle, setCycle] = useState<BillingCycle>(initialIntent?.cycle ?? 'monthly')
  const [method, setMethod] = useState<TrialMethod>('creditcard')
  const [apiPlans, setApiPlans] = useState<Plan[] | null>(null)
  useEffect(() => {
    getPlans().then(setApiPlans).catch(() => { /* plan-constants fallback */ })
  }, [])
  const options = useMemo(() => buildTrialPlanOptions(apiPlans), [apiPlans])
  const selected = options.find((o) => o.id === plan) ?? options[0]
  const trialDays = selected.trialDays
  const price = cycle === 'yearly' ? selected.priceYearly : selected.priceMonthly

  // ── Arrival decision (once) ────────────────────────────────────────────
  const [step, setStep] = useState<Step | null>(null)
  const [purpose, setPurpose] = useState<BillingPurpose>('trial')
  // One trial per payment method: why the server started no trial after a
  // paid mandate (`trial_block_reason`), from the reconcile or the cached sub.
  const [blockReason, setBlockReason] = useState<string | null>(null)
  const knownBlockReason = blockReason ?? sub?.trial_block_reason ?? null
  const decidedRef = useRef(false)
  useEffect(() => {
    if (decidedRef.current) return
    decidedRef.current = true
    const entry = choosePlanEntry({
      accountState: resolveAccountState(sub),
      returned,
      fromBilling,
      subStatus: sub?.status,
      effectivePlan: sub?.status === 'cancelled' ? 'free' : sub?.plan ?? 'free',
      hasUsedTrial: resolveHasUsedTrial(sub?.has_used_trial, false),
    })
    if (entry.kind === 'redirect') {
      navigate(entry.to, { replace: true })
      return
    }
    setStep(entry.kind === 'reconcile' ? 'reconcile' : 'pick')
  }, [sub, returned, fromBilling, navigate])

  // ── Return reconcile ───────────────────────────────────────────────────
  const [reconcile, setReconcile] = useState<ReconcileState>({ kind: 'checking' })
  const paymentIdRef = useRef<string | undefined>(undefined)
  const lastStatusRef = useRef<MandatePaymentStatus | null>(null)
  const finishedRef = useRef(false)

  const goLive = useCallback(
    async (latest: Subscription) => {
      if (finishedRef.current) return
      finishedRef.current = true
      clearPendingCheckout()
      clearPlanIntent()
      // The welcome file onboarding deferred while the account had no plan
      // (src/lib/welcome-file.ts) — upload it now, once, so the drive shows it
      // on arrival. Bounded: a slow upload never holds the user here.
      if (user?.user_id) {
        try {
          const masterKey = getMasterKey(user.user_id)
          await Promise.race([
            flushDeferredWelcomeFile(user.user_id, masterKey),
            new Promise((r) => setTimeout(r, 15_000)),
          ])
        } catch {
          /* key not resident — the route gate retries on the next page */
        }
      }
      // The gate reads the shared cache: put the trialing subscription in it
      // BEFORE navigating, or "/" would bounce straight back here.
      applySubscription(latest)
      window.dispatchEvent(new Event('beebeeb:plan-changed'))
      refreshPlanDetails()
      const days = latest.trial_ends_at
        ? Math.max(1, Math.ceil((new Date(latest.trial_ends_at).getTime() - Date.now()) / 86_400_000))
        : trialDays
      showToast({
        icon: 'check',
        title: 'Your free trial has started',
        description: `${days} days of full access. Your files are encrypted before they leave this device.`,
      })
      navigate('/', { replace: true })
    },
    [applySubscription, refreshPlanDetails, showToast, navigate, trialDays, user, getMasterKey],
  )

  /** One reconcile pass. Returns true once it reached a final outcome. */
  const checkOnce = useCallback(async (): Promise<boolean> => {
    if (finishedRef.current) return true
    const paymentId = paymentIdRef.current
    if (paymentId) {
      try {
        const r = await getPaymentStatus(paymentId)
        lastStatusRef.current = r.status
      } catch {
        /* older server / transient — the subscription still decides success */
      }
    }
    let latest: Subscription | null = null
    try {
      latest = await getSubscription()
    } catch {
      /* transient — keep polling */
    }
    const outcome = trialReturnOutcome(lastStatusRef.current, latest)
    if (outcome === 'live' && latest) {
      await goLive(latest)
      return true
    }
    if (outcome === 'failed') {
      setReconcile({ kind: 'failed', status: lastStatusRef.current })
      return true
    }
    if (outcome === 'blocked' && latest) {
      // The card / bank account already had a trial: no trial started (the
      // iDEAL cent is refunded). Stop polling; offer paid checkout or another
      // payment method.
      finishedRef.current = true
      clearPendingCheckout()
      setBlockReason(latest.trial_block_reason ?? null)
      setStep('blocked')
      return true
    }
    return false
  }, [goLive])

  const [pollRun, setPollRun] = useState(0)
  useEffect(() => {
    if (step !== 'reconcile') return
    paymentIdRef.current = getPendingCheckout()?.paymentId
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const deadline = Date.now() + RECONCILE_WINDOW_MS
    let attempt = 0
    setReconcile({ kind: 'checking' })
    const tick = async () => {
      if (cancelled) return
      const done = await checkOnce()
      if (cancelled || done) return
      if (Date.now() >= deadline) {
        setReconcile({ kind: 'slow' })
        return
      }
      attempt += 1
      timer = setTimeout(() => void tick(), Math.min(1500 + attempt * 250, 4000))
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [step, pollRun, checkOnce])

  // The webhook's `billing_updated` event confirms faster than the next tick.
  useWsEvent(['billing_updated'], () => {
    if (step === 'reconcile') void checkOnce()
  })

  function tryAgain() {
    finishedRef.current = false
    lastStatusRef.current = null
    clearPendingCheckout()
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete('returned')
        return p
      },
      { replace: true },
    )
    setPurpose('trial')
    setStep('pick')
  }

  /** Blocked trial → the billing-details step, then a normal paid checkout. */
  function subscribeNow() {
    setPurpose('paid')
    setStep('billing')
  }

  // ── Pick → billing details → Mollie ─────────────────────────────────────
  function choosePlan(next: TrialPlanSlug) {
    setPlan(next)
    savePlanIntent({ plan: next, cycle })
  }
  function chooseCycle(next: BillingCycle) {
    setCycle(next)
    savePlanIntent({ plan, cycle: next })
  }

  const startCheckout = useCallback(async () => {
    try {
      const { url, payment_id } = await startTrialCheckout({ plan, billing_cycle: cycle, method })
      savePlanIntent({ plan, cycle })
      setPendingCheckout('trial', plan, cycle, makePreState(sub), payment_id)
      window.location.href = url
    } catch (err) {
      const kind = classifyTrialCheckoutError(err)
      if (kind === 'trial_used') {
        showToast({
          icon: 'clock',
          title: 'You have already used your free trial',
          description: 'Choose a plan to subscribe — your files stay encrypted either way.',
        })
        navigate(PAID_CHECKOUT_PATH, { replace: true })
        return
      }
      if (kind === 'has_plan') {
        showToast({ icon: 'check', title: 'You already have a plan', description: 'Taking you to your vault.' })
        refreshPlanDetails()
        navigate('/', { replace: true })
        return
      }
      if (kind === 'billing_profile') {
        // BillingInfoStep just saved it; surface inline and let them re-submit.
        throw new Error('Add your billing details to start the trial.')
      }
      // Re-throw so BillingInfoStep shows it inline and resets its button.
      throw new Error(userFriendlyError(err))
    }
  }, [plan, cycle, method, sub, showToast, navigate, refreshPlanDetails])

  // Paid checkout for the selected plan + cycle — the path for a card / bank
  // account that already had a trial. Same request + pending intent as every
  // other plan purchase; Mollie returns to /billing?upgraded=true (open to a
  // needs_plan account), where the existing reconcile confirms it.
  const startPaidCheckout = useCallback(async () => {
    try {
      const { url, payment_id } = await createCheckoutSession({ plan, billing_cycle: cycle })
      setPendingCheckout('plan', plan, cycle, makePreState(sub), payment_id)
      window.location.href = url
    } catch (err) {
      if (classifyTrialCheckoutError(err) === 'billing_profile') {
        throw new Error('Add your billing details to subscribe.')
      }
      throw new Error(userFriendlyError(err))
    }
  }, [plan, cycle, sub])

  const chargeDate = trialChargeDate(trialDays)
  const todayLabel = method === 'ideal' ? '€0.01' : '€0.00'
  const todayCaption =
    method === 'ideal'
      ? 'iDEAL verification, refunded automatically'
      : 'Card authorization only — nothing is charged'
  const isNeedsPlan = resolveAccountState(sub) === 'needs_plan'

  if (step === null) {
    return (
      <div className="flex items-center justify-center min-h-screen" aria-busy="true">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
      </div>
    )
  }

  const footer = (
    <div className="border-t border-line mt-5 pt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-3">
      {user?.email && (
        <span className="font-mono text-[11px] text-ink-4 truncate max-w-full" data-testid="choose-plan-account">
          {user.email}
        </span>
      )}
      <span className="flex items-center gap-4 ml-auto">
        {!isNeedsPlan && fromBilling && (
          <Link to="/settings/billing" className="hover:text-ink transition-colors">
            Back to billing
          </Link>
        )}
        <Link to="/logout" className="hover:text-ink transition-colors" data-testid="choose-plan-logout">
          Log out
        </Link>
        <Link
          to="/settings/delete-account"
          className="hover:text-red transition-colors"
          data-testid="choose-plan-delete-account"
        >
          Delete account
        </Link>
      </span>
    </div>
  )

  if (step === 'reconcile') {
    return (
      <AuthShell
        wide
        title={reconcile.kind === 'failed' ? 'Your trial has not started' : 'Confirming your payment method'}
        subtitle={
          reconcile.kind === 'failed'
            ? undefined
            : 'Mollie is confirming your mandate. This usually takes a few seconds.'
        }
        hideTrust
      >
        <div data-testid="choose-plan-reconcile">
          {reconcile.kind === 'checking' && (
            <div className="flex items-center gap-3 rounded-md border border-line bg-paper-2 px-4 py-3.5">
              <span className="inline-block w-4 h-4 border-2 border-ink/15 border-t-amber rounded-full animate-spin shrink-0" />
              <span className="text-[13px] text-ink-2">Checking with Mollie…</span>
            </div>
          )}
          {reconcile.kind === 'slow' && (
            <div className="rounded-md border border-line bg-paper-2 px-4 py-3.5" data-testid="choose-plan-slow">
              <p className="text-[13px] text-ink mb-1 font-medium">Still waiting for confirmation</p>
              <p className="text-[12px] text-ink-3 leading-relaxed mb-3">
                Your trial starts as soon as Mollie confirms the payment method — this page updates on its own. If
                you closed the payment page without finishing, choose a plan again.
              </p>
              <div className="flex flex-wrap gap-2">
                <BBButton size="sm" variant="default" onClick={() => setPollRun((n) => n + 1)}>
                  Check again
                </BBButton>
                <BBButton size="sm" variant="ghost" onClick={tryAgain}>
                  Choose again
                </BBButton>
              </div>
            </div>
          )}
          {reconcile.kind === 'failed' && (
            <div
              role="alert"
              className="rounded-md border border-red/30 bg-red/5 px-4 py-3.5"
              data-testid="choose-plan-failed"
            >
              <div className="flex items-start gap-2.5">
                <Icon name="x" size={14} className="text-red shrink-0 mt-[2px]" />
                <p className="text-[13px] text-ink-2 leading-relaxed">{trialReturnFailedCopy(reconcile.status)}</p>
              </div>
              <BBButton variant="amber" size="lg" className="w-full justify-center mt-3.5" onClick={tryAgain}>
                Try again
              </BBButton>
            </div>
          )}
          {footer}
        </div>
      </AuthShell>
    )
  }

  if (step === 'blocked') {
    return (
      <AuthShell wide title="No free trial for this payment method" hideTrust>
        <div data-testid="choose-plan-blocked">
          <div role="alert" className="rounded-md border border-line bg-paper-2 px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <Icon name="info" size={14} className="text-amber-deep shrink-0 mt-[2px]" />
              <p className="text-[13px] text-ink-2 leading-relaxed" data-testid="choose-plan-blocked-copy">
                {trialBlockedCopy(knownBlockReason)}
              </p>
            </div>
            <p className="text-[11.5px] text-ink-3 leading-relaxed mt-2 pl-[22px]">
              Nothing was charged for the verification — an iDEAL cent is refunded automatically.
            </p>
          </div>
          <div className="mt-4 flex items-baseline gap-2 text-[13px]" data-testid="choose-plan-blocked-plan">
            <span className="font-medium text-ink">{selected.name}</span>
            <span className="text-ink-3">·</span>
            <span className="font-mono text-ink">{trialPriceLabel(price, cycle)}</span>
            <span className="text-ink-3 text-[12px]">· charged today, cancel any time</span>
          </div>
          <BBButton
            variant="amber"
            size="lg"
            className="w-full justify-center mt-3"
            onClick={subscribeNow}
            data-testid="choose-plan-subscribe"
          >
            Subscribe to {selected.name}
            <Icon name="chevron-right" size={13} className="ml-1" />
          </BBButton>
          <BBButton
            variant="ghost"
            size="lg"
            className="w-full justify-center mt-2"
            onClick={tryAgain}
            data-testid="choose-plan-other-method"
          >
            Use a different payment method
          </BBButton>
          {footer}
        </div>
      </AuthShell>
    )
  }

  if (step === 'billing' && purpose === 'paid') {
    return (
      <AuthShell
        wide
        title={`Subscribe to ${selected.name}`}
        subtitle="For your invoices and VAT. You are charged today; cancel any time."
        hideTrust
      >
        <div className="flex items-center gap-2 mb-4 text-[12px] text-ink-3" data-testid="choose-plan-billing-summary">
          <span className="font-medium text-ink">{selected.name}</span>
          <span className="text-line-2">·</span>
          <span className="font-mono">{trialPriceLabel(price, cycle)}</span>
        </div>
        <BillingInfoStep
          planId={plan}
          planName={selected.name}
          cycle={cycle}
          netCentsFallback={Math.round(price * 100)}
          onProceed={startPaidCheckout}
          onBack={() => setStep(knownBlockReason ? 'blocked' : 'pick')}
          summaryNote={`Charged today, then every ${cycle === 'yearly' ? 'year' : 'month'} until you cancel.`}
        />
        {footer}
      </AuthShell>
    )
  }

  if (step === 'billing') {
    return (
      <AuthShell
        wide
        title="Billing details"
        subtitle={`For your invoices and VAT. Nothing is charged until day ${trialDays + 1}.`}
        hideTrust
      >
        <div className="flex items-center gap-2 mb-4 text-[12px] text-ink-3" data-testid="choose-plan-billing-summary">
          <span className="font-medium text-ink">{selected.name}</span>
          <span className="text-line-2">·</span>
          <span className="font-mono">{trialPriceLabel(price, cycle)}</span>
          <span className="text-line-2">·</span>
          <span>{method === 'ideal' ? 'iDEAL' : 'Card'}</span>
          <button
            type="button"
            className="ml-auto text-amber-deep hover:underline cursor-pointer"
            onClick={() => setStep('pick')}
          >
            Change
          </button>
        </div>
        <BillingInfoStep
          planId={plan}
          planName={selected.name}
          cycle={cycle}
          netCentsFallback={Math.round(price * 100)}
          onProceed={startCheckout}
          onBack={() => setStep('pick')}
          proceedLabel={startTrialLabel(trialDays)}
          summaryNote={`First charged on ${chargeDate}, after your ${trialDays}-day trial. Cancel any time before and nothing is charged.`}
          footnote={
            method === 'ideal'
              ? 'Next: iDEAL at Mollie. €0.01 verifies your account and is refunded automatically.'
              : 'Next: your card at Mollie. It is authorized for €0 — nothing is charged today.'
          }
        />
        {footer}
      </AuthShell>
    )
  }

  // step === 'pick'
  return (
    <AuthShell
      wide
      title="Choose your plan"
      subtitle={
        isNeedsPlan
          ? `Your encrypted vault is ready. Start your ${trialDays}-day free trial to begin uploading.`
          : `Start your ${trialDays}-day free trial.`
      }
      hideTrust
    >
      <div className="flex flex-col gap-[18px]" data-testid="choose-plan">
        {knownBlockReason && (
          <div className="rounded-md border border-line bg-paper-2 px-3.5 py-3" data-testid="choose-plan-block-note">
            <p className="text-[12.5px] text-ink-2 leading-relaxed">{trialBlockedCopy(knownBlockReason)}</p>
            <button
              type="button"
              onClick={subscribeNow}
              className="mt-1.5 text-[12.5px] font-medium text-amber-deep hover:underline cursor-pointer"
            >
              Subscribe to {selected.name} now
            </button>
          </div>
        )}
        <TrialPlanPicker
          options={options}
          plan={plan}
          cycle={cycle}
          onPlanChange={choosePlan}
          onCycleChange={chooseCycle}
        />
        <TrialMethodPicker method={method} onChange={setMethod} />

        {/* Summary — dark block, as in the upgrade flow (hifi-billing HiUpgradeFlow). */}
        <div className="p-3.5 bg-ink text-paper rounded-md" data-testid="choose-plan-summary">
          <div className="flex items-baseline mb-0.5">
            <span className="text-[13px] opacity-70">Today</span>
            <span className="font-mono text-base font-semibold text-amber ml-auto">{todayLabel}</span>
          </div>
          <div className="text-[11px] opacity-60 mb-2">{todayCaption}</div>
          <div className="flex items-baseline border-t border-paper/15 pt-2">
            <span className="text-[13px] opacity-70">From {chargeDate}</span>
            <span className="font-mono text-[13px] font-semibold ml-auto">{trialPriceLabel(price, cycle)}</span>
          </div>
          <div className="text-[11px] opacity-60">
            {selected.name} · {selected.storageLabel} · charged automatically unless you cancel
            {cycle === 'yearly' && ` · ${formatEur(Math.round((price / 12) * 100) / 100)}/month equivalent`}
          </div>
        </div>

        <div className="flex items-start gap-2" data-testid="trial-terms">
          <Icon name="clock" size={13} className="text-amber-deep shrink-0 mt-[2px]" />
          <p className="text-[11.5px] text-ink-2 leading-relaxed">{trialTermsCopy(trialDays)}</p>
        </div>

        <BBButton
          variant="amber"
          size="lg"
          className="w-full justify-center"
          data-testid="choose-plan-continue"
          onClick={() => {
            savePlanIntent({ plan, cycle })
            setPurpose('trial')
            setStep('billing')
          }}
        >
          Continue
          <Icon name="chevron-right" size={13} className="ml-1" />
        </BBButton>
        <p className="text-[11px] text-ink-4 text-center -mt-2.5">
          Next: billing details, then {method === 'ideal' ? 'iDEAL' : 'your card'} at Mollie.
        </p>
      </div>
      {footer}
    </AuthShell>
  )
}
