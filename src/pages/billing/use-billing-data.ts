/**
 * The billing page's data: server state, the money and plan math, and the load plus reconcile effects.
 *
 * State, data and derived values for the billing page (task W run 5).
 *
 * The hook is the whole data half of the old single-component page: the router
 * bits, the drive context, the server fetches (`loadData`), the checkout
 * reconcile/watchdog effects, the subscription state and every derived value
 * the views read. Server calls and their side-effect ordering are unchanged;
 * only the location moved.
 *
 * Must not: render, or own the checkout-return and cancel handlers.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { isCheckoutReturn } from '../../lib/checkout-return'
import { useToast } from '../../components/toast'
import {
  getSubscription,
  getPaymentStatus,
  getBillingInvoices,
  getBillingCreditNotes,
  type BillingCreditNote,
  getBillingTransactions,
  getPlans,
  listFiles,
  getPaymentMethod,
  getPreference,
  getStorageAddons,
  type Subscription,
  type BillingInvoice,
  type BillingTransaction,
  type Plan,
  type DriveFile,
  type StorageAddonState,
  type StorageAddonPreview,
  type PaymentMethod,
} from '../../lib/api'
import { useDriveData } from '../../lib/drive-data-context'
import { useStartNoCardTrial } from '../../hooks/use-start-no-card-trial'
import { noCardTrialStatus, trialEndedStatus, trialOfferView } from '../../lib/no-card-trial'
import { useWsEvent } from '../../lib/ws-context'
import { type BillingResetNavigationState } from '../../lib/billing-reset'
import { resolveMeterTotalBytes, resolveCurrentTotalBytes, storageAllocationBreakdown } from '../../lib/storage-totals'
import {
  planCanAddStorage,
  planMaxExtraTB,
  planBaseTB,
  planMonthlyCostCents,
} from '../../lib/plan-pricing'
import {
  cycleSwitchTargetTotalCents,
  type BillingCycle,
} from '../../lib/cycle-switch-copy'
import {
  type PendingCheckout,
  clearPendingCheckout,
  getPendingCheckout,
} from '../../lib/pending-checkout'
import {
  reflectsUpgrade as reflectsUpgradeCore,
  reflectsUpgradeNoIntent,
  reconcileSignalOutcome,
} from '../../lib/checkout-reconcile'
import { resolveHasUsedTrial, isTrialEligible } from '../../lib/trial-eligibility'
import { parsePlanIntent, clearPlanIntent } from '../../lib/plan-intent'
import { resolveAccountState } from '../../lib/account-state'
import { billingPeriodLine } from '../../lib/billing-period-line'
import {
  cancelledCardCopy,
  isTrialCapped,
} from '../../lib/trial-limits-copy'
import {
  confirmPaymentBy,
  holdDateLabel,
} from '../../lib/confirm-payment'
import {
  fallbackUpgradePlanIds,
  formatDate,
  planMeta,
  planRank,
  upgradeCardFromApiPlan,
  upgradeCardFromFallback,
  upgradeCardFromPlanMeta,
} from './upgrade-plans'
import { useReducer } from 'react'
import {
  billingFlowReducer,
  initialBillingFlow,
  type CancelFlowState,
  type CheckoutReturnState,
  type CycleSwitchTarget,
} from './payment-machine'

export function useBillingData() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
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
  const { usage: contextUsage, planDetails: contextPlanDetails, refreshPlanDetails, refreshUsage, accountDocument, accountStateLabel } = useDriveData()
  // Task 1757: the onboarding document is the authority on the no-card trial (offer, running
  // status, ended status); `null` for each when the document is unavailable (legacy fallback).
  const trialOffer = trialOfferView(accountDocument)
  const noCardTrial = noCardTrialStatus(accountDocument, Date.now(), undefined, contextUsage?.used_bytes)
  const trialEnded = trialEndedStatus(accountDocument)
  const startNoCardTrial = useStartNoCardTrial()

  // Task 1706 review #132-A — clear the transient add-on authority override on
  // the next successful contextUsage refresh: every delivery is a new object
  // (identity changes even when the numbers are unchanged), so the moment the
  // drive context holds fresh usage the normal server-truth-first hierarchy is
  // trustworthy again. Setting the already-current value is a no-op re-render
  // (React bails out), so this is safe to run on every identity change.
  useEffect(() => {
    setAddonAuthorityOverride(false)
  }, [contextUsage])
  // sub comes from context; re-synced after cancel/reactivate via loadData
  const [sub, setSub] = useState<Subscription | null>(contextPlanDetails.subscription)
  const [invoices, setInvoices] = useState<BillingInvoice[]>([])
  const [creditNotes, setCreditNotes] = useState<BillingCreditNote[]>([])
  const [transactions, setTransactions] = useState<BillingTransaction[]>([])
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [files, setFiles] = useState<DriveFile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradePlan, setUpgradePlan] = useState<string>('pro')
  const [portalLoading, setPortalLoading] = useState(false)
  const [payOverdueLoading, setPayOverdueLoading] = useState(false)
  // The page's small UI state machines — the cancel flow, the trial-cancel
  // confirm, the billing-cycle switch prompt and the checkout-return banner —
  // are one typed reducer (see ./payment-machine.ts for the state union, the
  // event union and the transitions). The names below are thin adapters so the
  // handlers and markup keep their original vocabulary.
  const [flow, dispatchFlow] = useReducer(billingFlowReducer, initialBillingFlow)
  const cancelStep = flow.cancelFlow
  const cancelConfirm = cancelStep === 'confirm'
  const setCancelStep = (state: CancelFlowState) => dispatchFlow({ type: 'cancel-flow', state })
  const setCancelConfirm = (confirming: boolean) => dispatchFlow({ type: 'cancel-confirm', confirming })
  const trialCancelConfirm = flow.trialCancelConfirm
  const setTrialCancelConfirm = (confirming: boolean) => dispatchFlow({ type: 'trial-cancel-confirm', confirming })
  const cycleSwitchConfirm = flow.cycleSwitch
  const setCycleSwitchConfirm = (cycle: CycleSwitchTarget | null) => dispatchFlow({ type: 'cycle-switch', cycle })
  const upgradeConfirm = flow.checkoutReturn
  const setUpgradeConfirm = (status: CheckoutReturnState) => dispatchFlow({ type: 'checkout-return', status })
  const [cancelLoading, setCancelLoading] = useState(false)
  const [reactivateLoading, setReactivateLoading] = useState(false)
  // Pause flow (task 0544)
  const [pauseLoading, setPauseLoading] = useState<30 | 60 | 90 | null>(null)
  const [resumeLoading, setResumeLoading] = useState(false)
  // Billing cycle switch confirmation
  const [cycleSwitchLoading, setCycleSwitchLoading] = useState(false)
  // Checkout-watchdog "Continue" resume (task 1469 fix, Codex PR #54 review) —
  // only used for the `resolveResumeAction` checkout branch (recreating
  // checkout for a saved plan that differs from the current one); the
  // cycle-switch branch reuses `cycleSwitchLoading` via handleSwitchBillingCycle.
  const [resumeCheckoutLoading, setResumeCheckoutLoading] = useState(false)
  // 14-day free trial (task 0905). `trialUsed` is an OPTIMISTIC local flip set when the server
  // reports the user already had a trial (409 trial_already_used) — kept as a
  // same-tab fallback for the instant between that 409 and `sub` re-fetching.
  // `convertLoading` tracks the convert/add-payment flow.
  //
  // Task 1517: the authoritative signal is `sub?.has_used_trial` (server-sent
  // on every `GET /billing/subscription`, mirrors `users.has_used_trial`) —
  // `hasUsedTrial` below combines both so a returning user whose trial was
  // used weeks ago (no 409 this session at all) never sees a trial CTA in the
  // first place, instead of discovering ineligibility only after clicking
  // "Start trial" and getting a 409.
  // Task 1037: no local 409 path any more (trials start on /choose-plan), so
  // this stays false; kept so `resolveHasUsedTrial` keeps its two-signal shape.
  const [trialUsed] = useState(false)
  const [convertLoading, setConvertLoading] = useState(false)
  // Task 1037 — inline confirm for cancelling a trial that converts on its own.
  // Upgraded return — the user came back from the provider's hosted checkout.
  // Provisioning is async (the payment webhook writes the subscription row, NOT
  // the redirect), and the provider reuses ONE redirect URL for paid/cancelled/
  // expired, so `?upgraded=true` alone cannot assert success. We poll the
  // subscription and only claim "Upgrade complete" once it actually reflects the
  // change; otherwise we show an honest neutral "still processing" state. (0865)
  const showUpgraded = isCheckoutReturn(searchParams)
  const upgradedDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 'finalizing' = polling; 'complete' = subscription reflects the upgrade;
  // 'unconfirmed' = poll window elapsed without a change (payment may still be
  // processing, or was cancelled/not completed — never a false success).
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

  // Task 1518 part C — upgrade-nudge-modal.tsx navigates straight here on a
  // `billing_reset_test_mode` checkout error, carrying the real server
  // message via router state (lost otherwise, since it discards its own
  // component state on navigation). Consume it once and show it as a toast
  // — `resetMessageConsumedRef` mirrors `intentReadRef` above so a later
  // location change on this same page (e.g. a `setSearchParams` call) can't
  // re-fire it.
  const resetMessageConsumedRef = useRef(false)
  useEffect(() => {
    if (resetMessageConsumedRef.current) return
    const state = location.state as BillingResetNavigationState | null
    if (!state?.billingResetMessage) return
    resetMessageConsumedRef.current = true
    showToast({
      icon: 'info',
      title: 'Subscription reset',
      description: state.billingResetMessage,
    })
    // Clear the state so a refresh/back-navigation doesn't re-show the toast.
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location, navigate, showToast])

  // Does a freshly-fetched subscription reflect the upgrade the user just made?
  // Shared by the poll (fallback), the WS handler, AND the reconcile-on-load —
  // all three agree on what "confirmed" means by comparing the fresh sub against
  // the PRE-checkout state persisted in the intent (task 0946), not a post-reload
  // baseline. Comparing to pre-checkout truth is what fixes F1/F7: on a reload of
  // /billing?upgraded=true the context subscription is ALREADY the upgraded value,
  // so a delta against it can never trip — but the delta against `intent.pre`
  // (captured before the redirect) still does.
  // task 0957: the actual comparison logic is the pure, unit-tested
  // `reflectsUpgrade` in `checkout-reconcile.ts` (extracted so it is
  // testable without React) — this wraps it with the component's own
  // `intentRef` so every call site here keeps its old zero-arg shape.
  const reflectsUpgrade = useCallback(
    (s: Subscription): boolean => reflectsUpgradeCore(intentRef.current, s),
    [],
  )

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
      intent ? reflectsUpgrade(s) : reflectsUpgradeNoIntent(s)

    let attempt = 0
    const poll = async () => {
      if (cancelled) return
      try {
        // Reconcile-on-load = source of truth (task 0957, spec §3.3 item 2).
        // On the FIRST check only (mount / Mollie return — not every poll
        // tick, matching the spec's "on /billing mount and on Mollie return"
        // wording; the server's own 60s cache would make a repeat call a
        // no-op anyway), ask the server to check Mollie directly for THIS
        // payment — independent of the WS event and the `?upgraded=true` URL
        // flag. This is what confirms a payment whose webhook was
        // missed/delayed WITHIN this 30s window, instead of waiting on the
        // async background reconciler's own schedule. Best-effort: an older
        // intent with no `paymentId`, a server that doesn't have this route
        // yet (404), or any other failure degrades silently to the unchanged
        // subscription-poll path below — never blocks confirmation.
        if (attempt === 0 && intent?.paymentId) {
          try { await getPaymentStatus(intent.paymentId) } catch { /* degrade to poll-only */ }
        }
        if (cancelled) return
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
  // Task 1706 review #132-A — transient override: set when the usage refresh
  // after a just-applied add-on change FAILED (the drive-context value is
  // then known-stale), so both storage readouts prefer the fresh apply
  // response's `effective_storage_bytes` until the next successful
  // contextUsage refresh clears it (effect below, keyed on the context
  // usage's identity — every delivery is a new object).
  const [addonAuthorityOverride, setAddonAuthorityOverride] = useState(false)
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

  // Upgrade rate-limit (task 1057) — human date for the at-limit upgrade-CTA
  // subtext (never raw ISO). Null when not at the limit or no date available.
  // DOWNGRADES are never gated; this only governs UPGRADE affordances.
  const upgradeNextAvailableLabel = sub?.upgrade_next_available_at
    ? formatDate(sub.upgrade_next_available_at)
    : null

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

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // getSubscription is fetched fresh here so cancel/reactivate flows see
      // the updated status immediately. getPlans is needed for the upgrade
      // cards section (context only stores the matched current-user plan).
      const [subData, invData, cnData, txnData, invoicePref, plansData, filesData, addonsData, pmData] = await Promise.all([
        getSubscription(),
        getBillingInvoices().catch(() => [] as BillingInvoice[]),
        getBillingCreditNotes().catch(() => [] as BillingCreditNote[]),
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
      setCreditNotes(cnData ?? [])
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
  //
  // Extracted to a stable callback (task 0957) so the SAME reconcile also
  // drives the WS-reconnect catch-up below — both are "something told us to
  // recheck now", they just differ in WHY.
  const reconcileOnSignal = useCallback(() => {
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
      // task 0957 follow-up (PR #53 review): the two decisions below are
      // INDEPENDENT — resolving the intent must not require `showUpgraded`.
      // The intent is a localStorage record of what the user is waiting for;
      // if the return URL lost `?upgraded=true` (proxy/history
      // normalization) and the payment settles only after this tab's own
      // 30s poll already gave up, a WS reconnect refreshing the subscription
      // must still clear the intent — otherwise the checkout watchdog spins
      // to a false "didn't complete checkout" until the intent's 24h TTL,
      // even though the change landed. See `reconcileSignalOutcome`'s doc
      // comment in checkout-reconcile.ts for the full contract + tests.
      const { resolveIntent, showComplete } = reconcileSignalOutcome(
        intentRef.current, latest, showUpgraded, upgradeConfirm,
      )
      if (resolveIntent) {
        clearPendingCheckout()
        intentRef.current = null
        // Also clears the checkout watchdog banner (`pendingCheckout`
        // state) — it reads the SAME intent this just resolved, so it must
        // not keep offering "didn't complete checkout" once it has.
        setPendingCheckoutState(null)
        void loadData()
      }
      // If a checkout return banner is still showing AND this update is the
      // one we were waiting for, flip to complete now (no poll-tick
      // latency). F5: accept the flip from EITHER `finalizing` (poll still
      // running) OR `unconfirmed` (the 30s poll already gave up) — a genuine
      // later WS event for a slow webhook / settled SEPA debit must still
      // resolve the banner, not just silently refresh the data underneath a
      // stuck "still processing".
      if (showComplete) setUpgradeConfirm('complete')
    })()
  }, [showUpgraded, upgradeConfirm, refreshPlanDetails, loadData])

  useWsEvent(['billing_updated'], reconcileOnSignal)

  // WS catch-up (task 0957, spec §3.3 item 3). A dropped-then-reconnected
  // socket has NO missed-event replay (see `use-self-heal-refetch.ts`'s doc
  // comment) — a `billing_updated` that fired WHILE we were disconnected is
  // lost forever, not delivered late. `beebeeb:ws-connected` (dispatched by
  // `use-websocket.ts` on `ws.onopen`) is the signal that we may have missed
  // one. If a checkout intent is still pending, unconditionally re-run the
  // SAME reconcile the live event would have triggered — so a webhook that
  // landed while this tab was backgrounded/asleep/offline still confirms on
  // reconnect instead of only via the next poll tick or a manual reload.
  useEffect(() => {
    const onConnected = () => {
      if (intentRef.current) reconcileOnSignal()
    }
    window.addEventListener('beebeeb:ws-connected', onConnected)
    return () => window.removeEventListener('beebeeb:ws-connected', onConnected)
  }, [reconcileOnSignal])

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
  // Task 1037: a needs_plan / lapsed account is entitled to nothing
  // (server `effective_plan: "none"`) whatever plan the row still names — it
  // shows as "No plan" and buys through normal checkout, like Free.
  const effectivePlan =
    resolveAccountState(sub) !== 'ok' ? 'free' :
    sub?.status === 'cancelled' ? 'free' :
    sub?.status === 'cancelling' ? (sub.plan ?? 'free') :
    (sub?.plan ?? 'free')
  const meta = planMeta[effectivePlan] ?? planMeta.free
  // Task 1604 review thread PRRT_kwDOSLX6Nc6nC4Vb: this used to pass
  // `effectivePlan` (forced to 'free' the instant `account_state` is
  // `lapsed`, above) into `billingPeriodLine`, which returns null at its own
  // `plan === 'free'` guard before it can even look at `status`/
  // `data_deletion_at`. But a `lapsed` account_state does NOT mean the raw
  // subscription row itself flipped to 'free' — the server's own
  // `resolve_account_state` (signup_plan.rs) derives `lapsed` from the
  // ENTITLED plan (`quota::get_user_quota`), which is independent of the
  // newest row's own `plan`/`status` columns exposed here. Concretely: a
  // cancelled paid row stays `status: 'cancelling'` with its OLD `plan` (e.g.
  // 'pro') in the DB until a later sweep tidies it up, even once
  // `current_period_end` has passed and entitlement (and therefore
  // `account_state`) has already flipped to `lapsed` — and `data_deletion_at`
  // is set at exactly that same moment (`resolve_account_state`: non-null
  // only once `account_state === Lapsed`). So the ONE shape that carries
  // `data_deletion_at` is exactly the shape `effectivePlan` was clobbering to
  // 'free' before `billingPeriodLine` ever saw the real `status`. Pass the
  // row's own `plan`/`status` (not the display-only `effectivePlan`) —
  // `billingPeriodLine`'s own guards (`plan === 'free'`, `status ===
  // 'cancelled' | 'paused'`) already null out every case that should render
  // nothing, using the ACTUAL row shape rather than a value already
  // overwritten for an unrelated "No plan" display concern.
  const periodLine = billingPeriodLine(sub ?? null)
  // Task 1517 — authoritative trial-eligibility signal. `sub?.has_used_trial`
  // is the server truth (set the moment ANY trial was ever started, whether
  // it lapsed, converted, or is still running); `trialUsed` is the optimistic
  // same-session flip from a live 409 (see its declaration above). Every
  // trial CTA below gates on this, not on `trialUsed` alone, so a user who
  // already used their trial — even in a PAST session, before this page ever
  // loaded — never sees "Start trial" and instead goes straight to checkout.
  // Task 1757: with a document, the SERVER'S offer decides (`offers.trial`), not a guess from
  // `has_used_trial` (the 1517 guess stays only as the fallback when no document is served).
  const hasUsedTrial = trialOffer ? trialOffer.kind === 'unavailable' : resolveHasUsedTrial(sub?.has_used_trial, trialUsed)
  // Task 1037 — `needs_plan` (never started a trial) / `lapsed` (trial or plan
  // ended unpaid: read-only, deletion at data_deletion_at). Missing = ok.
  const accountState = resolveAccountState(sub)
  const hasNoPlan = accountState !== 'ok'
  // Plan picked on the marketing site before signup, carried here by
  // onboarding as /billing?view=change&plan=<slug>&cycle=<cycle>
  // (src/lib/plan-intent.ts). Only offered to a Free account — a trialing or
  // paid account already made its choice.
  const planIntent = parsePlanIntent(searchParams.get('plan'), searchParams.get('cycle'))
  // The URL now carries the intent, so the stored copy (kept through
  // onboarding for GuestRoute, see plan-intent.ts) is consumed here — a later
  // signup in this browser must not inherit it.
  const hasPlanParam = searchParams.has('plan')
  useEffect(() => {
    if (hasPlanParam) clearPlanIntent()
  }, [hasPlanParam])
  const showPlanIntent =
    planIntent !== null &&
    !loading &&
    effectivePlan === 'free' &&
    sub?.status !== 'trialing' &&
    Boolean(planMeta[planIntent.plan])
  const planIntentTrialEligible =
    planIntent !== null &&
    isTrialEligible({
      effectivePlan,
      subStatus: sub?.status,
      hasUsedTrial,
      targetComingSoon: planMeta[planIntent.plan]?.comingSoon,
    })
  const apiPlan = plans?.find(p => p.id === effectivePlan)
  const currentPriceMonthly = apiPlan?.price_eur ?? meta.priceMonthly
  const currentPriceYearly = apiPlan?.price_yearly_eur ?? meta.priceYearly
  /**
   * "EUR X.XX" for the TARGET cycle's full recurring total — base plan PLUS
   * add-ons (task 1604 review thread PRRT_kwDOSLX6Nc6nC4VT). Used for the
   * cycle-switch confirm/toast copy, which otherwise promised a "first
   * charge" that silently dropped the storage/user add-on. See
   * `cycleSwitchTargetTotalCents`'s doc comment for why this is exact and not
   * an approximation.
   */
  function targetCycleTotalLabel(cycle: BillingCycle): string {
    const basePlanTargetCents = Math.round((cycle === 'yearly' ? currentPriceYearly : currentPriceMonthly) * 100)
    const currentCycle: BillingCycle = sub?.billing_cycle === 'yearly' ? 'yearly' : 'monthly'
    const totalCents = cycleSwitchTargetTotalCents(basePlanTargetCents, sub?.addon_cents, currentCycle, cycle)
    return `EUR ${(totalCents / 100).toFixed(2)}`
  }
  // Task 1605 — an active mandated trial's REAL enforced ceiling is the 25 GB
  // cap, not the plan's full quota (PR #128 review, Codex P2: the meter was
  // showing e.g. "24 GB / 200 GB" (~12%) for a trial the server would refuse
  // uploads on at 25 GB — computed early so it can gate `totalStorageBytes`
  // below, alongside the `cancelCopy`/`trialCapped` consts further down that
  // read the same `sub`).
  const trialCapBytes = isTrialCapped(sub) ? sub?.trial_storage_cap_bytes ?? null : null
  // Task 1706 — server truth first: the drive-context usage carries
  // `plan_limit_bytes` (GET /files/usage, merged with GET /billing/usage's
  // bonus-inclusive `quota_bytes` — get_user_quota). It is the same number the
  // quota engine enforces, so it outranks `addonState.effective_storage_bytes`;
  // addonState stays authoritative ONLY for add-on quantities/prices. The
  // final fallback is the static plan metadata.
  // Task 1706 review #132-A — `addonAuthorityOverride` (a failed post-apply
  // usage refresh) promotes the JUST-APPLIED response's
  // `effective_storage_bytes` to first place until the context refreshes;
  // decision logic unit-tested in test/1706-storage-authority.test.ts.
  const contextPlanLimitBytes = contextUsage?.plan_limit_bytes
  const rawTotalStorageBytes = resolveMeterTotalBytes(
    contextPlanLimitBytes,
    addonState?.effective_storage_bytes,
    addonAuthorityOverride,
    meta.storageGB * 1_000_000_000,
  )
  // Guard against NaN/undefined — show 0 rather than NaN in the UI
  // Task 1842: a no-card trial's ceiling is the trial cap from the onboarding document (10 GB),
  // not the plan the trial would convert to.
  const totalStorageBytes = noCardTrial != null && noCardTrial.capBytes > 0
    ? noCardTrial.capBytes
    : trialCapBytes != null
    ? trialCapBytes
    : Number.isFinite(rawTotalStorageBytes) && rawTotalStorageBytes > 0
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

  // Task 1605 — cancelling-panel copy (never-paid trial vs. paid cancel) and
  // the active-trial 25 GB cap. Pure helpers in ../lib/trial-limits-copy.ts.
  const cancelCopy = cancelledCardCopy(sub, meta.label)
  const trialCapped = isTrialCapped(sub)
  // Task 2106 — a trial held for the bank's confirmation. ONE date formatter for every date that
  // belongs to the hold (the Amsterdam day, en-GB), whichever surface shows it.
  const heldUntil = confirmPaymentBy(sub)
  const trialDateLabel = (iso: string | null): string => holdDateLabel(iso, heldUntil !== null, formatDate)

  // Storage slider derived values
  // Task 1842: a no-card trial has no subscription, so there is no add-on to buy; the Manage
  // storage section is hidden for it and the near-cap line must not point at it.
  const canAddStorage = planCanAddStorage(effectivePlan) && !noCardTrial
  const baseTB = addonState?.base_storage_tb || planBaseTB(effectivePlan)
  const rawMaxExtraTB = addonState
    ? addonState.max_storage_tb - addonState.base_storage_tb
    : planMaxExtraTB(effectivePlan)
  const maxExtraTB = Number.isFinite(rawMaxExtraTB) && rawMaxExtraTB > 0 ? rawMaxExtraTB : 0
  const maxTotalTB = baseTB + maxExtraTB
  const currentExtraTB = addonState?.extra_storage_tb ?? 0
  // Task 1706 — the "Current total" readout prefers the server-truth quota
  // (drive-context /files/usage, bonus-inclusive get_user_quota bytes) over
  // the TB-integer reconstruction (baseTB + currentExtraTB); addonState's TB
  // fields stay authoritative for the add-on axis (quantities/prices) only.
  // Task 1706 review #132-A — the same transient override applies here (fresh
  // add-on bytes win only when positive); decision logic unit-tested in
  // test/1706-storage-authority.test.ts.
  const currentTotalStorageBytes = resolveCurrentTotalBytes(
    contextPlanLimitBytes,
    addonState?.effective_storage_bytes,
    addonAuthorityOverride,
    (baseTB + currentExtraTB) * 1_000_000_000_000,
  )
  // Task 1706 review #132-B — reconcile the displayed total against the
  // base+extra parts the parenthetical names: a bonus-inclusive total is
  // larger than base+extra, so the remainder is surfaced as a neutral
  // "additional storage" term (no web payload exposes a bonus-specific
  // field — see storage-totals.ts) and irreconcilable parts omit the
  // parenthetical instead of contradicting the total.
  const currentAllocation = storageAllocationBreakdown(currentTotalStorageBytes, baseTB, currentExtraTB)
  const sliderChanged = sliderTB !== currentExtraTB
  // Task 1701 — the storage slider's "Monthly price" preview must come from
  // the STORED plan price (the API plans row, the same source every other
  // price on this page renders), never the WASM-compiled base price — the
  // compiled-in numbers go stale the moment the owner edits the plan catalog
  // (a plan priced €0 showed €1.99 here). The per-TB ADD-ON rate keeps the
  // server-field → WASM-ladder → €10.99 chain: that is an add-on rate, not
  // the plan price.
  const sliderBaseCents = Math.round(currentPriceMonthly * 100)
  const addonRateCents =
    sub?.addon_per_tb_cents != null && sub.addon_per_tb_cents > 0
      ? sub.addon_per_tb_cents
      : (planMonthlyCostCents(effectivePlan, 1) - planMonthlyCostCents(effectivePlan, 0)) || 1099
  const currentCostCents = sliderBaseCents + currentExtraTB * addonRateCents
  const newCostCents = sliderBaseCents + sliderTB * addonRateCents
  const usedTB = Math.ceil(usedBytes / 1_000_000_000_000)
  const sliderMin = Math.max(0, usedTB - baseTB)
  const wouldReduceBelowUsage = (baseTB + sliderTB) * 1_000_000_000_000 < usedBytes

  /* ── Computed values for the template ──────────────── */

  const allUpgradePlans = plans?.length
    ? plans
        .filter((plan) => plan.id !== 'free' && plan.is_active !== false)
        .map(upgradeCardFromApiPlan)
    : fallbackUpgradePlanIds.map(upgradeCardFromFallback)
  const currentSortOrder = allUpgradePlans.find((plan) => plan.id === effectivePlan)?.sortOrder ?? planRank[effectivePlan]
  // Only plans strictly ABOVE the user's current tier are real upgrade targets.
  // Task 1057 — Teams (slug `business`) is COMING SOON and must NEVER be offered
  // as an upgrade (no "Upgrade to Teams" CTA anywhere). Exclude any coming-soon
  // plan from the upgrade set, so for a Pro user `nextPlan` is null → the
  // Current-plan card renders no upgrade CTA.
  const upgradePlans = allUpgradePlans
    .filter((plan) => plan.id !== effectivePlan)
    .filter((plan) => !planMeta[plan.id]?.comingSoon)
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
  const serverMollieAmountCents = sub?.mollie_amount_cents

  // Per-TB price: the single add-on-rate chain computed above (server truth
  // first, else the WASM ladder's marginal cost of 1 extra TB, else the
  // €10.99/TB last-resort constant — reverted from 1499, Guus ruling
  // 2026-09-29, task 1607, reversing task 1463's 2026-09-22 raise).
  const addonPerTbCents = addonRateCents

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

  return {
    searchParams,
    setSearchParams,
    showToast,
    navigate,
    location,
    view,
    setView,
    contextUsage,
    contextPlanDetails,
    refreshPlanDetails,
    refreshUsage,
    accountDocument,
    accountStateLabel,
    trialOffer,
    noCardTrial,
    trialEnded,
    startNoCardTrial,
    sub,
    setSub,
    invoices,
    setInvoices,
    creditNotes,
    setCreditNotes,
    transactions,
    setTransactions,
    plans,
    setPlans,
    files,
    setFiles,
    loading,
    setLoading,
    error,
    setError,
    upgradeOpen,
    setUpgradeOpen,
    upgradePlan,
    setUpgradePlan,
    portalLoading,
    setPortalLoading,
    payOverdueLoading,
    setPayOverdueLoading,
    flow,
    dispatchFlow,
    cancelStep,
    cancelConfirm,
    setCancelStep,
    setCancelConfirm,
    trialCancelConfirm,
    setTrialCancelConfirm,
    cycleSwitchConfirm,
    setCycleSwitchConfirm,
    upgradeConfirm,
    setUpgradeConfirm,
    cancelLoading,
    setCancelLoading,
    reactivateLoading,
    setReactivateLoading,
    pauseLoading,
    setPauseLoading,
    resumeLoading,
    setResumeLoading,
    cycleSwitchLoading,
    setCycleSwitchLoading,
    resumeCheckoutLoading,
    setResumeCheckoutLoading,
    trialUsed,
    convertLoading,
    setConvertLoading,
    showUpgraded,
    upgradedDismissTimer,
    intentRef,
    intentReadRef,
    intentMandate,
    pendingCheckout,
    setPendingCheckoutState,
    resetMessageConsumedRef,
    reflectsUpgrade,
    addonState,
    setAddonState,
    sliderTB,
    setSliderTB,
    addonSaving,
    setAddonSaving,
    addonAuthorityOverride,
    setAddonAuthorityOverride,
    addonPreview,
    setAddonPreview,
    addonPreviewLoading,
    setAddonPreviewLoading,
    addonInstantPayLoading,
    setAddonInstantPayLoading,
    addonPending,
    setAddonPending,
    downgradeTarget,
    setDowngradeTarget,
    cancellingDowngrade,
    setCancellingDowngrade,
    upgradeNextAvailableLabel,
    invoiceSendEmail,
    setInvoiceSendEmail,
    invoiceEmail,
    setInvoiceEmail,
    savingInvoicePrefs,
    setSavingInvoicePrefs,
    paymentMethod,
    setPaymentMethod,
    pmLoaded,
    setPmLoaded,
    exportingTransactions,
    setExportingTransactions,
    loadData,
    reconcileOnSignal,
    dismissUpgraded,
    effectivePlan,
    meta,
    periodLine,
    hasUsedTrial,
    accountState,
    hasNoPlan,
    planIntent,
    hasPlanParam,
    showPlanIntent,
    planIntentTrialEligible,
    apiPlan,
    currentPriceMonthly,
    currentPriceYearly,
    targetCycleTotalLabel,
    trialCapBytes,
    contextPlanLimitBytes,
    rawTotalStorageBytes,
    totalStorageBytes,
    usedBytes,
    usedPercent,
    isSepaMandate,
    checkoutIsSepa,
    cancelCopy,
    trialCapped,
    heldUntil,
    trialDateLabel,
    canAddStorage,
    baseTB,
    rawMaxExtraTB,
    maxExtraTB,
    maxTotalTB,
    currentExtraTB,
    currentTotalStorageBytes,
    currentAllocation,
    sliderChanged,
    sliderBaseCents,
    addonRateCents,
    currentCostCents,
    newCostCents,
    usedTB,
    sliderMin,
    wouldReduceBelowUsage,
    allUpgradePlans,
    currentSortOrder,
    upgradePlans,
    nextPlanDetails,
    nextPlan,
    selectedApiPlan,
    upgradePlanDetails,
    billingInterval,
    serverBasePlanCents,
    serverAddonCents,
    serverMollieAmountCents,
    addonPerTbCents,
    basePlanCents,
    extraStorageCostCents,
    basePriceCents,
  }
}

export type BillingData = ReturnType<typeof useBillingData>
