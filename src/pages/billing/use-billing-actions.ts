/**
 * The billing page's actions: every upgrade, cancel, pause, pay, storage add-on, and invoice-preference handler.
 *
 * Handlers and server calls for the billing page (task W run 5).
 *
 * Every function here used to live in the page component; they take their data
 * from `useBillingData` through the `BillingData` object and own only the
 * action-in-flight state (pay-now, the upgrade dialogs, the post-redirect
 * return banners). Behaviour and call order are unchanged.
 *
 * Must not: render, or redefine the state and math the data hook owns.
 */

import {
  updatePaymentMethod,
  switchBillingCycle,
  cancelSubscription,
  reactivateSubscription,
  pauseSubscription,
  resumeSubscription,
  setPreference,
  updateStorageAddons,
  previewStorageAddons,
  createStorageAddonCheckout,
  exportBillingTransactions,
  convertTrial,
  createCheckoutSession,
  ApiError,
} from '../../lib/api'
import { trialBillingRefusalCopy } from '../../lib/no-card-trial'
import { userFriendlyError } from '../../lib/user-friendly-error'
import { handleBillingResetTestMode } from '../../lib/billing-reset'
import { formatStorageSI } from '../../lib/format'
import {
  isTrialing,
  trialCancelledSwitchNote,
  trialCycleSwitchToastFor,
} from '../../lib/cycle-switch-copy'
import {
  type PendingCheckout,
  makePreState,
  setPendingCheckout,
  clearPendingCheckout,
  resolveResumeAction,
} from '../../lib/pending-checkout'
import { isTrialEligible } from '../../lib/trial-eligibility'
import { choosePlanPath } from '../../lib/trial-checkout'
import {
  formatDate,
  planMeta,
} from './upgrade-plans'
import type { BillingData } from './use-billing-data'
import { usePayNowFlow } from './use-pay-now-flow'
import { usePayOverdueFlow } from './use-pay-overdue-flow'

