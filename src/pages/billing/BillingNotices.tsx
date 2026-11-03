/**
 * The billing page's notices: return and confirmation banners, the checkout watchdog, and the trial, held, and past-due cards.
 *
 * Global billing notices and banners: the pay-return results, the upgrade
 * checkout states, past-due/freeze banners and the trial cards.
 *
 * Moved verbatim out of the page component (task W run 5); the model carries
 * every value and handler they read.
 *
 * Must not: own state or call the API.
 */

import { BBButton, Icon } from '@beebeeb/shared'
import { cardTrialCancelCopy } from '../../lib/no-card-trial'
import { TrialEndedCard, TrialStartCard, TrialUnavailableNote } from '../../components/no-card-trial'
import { formatStorageSI } from '../../lib/format'
import { PLAN_META } from '../../lib/plan-constants'
import {
  clearPendingCheckout,
} from '../../lib/pending-checkout'
import { trialAutoConvertCopy, trialRenewalAmount } from '../../lib/trial-checkout'
import { lapsedBannerCopy, lapsedHeading } from '../../lib/account-state'
import {
  PAY_NOW_PAYMENT_STORAGE_KEY,
} from '../../lib/trial-pay-now'
import {
  chargesAutomatically,
  formatConfirmDate,
  confirmPaymentBannerCopy,
  heldTrialCancelCopy,
  CONFIRM_PAYMENT_REASSURANCE,
  CONFIRM_PAYMENT_CTA,
  CONFIRM_OVERDUE_COPY,
} from '../../lib/confirm-payment'
import { LiveNote } from '../../components/live-note'
import {
  formatDate,
  remainingDays,
} from './upgrade-plans'
import { useBillingModel } from './model-context'

export function BillingNotices() {
  const {
    navigate,
    view,
    setView,
    trialOffer,
    noCardTrial,
    trialEnded,
    startNoCardTrial,
    sub,
    portalLoading,
    payOverdueLoading,
    trialCancelConfirm,
    setTrialCancelConfirm,
    upgradeConfirm,
    cancelLoading,
    resumeCheckoutLoading,
    convertLoading,
    showUpgraded,
    intentMandate,
    pendingCheckout,
    setPendingCheckoutState,
    dismissUpgraded,
    effectivePlan,
    meta,
    accountState,
    apiPlan,
    totalStorageBytes,
    checkoutIsSepa,
    heldUntil,
    handleCancelSubscription,
    handlePayNow,
    reconcilePayNow,
    handleUpdatePaymentMethod,
    reconcilePayOverdue,
    handlePayOverdue,
    confirmNote,
    setConfirmNote,
    confirmOverdueIntent,
    handleResumeCheckout,
    handleConvertTrial,
    payNowState,
    payNowReturn,
    payOverdueReturn,
    setPayNowReturn,
    setPayOverdueReturn,
  } = useBillingModel()
  return (
    <>
        <div role="status" aria-live="polite">
        {payOverdueReturn && (
          <div
            data-testid="pay-overdue-return"
            data-kind={payOverdueReturn.kind}
            className="rounded-xl border border-line bg-paper-2 px-6 py-4 flex items-center gap-4 flex-wrap"
          >
            <span className="flex-1 min-w-[16rem] text-[13.5px] text-ink-2">{payOverdueReturn.message}</span>
            {payOverdueReturn.retry && (
              <BBButton size="sm" variant="amber" data-testid="pay-overdue-return-retry" disabled={payOverdueLoading} onClick={() => { setPayOverdueReturn(null); void handlePayOverdue() }}>
                Try again
              </BBButton>
            )}
            {payOverdueReturn.refresh && (
              <BBButton size="sm" data-testid="pay-overdue-return-refresh" onClick={() => reconcilePayOverdue()}>
                Refresh
              </BBButton>
            )}
          </div>
        )}
        </div>
        <div role="status" aria-live="polite">
        {payNowReturn && (
          <div
            data-testid="pay-now-return"
            data-kind={payNowReturn.kind}
            className={`rounded-xl border px-6 py-4 flex items-center gap-4 ${
              payNowReturn.kind === 'paid' ? 'border-amber/60 bg-amber-bg' : 'border-line bg-paper-2'
            }`}
          >
            <span className="flex-1 text-[13.5px] text-ink-2">{payNowReturn.message}</span>
            {payNowReturn.retry && (
              <BBButton size="sm" variant="amber" data-testid="pay-now-return-retry" onClick={() => { setPayNowReturn(null); void handlePayNow() }}>
                Try again
              </BBButton>
            )}
            {payNowReturn.refresh && (
              <BBButton size="sm" data-testid="pay-now-return-refresh" onClick={() => {
                let id: string | null = null
                try { id = sessionStorage.getItem(PAY_NOW_PAYMENT_STORAGE_KEY) } catch { /* ignore */ }
                reconcilePayNow(id)
              }}>
                Refresh
              </BBButton>
            )}
          </div>
        )}
        </div>
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
                    of encrypted storage — stored in the EU.
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
                ) : pendingCheckout.kind === 'trial' ? (
                  <>You started a free trial of <span className="font-semibold text-ink">{PLAN_META[pendingCheckout.plan]?.label ?? pendingCheckout.plan}</span> but didn't finish adding a payment method.</>
                ) : pendingCheckout.plan !== effectivePlan ? (
                  <>You started upgrading to <span className="font-semibold text-ink">{PLAN_META[pendingCheckout.plan]?.label ?? pendingCheckout.plan}</span> but didn't complete checkout.</>
                ) : (
                  <>You started switching to <span className="font-semibold text-ink">{pendingCheckout.cycle}</span> billing but didn't complete checkout.</>
                )}
              </span>
              {(pendingCheckout.kind === 'plan' || pendingCheckout.kind === 'trial') && (
                <BBButton
                  size="sm"
                  variant="amber"
                  disabled={resumeCheckoutLoading}
                  onClick={() => void handleResumeCheckout(pendingCheckout)}
                >
                  {resumeCheckoutLoading ? 'Starting checkout...' : 'Continue'}
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

        {/* Past due warning banner — superseded by the read-only freeze banner
            below once billing_state reaches 'read_only' (more specific, more
            honest copy + the pay-overdue CTA), so this one only shows for the
            earlier grace window (day 0 through wk3). */}
        {sub?.status === 'past_due' && sub.billing_state !== 'read_only' && (
          <div className="flex items-center gap-3 p-3.5 bg-red/10 border border-red/30 rounded-lg text-sm">
            <Icon name="x" size={14} className="text-red shrink-0" />
            {confirmOverdueIntent ? (
              <>
                <span className="flex-1" data-testid="billing-past-due-confirm-copy">
                  {CONFIRM_OVERDUE_COPY}
                </span>
                <BBButton
                  size="sm"
                  variant="amber"
                  data-testid="billing-past-due-confirm-cta"
                  onClick={() => void handlePayOverdue()}
                  disabled={payOverdueLoading}
                >
                  {payOverdueLoading ? 'Redirecting...' : CONFIRM_PAYMENT_CTA}
                </BBButton>
                <BBButton
                  size="sm"
                  variant="ghost"
                  data-testid="billing-past-due-update-method"
                  onClick={() => void handleUpdatePaymentMethod()}
                  disabled={portalLoading}
                >
                  {portalLoading ? 'Redirecting...' : 'Update payment method'}
                </BBButton>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        {/* Read-only freeze banner (task 1062, WP-D, decision 3+5). Dunning
            schedule: payment fails -> email now, +wk1/+wk2/+wk3 reminders,
            wk4 -> billing_state='read_only'. Retention-first: nothing is ever
            auto-deleted here — view + download always work; only uploads/
            edits/sharing are paused until the balance is paid. The primary CTA
            ("Pay outstanding balance") is the decision-5 pay-overdue-in-full
            flow — it settles the REAL arrears (not an estimate) via a one-off
            Mollie charge and un-freezes the account on success. */}
        {sub?.billing_state === 'read_only' && (
          <div className="rounded-xl border border-red/30 bg-red/5 px-6 py-5">
            <div className="flex items-start gap-3">
              <Icon name="lock" size={16} className="text-red shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-red mb-1">
                  Account read-only
                </div>
                <h2 className="text-lg font-bold text-ink leading-snug mb-1.5">
                  A payment failed and we haven't heard back
                </h2>
                <p className="text-[13.5px] text-ink-2 leading-relaxed mb-4">
                  You can still view and <strong>download every file</strong> — nothing has been deleted and
                  nothing will be. Uploads, edits, and sharing are paused until the outstanding balance is
                  settled.
                  {sub.past_due_since && (
                    <>
                      {' '}Past due since{' '}
                      <strong className="font-mono">{formatDate(sub.past_due_since)}</strong>.
                    </>
                  )}
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <BBButton
                    variant="amber"
                    size="md"
                    onClick={() => void handlePayOverdue()}
                    disabled={payOverdueLoading}
                  >
                    {payOverdueLoading ? 'Redirecting...' : 'Pay outstanding balance'}
                    {!payOverdueLoading && <Icon name="chevron-right" size={13} className="ml-1.5" />}
                  </BBButton>
                  <BBButton
                    variant="default"
                    size="md"
                    onClick={() => void handleUpdatePaymentMethod()}
                    disabled={portalLoading}
                  >
                    {portalLoading ? 'Redirecting...' : 'Update payment method'}
                  </BBButton>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Trial summary (task 0905) — only for an active trial with a future
            end date. A lapsed trial has status back to a non-trialing value, so
            this also guards against a stale "trialing" panel. Honest copy near
            expiry; the day count is mono (it reads like data); amber on the
            primary convert CTA only. */}
        {/* Task 1037 — a trial that ended unpaid: the vault is read-only and is
            deleted at data_deletion_at unless the user subscribes. Normal paid
            checkout (the trial is used), so the CTA opens the change view. */}
        {/* Task 1757 — the no-card trial, drawn from the onboarding document: running,
            ended over the allowance, or on offer. */}
        {/* Task 1842: the running no-card trial is drawn by the Current plan card below (end date,
            usage against the cap, what happens at the end, sharing) and by the global banner — the
            former standalone panel said the same three things a third time. */}
        {trialEnded && view === 'summary' && <TrialEndedCard status={trialEnded} variant="panel" />}
        {view === 'summary' && trialOffer?.kind === 'available' && (
          <div className="rounded-xl border border-line bg-paper-2 px-6 py-5" data-testid="billing-trial-offer">
            <TrialStartCard offer={trialOffer} onStart={(choice) => startNoCardTrial(trialOffer, choice)} />
          </div>
        )}
        {view === 'summary' && trialOffer?.kind === 'unavailable' && !trialEnded && <TrialUnavailableNote offer={trialOffer} showPlansLink={false} />}

        {accountState === 'lapsed' && !trialEnded && (
          <div className="rounded-xl border border-red/30 bg-red/5 px-6 py-5" data-testid="billing-lapsed">
            <div className="flex items-start gap-3">
              <Icon name="lock" size={16} className="text-red shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-red mb-1">
                  Read-only
                </div>
                <h2 className="text-lg font-bold text-ink leading-snug mb-1.5">{lapsedHeading(sub?.lapse_kind)}</h2>
                <p className="text-[13.5px] text-ink-2 leading-relaxed mb-4">
                  {lapsedBannerCopy(sub?.data_deletion_at, sub?.lapse_kind)} You can still browse and download everything until then.
                </p>
                {view !== 'change' && (
                  <BBButton variant="amber" size="md" onClick={() => setView('change')}>
                    Choose a plan
                    <Icon name="chevron-right" size={13} className="ml-1.5" />
                  </BBButton>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Task 1037 — a trial started WITH a mandate converts on its own at
            trial_ends_at: state the date + amount, offer the cancel action. */}
        {/* Task 2106 — the bank asked the customer to confirm the first payment (3-D Secure).
            The trial is held, `trial_auto_converts` is still true, but nothing charges by itself:
            never the "charged automatically" copy below. */}
        <LiveNote
          text={confirmNote}
          testId="billing-confirm-note"
          className="flex items-center gap-3 p-3.5 bg-paper-2 border border-line rounded-lg text-sm text-ink-2"
        >
          <button type="button" className="text-ink-3 hover:text-ink" aria-label="Dismiss" onClick={() => setConfirmNote(null)}>
            <Icon name="x" size={14} />
          </button>
        </LiveNote>

        {heldUntil && (
          <div className="rounded-xl border border-line bg-paper-2 px-6 py-5" data-testid="billing-trial-confirm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-1">
              Free trial
            </div>
            <h2 className="text-lg font-bold text-ink leading-snug mb-1">Confirm your first payment</h2>
            <p className="text-[13.5px] text-ink-2 leading-relaxed mb-1" data-testid="billing-trial-confirm-copy">
              {confirmPaymentBannerCopy(heldUntil)}
            </p>
            <p className="text-[13px] text-ink-3 leading-relaxed mb-4">{CONFIRM_PAYMENT_REASSURANCE}</p>
            {payNowState.phase === 'pending' && (
              <p className="text-xs text-amber-deep leading-relaxed mb-3" data-testid="billing-trial-confirm-pending">{payNowState.message}</p>
            )}
            {payNowState.phase === 'error' && (
              <p className="text-xs text-red leading-relaxed mb-3" data-testid="billing-trial-confirm-error">{payNowState.message}</p>
            )}
            <div className="flex items-center gap-4 flex-wrap">
              <BBButton
                size="sm"
                variant="amber"
                data-testid="billing-trial-confirm-cta"
                onClick={() => void handlePayNow()}
                disabled={payNowState.phase === 'submitting' || payNowState.phase === 'pending'}
              >
                {payNowState.phase === 'submitting' || payNowState.phase === 'pending' ? 'Processing…' : CONFIRM_PAYMENT_CTA}
              </BBButton>
              {!trialCancelConfirm && (
                <button
                  type="button"
                  className="text-[13px] text-ink-3 hover:text-red transition-colors disabled:opacity-50"
                  disabled={cancelLoading}
                  onClick={() => setTrialCancelConfirm(true)}
                  data-testid="billing-trial-cancel"
                >
                  Cancel trial
                </button>
              )}
            </div>
            {trialCancelConfirm && (
              <div className="mt-4 p-4 bg-paper border border-line rounded-lg space-y-3">
                <p className="text-[13px] text-ink-2 leading-relaxed">
                  {heldTrialCancelCopy(formatConfirmDate(heldUntil))}
                </p>
                <div className="flex gap-2">
                  <BBButton size="sm" variant="amber" onClick={() => setTrialCancelConfirm(false)}>
                    Keep my trial
                  </BBButton>
                  <BBButton
                    size="sm"
                    variant="ghost"
                    disabled={cancelLoading}
                    onClick={() => { setTrialCancelConfirm(false); void handleCancelSubscription() }}
                  >
                    {cancelLoading ? 'Cancelling...' : 'Cancel trial'}
                  </BBButton>
                </div>
              </div>
            )}
          </div>
        )}

        {chargesAutomatically(sub) && sub?.trial_ends_at && remainingDays(sub.trial_ends_at) > 0 && (
          <div className="rounded-xl border border-line bg-paper-2 px-6 py-5" data-testid="billing-trial-auto">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">
              Free trial
            </div>
            <h2 className="text-lg font-bold text-ink leading-snug mb-1">
              <span className="font-mono">{remainingDays(sub.trial_ends_at)}</span>{' '}
              {remainingDays(sub.trial_ends_at) === 1 ? 'day' : 'days'} left in your {meta.label} trial
            </h2>
            <p className="text-[13.5px] text-ink-2 leading-relaxed mb-4" data-testid="billing-trial-auto-copy">
              {(() => {
                const amount = trialRenewalAmount(sub, apiPlan ?? null)
                return amount != null
                  ? trialAutoConvertCopy(sub.trial_ends_at, amount, sub.billing_cycle === 'yearly' ? 'yearly' : 'monthly')
                  : `Trial — ends ${formatDate(sub.trial_ends_at)}. Then charged automatically.`
              })()}{' '}
              Cancel any time before then and nothing is charged.
            </p>
            {!trialCancelConfirm ? (
              <button
                className="text-[13px] text-ink-3 hover:text-red transition-colors disabled:opacity-50"
                disabled={cancelLoading}
                onClick={() => setTrialCancelConfirm(true)}
                data-testid="billing-trial-cancel"
              >
                Cancel trial
              </button>
            ) : (
              <div className="p-4 bg-paper border border-line rounded-lg space-y-3">
                <p className="text-[13px] text-ink-2 leading-relaxed">
                  {cardTrialCancelCopy(formatDate(sub.trial_ends_at))}
                </p>
                <div className="flex gap-2">
                  <BBButton size="sm" variant="amber" onClick={() => setTrialCancelConfirm(false)}>
                    Keep my trial
                  </BBButton>
                  <BBButton
                    size="sm"
                    variant="ghost"
                    disabled={cancelLoading}
                    onClick={() => { setTrialCancelConfirm(false); void handleCancelSubscription() }}
                  >
                    {cancelLoading ? 'Cancelling...' : 'Cancel trial'}
                  </BBButton>
                </div>
              </div>
            )}
          </div>
        )}

        {sub?.status === 'trialing' && sub.trial_auto_converts !== true && !noCardTrial && sub.trial_ends_at && remainingDays(sub.trial_ends_at) > 0 && (
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
                  {/* Task 1064 (D1 residual): "returns to Free (5 GB)" named a
                      marketed plan that no longer exists (Free is admin-only —
                      see WP-B/task 1060). A lapsed trial is a DIFFERENT server
                      path from cancel, though: it drops to the 5 GB quota with
                      no deletion at all (a legacy, grandfathered trial lands on Free; a new-model
                      account never reaches this panel: it has the no-card trial and 14/60-day
                      retention, task 2085), not the cancel wipe-at-period-end model — so this stays
                      honest about the real (gentler) trial-lapse behavior
                      instead of borrowing the cancel copy verbatim. */}
                  {' '}No card required — if you do nothing, your account simply
                  drops to a 5 GB quota (uploads pause above that; existing files
                  stay put). Your files stay encrypted either way.
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
    </>
  )
}