export function useBillingActions(data: BillingData) {
  const {
    showToast,
    navigate,
    setView,
    refreshPlanDetails,
    refreshUsage,
    sub,
    setUpgradeOpen,
    setUpgradePlan,
    setPortalLoading,
    setCancelStep,
    setCancelConfirm,
    setCycleSwitchConfirm,
    setCancelLoading,
    setReactivateLoading,
    setPauseLoading,
    setResumeLoading,
    setCycleSwitchLoading,
    setResumeCheckoutLoading,
    setConvertLoading,
    setPendingCheckoutState,
    setAddonState,
    sliderTB,
    setAddonSaving,
    setAddonAuthorityOverride,
    setAddonPreview,
    setAddonPreviewLoading,
    setAddonInstantPayLoading,
    setAddonPending,
    setDowngradeTarget,
    invoiceSendEmail,
    invoiceEmail,
    setSavingInvoicePrefs,
    setExportingTransactions,
    loadData,
    effectivePlan,
    hasUsedTrial,
    targetCycleTotalLabel,
    trialDateLabel,
  } = data

  const {
    payNowState,
    payNowReturn,
    setPayNowReturn,
    payNowReconcileCancelRef,
    reconcilePayNow,
    onPayNowSettled,
    pollPayNow,
    handlePayNow,
  } = usePayNowFlow(data)

function openUpgrade(plan: string) {
    setUpgradePlan(plan)
    setUpgradeOpen(true)
  }

  // Open the downgrade/switch dialog for a lower-tier target (task 1056). The
  // comparison table's marketed slugs never include `free`, so every target here
  // is a real plan change (the /cancel path to free is reached elsewhere).
  function openDowngrade(plan: string) {
    setDowngradeTarget(plan)
  }

  // Comparison-table "Upgrade" entry point for a Free-plan user (task 1064,
  // D5). Previously EVERY tier's Upgrade CTA — and the separate "Start 14-day
  // free trial" button above — always started a PRO trial, regardless of which
  // tier's card the user actually clicked; the comparison table's own "14-day
  // free trial" row implies Starter/Basic/Pro all trial (only Teams, the
  // `comingSoon` tier, has no trial). So: an eligible Free user (not already
  // trialing, hasn't used their trial — task 1517: checked via `hasUsedTrial`,
  // the server-truth `has_used_trial` combined with any same-session 409)
  // clicking a trial-capable tier starts a trial for THAT tier; Teams (or any
  // non-trial-eligible/`comingSoon` plan, or an account that already used its
  // trial) falls through to normal checkout instead of ever attempting
  // `startTrial()`.
  function handleUpgradeOrTrial(plan: string) {
    const eligibleForTrial = isTrialEligible({
      effectivePlan,
      subStatus: sub?.status,
      hasUsedTrial,
      targetComingSoon: planMeta[plan]?.comingSoon,
    })
    if (eligibleForTrial) {
      void handleStartTrial(plan)
      return
    }
    openUpgrade(plan)
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
        // Task 1757: a trial without a card has no subscription (409 no_subscription_to_cancel):
        // say so plainly rather than "could not cancel".
        title: err instanceof ApiError && err.code === 'no_subscription_to_cancel' ? 'Nothing to cancel' : 'Could not cancel plan',
        description: trialBillingRefusalCopy(err) ?? (err instanceof Error ? err.message : 'Please try again.'),
        danger: true,
      })
    } finally {
      setCancelLoading(false)
    }
  }

  // Entry point for the cancel flow: pause (only when the active billing
  // provider supports pause/resume, task 0924) → confirm. Under Mollie
  // (`pause_supported === false`) there is no native pause, so we go straight
  // to confirm.
  const pauseSupported = sub?.pause_supported ?? false
  function startCancelFlow() {
    setCancelStep(pauseSupported ? 'pause' : 'confirm')
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

  async function handleReactivate() {
    setReactivateLoading(true)
    try {
      const result = await reactivateSubscription()
      if (result.action === 'checkout' && result.url) {
        // task 0957 (spec §3.3 item 1, "on EVERY path"): reactivate's fresh-
        // payment fallback redirected to a hosted checkout with NO persisted
        // intent at all — the ONE plan/cycle-affecting checkout redirect in
        // this file that skipped it. Same pattern as every other checkout
        // call site: snapshot pre-state + target before leaving the page.
        setPendingCheckout('plan', effectivePlan, sub?.billing_cycle ?? 'monthly', makePreState(sub), result.payment_id)
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
   * Native payment-method update (task 0925). The server returns a hosted card
   * re-auth checkout URL and we just redirect to it. It answers 400 "billing not
   * configured" only when no payment provider is configured, and 404 when there
   * is no active subscription. No provider-hosted "manage billing" portal is
   * surfaced — everything else is native on this page.
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

  const {
    payOverdueReturn,
    setPayOverdueReturn,
    payOverdueReconcileCancelRef,
    reconcilePayOverdue,
    handlePayOverdue,
    confirmIntentRaw,
    confirmIntentHandledRef,
    confirmNote,
    setConfirmNote,
    confirmOverdueIntent,
    setConfirmOverdueIntent,
  } = usePayOverdueFlow(data, handlePayNow)

  async function handlePreviewStorageAddon() {
    setAddonPreviewLoading(true)
    try {
      const preview = await previewStorageAddons({ extra_storage_tb: sliderTB })
      if (preview.requires_payment_method) {
        // Redirect to the native payment-method update flow (hosted card
        // checkout) so the user can add a card, then come back.
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
      // Task 1706 review #132-A — make the usage refresh awaitable and its
      // outcome observable: on success the drive-context `/files/usage` is
      // fresh and the normal server-truth-first hierarchy renders correctly;
      // on failure the context value is KNOWN-stale, so the transient
      // override keeps the just-applied response's effective_storage_bytes
      // authoritative until the next successful contextUsage refresh clears
      // it (effect keyed on contextUsage identity).
      try {
        const usageFresh = await refreshUsage()
        if (!usageFresh) setAddonAuthorityOverride(true)
      } catch {
        setAddonAuthorityOverride(true)
      }
      refreshPlanDetails()
    } catch (err) {
      const resetMessage = await handleBillingResetTestMode(err, {
        refreshPlanDetails,
        reloadLocal: loadData,
        clearPendingCheckout: () => {
          clearPendingCheckout()
          setPendingCheckoutState(null)
        },
      })
      if (resetMessage) {
        showToast({ icon: 'info', title: 'Subscription reset', description: resetMessage })
        return
      }
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
      const { checkout_url, payment_id } = await createStorageAddonCheckout({ extra_storage_tb: sliderTB })
      // F2 (task 0946): persist a pre-checkout intent so the upgraded return can
      // reconcile against the PRE-state (a storage add-on leaves plan/cycle
      // untouched — only extra_storage_tb rises — so without a pre snapshot the
      // confirmation had no baseline and false-failed). kind:'storage' routes the
      // reconcile to the storage-delta path. cycle mirrors the current cycle.
      // `payment_id` (task 0957): the server now returns the provider checkout
      // id for THIS instant-pay charge — this was the one checkout path the
      // spec named explicitly as writing no reconcilable intent at all.
      setPendingCheckout(
        'storage',
        effectivePlan,
        sub?.billing_cycle ?? 'monthly',
        makePreState(sub),
        payment_id,
      )
      window.location.href = checkout_url
    } catch (err) {
      const resetMessage = await handleBillingResetTestMode(err, {
        refreshPlanDetails,
        reloadLocal: loadData,
        clearPendingCheckout: () => {
          clearPendingCheckout()
          setPendingCheckoutState(null)
        },
      })
      if (resetMessage) {
        showToast({ icon: 'info', title: 'Subscription reset', description: resetMessage })
        setAddonInstantPayLoading(false)
        return
      }
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
      // Flow-4 finding 4 / task 1604: during a trial the server only re-pins
      // the cycle (a mandated trial re-prices the pending first charge; a
      // no-card trial re-pins what it will convert to) — nothing is charged
      // today either way, so the paid-subscriber "next billing period" copy
      // would be wrong. `trialCycleSwitchToastFor` routes on the payload.
      const trialEnd = sub?.trial_ends_at ?? sub?.current_period_end ?? null
      const newPriceLabel = targetCycleTotalLabel(cycle)
      showToast({
        icon: 'check',
        title: cycle === 'yearly' ? 'Switched to annual billing' : 'Switched to monthly billing',
        description: isTrialing(sub?.status)
          ? trialCycleSwitchToastFor(sub, cycle, trialDateLabel(trialEnd), newPriceLabel)
          : result.annual_billing_start
            ? `Your annual billing starts on ${formatDate(result.annual_billing_start)}.`
            : 'The change takes effect at the start of your next billing period.',
      })
      refreshPlanDetails()
      await loadData()
    } catch (e) {
      const resetMessage = await handleBillingResetTestMode(e, {
        refreshPlanDetails,
        reloadLocal: loadData,
        clearPendingCheckout: () => {
          clearPendingCheckout()
          setPendingCheckoutState(null)
        },
      })
      if (resetMessage) {
        showToast({ icon: 'info', title: 'Subscription reset', description: resetMessage })
        return
      }
      // Task 1604 — a trial cancelled before its first charge (server #128)
      // answers 409 `trial_cancelled`, never the bare "not found" it used to.
      // Same copy as the pre-emptive UI gate (case c), in case of a race
      // where the confirm dialog was already open in a stale tab.
      const cancelled = e instanceof ApiError && e.code === 'trial_cancelled'
      showToast({
        icon: 'x',
        title: cancelled ? 'Your trial is cancelled' : 'Failed to switch billing cycle',
        description: cancelled ? trialCancelledSwitchNote() : e instanceof Error ? e.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setCycleSwitchLoading(false)
    }
  }

  /**
   * Checkout-watchdog "Continue" — resume an abandoned `kind: 'plan'`
   * checkout (task 1469 fix, Codex PR #54 review, thread
   * PRRT_kwDOSLX6Nc6k2gf2). `resolveResumeAction` decides which of two very
   * different resumes this is:
   * - the saved plan differs from the CURRENT plan → this was a plan
   *   PURCHASE, not a cycle switch. Recreate checkout for the saved plan +
   *   cycle (the same request every other plan-purchase entry point makes)
   *   and re-persist the intent exactly like `startPlanCheckout` does, so
   *   the reconcile-on-load still has a `pre` baseline after the new
   *   redirect.
   * - the saved plan MATCHES the current plan → this genuinely is an
   *   in-place cycle switch; `handleSwitchBillingCycle` is correct as-is.
   */
  async function handleResumeCheckout(pending: PendingCheckout) {
    const action = resolveResumeAction(pending, effectivePlan)
    if (action.kind === 'trial') {
      // Task 1037 — an abandoned trial-mandate checkout resumes on the chooser.
      navigate(choosePlanPath({ plan: action.plan, cycle: action.cycle }, { fromBilling: true }))
      return
    }
    if (action.kind === 'switch-cycle') {
      await handleSwitchBillingCycle(action.cycle as 'monthly' | 'yearly')
      return
    }
    setResumeCheckoutLoading(true)
    try {
      const res = await createCheckoutSession({
        plan: action.plan,
        billing_cycle: action.cycle,
      })
      // Task 1702 — a €0 plan came back already activated: no payment to
      // reconcile, no redirect. Refresh and land on the page itself.
      if (res.activated) {
        showToast({
          icon: 'check',
          title: 'Your plan is activated',
          description: 'This plan is free right now — nothing was charged.',
        })
        clearPendingCheckout()
        setPendingCheckoutState(null)
        await loadData()
        window.dispatchEvent(new Event('beebeeb:plan-changed'))
        refreshPlanDetails()
        setResumeCheckoutLoading(false)
        return
      }
      setPendingCheckout(pending.kind, action.plan, action.cycle, makePreState(sub), res.payment_id)
      window.location.href = res.url
    } catch (err) {
      // Task 1518 (server PR #94) — the subscription this resume was trying
      // to recreate got reset because it was created while Mollie was in
      // test mode; the account is back on the free plan server-side. The
      // stale pending-checkout marker is now moot, and the page's `sub`
      // state still shows the pre-reset plan — reload it (below, via the
      // shared handler) so the summary reflects reality before the toast
      // even lands. Also clears the checkout watchdog banner — it reads the
      // same intent this resume was trying to recreate, and offering to
      // "resume" a checkout for a now-reset subscription would just
      // reproduce this same error again.
      const resetMessage = await handleBillingResetTestMode(err, {
        refreshPlanDetails,
        reloadLocal: loadData,
        clearPendingCheckout: () => {
          clearPendingCheckout()
          setPendingCheckoutState(null)
        },
      })
      if (resetMessage) {
        showToast({
          icon: 'info',
          title: 'Subscription reset',
          description: resetMessage,
        })
        setResumeCheckoutLoading(false)
        return
      }
      showToast({
        icon: 'x',
        title: 'Could not resume checkout',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
      setResumeCheckoutLoading(false)
    }
  }

  /**
   * Start a trial for `plan` (task 1037 — trial WITH a payment mandate). The
   * no-card `POST /billing/trial/start` is refused now (409
   * `trial_requires_payment_method`), so every trial CTA on this page goes to
   * `/choose-plan` — payment method → billing details →
   * `POST /billing/trial/checkout` → Mollie — preselected on this plan + cycle.
   * `from=billing` tells the chooser an existing account asked for it (it
   * forwards a no-longer-eligible account back to paid checkout here).
   * `setTrialUsed` stays for the chooser's `trial_already_used` bounce.
   */
  function handleStartTrial(plan: string, billingCycle: 'monthly' | 'yearly' = 'monthly') {
    navigate(choosePlanPath({ plan, cycle: billingCycle }, { fromBilling: true }))
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
      const res = await convertTrial()
      // Task 1702 — a €0 plan's conversion is a direct activation: no Mollie
      // checkout, nothing to poll. Refresh in place.
      if (res.activated) {
        showToast({
          icon: 'check',
          title: 'Your plan is activated',
          description: 'This plan is free right now — nothing was charged.',
        })
        window.dispatchEvent(new Event('beebeeb:plan-changed'))
        refreshPlanDetails()
        await loadData()
        setConvertLoading(false)
        return
      }
      setPendingCheckout(
        'plan',
        sub?.plan ?? effectivePlan,
        sub?.billing_cycle ?? 'monthly',
        makePreState(sub),
        res.payment_id,
      )
      window.location.href = res.url
    } catch (err) {
      if (err instanceof ApiError && err.code === 'trial_convert_unavailable') {
        // Task 1757: a trial without a card has nothing to convert: it subscribes at checkout.
        showToast({
          icon: 'clock',
          title: 'Subscribe to keep your plan',
          description: trialBillingRefusalCopy(err) ?? 'Choose a plan and pay at checkout.',
        })
        setView('change')
        setConvertLoading(false)
        return
      }
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
      // Task 1517 — see the matching comment in handleStartTrial: never show
      // a raw error body in a toast.
      showToast({
        icon: 'x',
        title: 'Could not add a payment method',
        description: userFriendlyError(err),
        danger: true,
      })
      setConvertLoading(false)
    }
  }
  return {
    openUpgrade,
    openDowngrade,
    handleUpgradeOrTrial,
    handleCancelSubscription,
    pauseSupported,
    startCancelFlow,
    handlePauseSubscription,
    handleResumeSubscription,
    handleReactivate,
    handlePayNow,
    payNowReconcileCancelRef,
    reconcilePayNow,
    onPayNowSettled,
    pollPayNow,
    handleUpdatePaymentMethod,
    payOverdueReconcileCancelRef,
    reconcilePayOverdue,
    handlePayOverdue,
    confirmIntentRaw,
    confirmIntentHandledRef,
    confirmNote,
    setConfirmNote,
    confirmOverdueIntent,
    setConfirmOverdueIntent,
    handlePreviewStorageAddon,
    handleConfirmStorageAddon,
    handleStorageAddonInstantPay,
    handleExportTransactions,
    handleSaveInvoicePrefs,
    handleSwitchBillingCycle,
    handleResumeCheckout,
    handleStartTrial,
    handleConvertTrial,
    payNowState,
    payNowReturn,
    payOverdueReturn,
    setPayNowReturn,
    setPayOverdueReturn,
  }
}
