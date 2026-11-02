/**
 * The current plan card: badge, usage, period, paused and cancelling states, and the plan actions.
 *
 * The current-plan card of the change view: badge, usage meters, period,
 * paused/cancelling/trial-cap notices, the pause/cancel/switch actions and the
 * inline confirm flow. Moved verbatim out of the page (task W run 5).
 *
 * Must not: own state or call the API.
 */

import { ALLOWANCE_LINE, currentPlanName } from '../../lib/current-plan-display'
import { BBButton, BBChip, Icon } from '@beebeeb/shared'
import {
  cancelDowngrade,
} from '../../lib/api'
import { NoCardTrialPlanLines } from '../../components/no-card-trial'
import { formatStorageSI } from '../../lib/format'
import { formatCentsAsEur } from '../../lib/billing/money'
import { UsagePanel } from './UsagePanel'
import { trialTermsLine } from '../../lib/trial-checkout'
import {
  cancelledCompactLine,
  neverPaidViewDownloadSentence,
  trialCapExplainer,
  payNowButtonLabel,
} from '../../lib/trial-limits-copy'
import {
  formatDate,
  formatRemainingTime,
  orderedPaidPlans,
  planMeta,
  planRank,
  remainingDays,
} from './upgrade-plans'
import { SubscriptionStatusBadge } from './SubscriptionStatusBadge'
import { useBillingModel } from './model-context'

export function CurrentPlanCard() {
  const {
    showToast,
    navigate,
    accountStateLabel,
    trialOffer,
    noCardTrial,
    sub,
    cancelStep,
    cancelConfirm,
    setCancelStep,
    setCancelConfirm,
    cancelLoading,
    reactivateLoading,
    pauseLoading,
    resumeLoading,
    convertLoading,
    setDowngradeTarget,
    cancellingDowngrade,
    setCancellingDowngrade,
    loadData,
    effectivePlan,
    meta,
    periodLine,
    hasUsedTrial,
    accountState,
    hasNoPlan,
    currentPriceYearly,
    totalStorageBytes,
    usedBytes,
    usedPercent,
    cancelCopy,
    trialCapped,
    heldUntil,
    trialDateLabel,
    canAddStorage,
    baseTB,
    currentExtraTB,
    nextPlanDetails,
    nextPlan,
    billingInterval,
    addonPerTbCents,
    basePlanCents,
    basePriceCents,
    openUpgrade,
    handleCancelSubscription,
    pauseSupported,
    startCancelFlow,
    handlePauseSubscription,
    handleResumeSubscription,
    handleReactivate,
    handlePayNow,
    handleStartTrial,
    handleConvertTrial,
    payNowState,
  } = useBillingModel()
  return (
    <>
          {/* Current plan card */}
          <div className="border border-line rounded-xl p-5 bg-paper relative" data-testid="chooser-current-plan-card">
            {/* Plan badge */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1">
                  Current plan
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-[28px] font-bold tracking-tight leading-none" data-testid="chooser-current-plan-name">
                    {currentPlanName({ accountStateLabel, hasNoPlan, planLabel: meta.label, noCardTrial: noCardTrial !== null })}
                  </span>
                  {sub?.billing_cycle === 'yearly' && effectivePlan !== 'free' && !noCardTrial && (
                    <BBChip variant="amber">Yearly</BBChip>
                  )}
                  {sub?.billing_cycle === 'monthly' && effectivePlan !== 'free' && !noCardTrial && (
                    <BBChip>Monthly</BBChip>
                  )}
                </div>
                {accountState === 'needs_plan' && accountStateLabel === 'allowance' && (
                  <div className="mt-1.5 text-[13px] text-ink-3" data-testid="chooser-allowance-line">
                    {ALLOWANCE_LINE}
                  </div>
                )}
                {noCardTrial && <NoCardTrialPlanLines status={noCardTrial} testIdPrefix="chooser-current-plan" />}
                {effectivePlan !== 'free' && !noCardTrial && (
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
              {!noCardTrial && <SubscriptionStatusBadge sub={sub} effectivePlan={effectivePlan} />}
            </div>

            {/* Storage usage */}
            <UsagePanel
              variant="progress"
              usedBytes={usedBytes}
              totalStorageBytes={totalStorageBytes}
              usedPercent={usedPercent}
              extraTb={currentExtraTB}
              baseTb={baseTB}
              canAddStorage={canAddStorage}
              noCardTrial={noCardTrial !== null}
            />


            {/* Next billing / trial ends (flow-money #5). Cancelling is
                excluded here: the cancelling panel below owns that date. */}
            {periodLine && !noCardTrial && periodLine.label !== 'Access until' && (
              <div className="flex items-center gap-3 p-3 bg-paper-2 border border-line rounded-lg text-xs">
                <Icon name="clock" size={13} className="text-ink-3 shrink-0" />
                <span className="flex-1">
                  {periodLine.label} <strong>{trialDateLabel(periodLine.dateIso)}</strong>
                </span>
              </div>
            )}

            {/* Paused state — billing collection paused (task 0544) */}
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

            {/* Cancelling state — task 1605: server-driven copy from
                uploads_blocked_at / access_until / data_deletion_at, in place
                of the previous hardcoded "stays fully active until
                <current_period_end>" / "permanently deleted on
                <current_period_end>" text. That copy was wrong on two counts
                (task 1605 Notes, 1604 gate-9 screenshot): it claimed a
                deletion date that BB_CANCEL_WIPE_ENABLED-off prod never
                enforces, and — Guus's 2026-09-29 ruling — it is flatly untrue
                for a never-paid trial cancelled before its first charge,
                which loses UPLOAD access immediately, not at period end. */}
            {cancelCopy && (
              <div
                data-testid="cancelling-card"
                data-cancel-kind={cancelCopy.kind}
                className="rounded-lg border border-amber/40 bg-amber-bg/40 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Icon name={cancelCopy.uploadsBlockedNow ? 'upload' : 'clock'} size={14} className="text-amber-deep shrink-0" />
                      <span className="text-sm font-semibold text-ink" data-testid="cancelling-headline">
                        {cancelCopy.kind === 'never_paid_trial'
                          ? cancelledCompactLine(cancelCopy, formatDate)
                          : (formatRemainingTime(cancelCopy.accessUntilIso) ?? 'Expires soon')}
                      </span>
                    </div>

                    {cancelCopy.kind === 'never_paid_trial' ? (
                      <>
                        <p className="text-xs text-ink-2 leading-relaxed">
                          You cancelled your trial before its first payment, so
                          uploads and new shares are off.{' '}
                          {neverPaidViewDownloadSentence(cancelCopy, formatDate)}
                        </p>
                        {cancelCopy.deletionIso && (
                          <p className="text-xs text-ink-2 leading-relaxed">
                            Files deleted on{' '}
                            <strong className="font-mono text-ink">{formatDate(cancelCopy.deletionIso)}</strong>.
                            Download them first — the{' '}
                            <span className="font-mono">bb</span> CLI or the desktop app can pull your whole vault.
                          </p>
                        )}
                        <p className="text-xs text-ink-3 leading-relaxed">
                          We can&apos;t recover this after that date. Resume your trial to upload again.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-ink-2 leading-relaxed">
                          Your {meta.label} plan stays fully active until{' '}
                          {cancelCopy.accessUntilIso ? (
                            <strong className="font-mono">{formatDate(cancelCopy.accessUntilIso)}</strong>
                          ) : (
                            '—'
                          )}
                          .
                          {sub?.billing_cycle === 'yearly' &&
                            cancelCopy.accessUntilIso &&
                            remainingDays(cancelCopy.accessUntilIso) > 30 && <> You have pre-paid for the full year.</>}
                        </p>
                        {/* WP-B (task 1060): the true wipe model. Task 1605: only
                            claim a deletion date the server has actually
                            computed — data_deletion_at, never a blind reuse of
                            the access date. */}
                        {cancelCopy.deletionIso ? (
                          <p className="text-xs text-ink-2 leading-relaxed">
                            Your files will be permanently deleted on{' '}
                            <strong className="font-mono text-ink">{formatDate(cancelCopy.deletionIso)}</strong>
                            {(() => {
                              const left = remainingDays(cancelCopy.deletionIso)
                              return left > 0 ? (
                                <> (<span className="font-mono">{left} day{left !== 1 ? 's' : ''}</span> left)</>
                              ) : null
                            })()}
                            . Download them first — the{' '}
                            <span className="font-mono">bb</span> CLI or the desktop app can pull your whole vault.
                          </p>
                        ) : (
                          <p className="text-xs text-ink-2 leading-relaxed">
                            Download your files before then — the{' '}
                            <span className="font-mono">bb</span> CLI or the desktop app can pull your whole vault.
                          </p>
                        )}
                        <p className="text-xs text-ink-3 leading-relaxed">
                          We can&apos;t recover this. Reactivate any time before then to keep everything.
                        </p>
                      </>
                    )}
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

            {/* Task 1605 — active mandated trial, still under the 25 GB cap
                (server clears trial_storage_cap_bytes after the first
                successful charge). Guus, 2026-09-29: "we need to make sure
                the user is not limited to 25gb for 2 weeks" — pay now ends
                the trial early and unlocks the full plan quota. */}
            {trialCapped && !noCardTrial && sub?.trial_storage_cap_bytes != null && (
              <div data-testid="trial-cap-card" className="rounded-lg border border-line-2 bg-paper-2 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Icon name="lock" size={14} className="text-ink-3 shrink-0" />
                      <span className="text-sm font-semibold text-ink">Trial storage cap</span>
                    </div>
                    <p className="text-xs text-ink-2 leading-relaxed" data-testid="trial-cap-explainer">
                      {trialCapExplainer(meta.label, sub.trial_storage_cap_bytes, formatStorageSI)}
                    </p>
                    {!heldUntil && payNowState.phase === 'pending' && (
                      <p className="text-xs text-amber-deep leading-relaxed" data-testid="pay-now-pending">
                        {payNowState.message}
                      </p>
                    )}
                    {!heldUntil && payNowState.phase === 'error' && (
                      <p className="text-xs text-red leading-relaxed" data-testid="pay-now-error">
                        {payNowState.message}
                      </p>
                    )}
                  </div>
                  {!heldUntil && (
                    <BBButton
                      size="sm"
                      variant="amber"
                      data-testid="pay-now-button"
                      onClick={() => void handlePayNow()}
                      disabled={payNowState.phase === 'submitting' || payNowState.phase === 'pending'}
                    >
                      {payNowState.phase === 'submitting'
                        ? 'Processing…'
                        : payNowState.phase === 'pending'
                          ? 'Processing…'
                          : payNowButtonLabel(meta.label)}
                    </BBButton>
                  )}
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
                   trialing, trial not previously used — task 1517: gated on
                   `hasUsedTrial`, the server-truth `has_used_trial` field, not
                   just a same-session 409), the amber primary action is "Start
                   14-day free trial" (task 0905, Pattern B — no card). A 409
                   trial_already_used flips `trialUsed` (defense-in-depth for a
                   race) and we fall back to the normal paid checkout entry.
                   Task 1064 (D5): this pair used to hardcode Pro for the trial
                   and Basic for straight-to-checkout regardless of which tier
                   card the user actually wants — the labels now name the tier
                   they act on, and BOTH start a trial for their own tier (every
                   marketed tier except Teams offers one; see the "Compare
                   plans" table below, which is the precise per-tier entry
                   point via handleUpgradeOrTrial). */
                sub?.status !== 'trialing' && !hasUsedTrial ? (
                  <>
                    <BBButton
                      variant="amber"
                      size="md"
                      onClick={() => handleStartTrial('pro')}
                    >
                      Start 14-day Pro trial
                    </BBButton>
                    <BBButton
                      size="md"
                      onClick={() => handleStartTrial('basic')}
                    >
                      Start 14-day Basic trial
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
              ) : sub?.status === 'trialing' && sub.trial_auto_converts === true ? (
                /* Task 1037 — a trial started with a mandate converts on its
                   own; nothing to add. The trial panel above carries the
                   charge date + amount and the cancel action. */
                null
              ) : sub?.status === 'trialing' && noCardTrial ? (
                /* Task 1757 — a trial without a card has no mandate to charge ("pay now") and
                   nothing to convert (server 409 trial_convert_unavailable): it subscribes at
                   checkout, like anyone else, and the first charge lifts the cap.
                   Task 1842 — it is not a Pro subscription either, so the action is "Choose a
                   plan", which takes the user to the plan table below, never "Subscribe to Pro". */
                <BBButton
                  variant="amber"
                  size="md"
                  onClick={() =>
                    document.querySelector('[data-testid="plan-comparison"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  data-testid="chooser-choose-plan"
                >
                  Choose a plan
                  <Icon name="chevron-right" size={13} className="ml-1.5" />
                </BBButton>
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
                eligible state (task 0905); gated on `hasUsedTrial` (task 1517)
                so an account that already used its trial never sees this. */}
            {effectivePlan === 'free' && sub?.status !== 'trialing' && !hasUsedTrial && (
              <p className="mt-2.5 text-[11.5px] text-ink-3">
                {trialTermsLine(14, { noCardOffered: trialOffer?.kind === 'available' })}
              </p>
            )}

            {/* Cancel plan — paid plans only, not already cancelling or paused.
                Three steps (task 0544 added 'pause'):
                  idle    → "Cancel plan" link
                  pause   → "Pause instead?" card with 30/60/90-day options
                  confirm → existing cancel-confirmation panel
            */}
            {effectivePlan !== 'free' && sub?.status !== 'cancelling' && sub?.status !== 'paused' && sub?.status !== 'trialing' && (
              cancelStep === 'pause' && pauseSupported ? (
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
                // "Before you go" retention moment (task 1058 redesign): a calm,
                // honest "what you'd lose" framing — NOT a scare. One level, no
                // card-in-card. The before→after block uses a subtle paper panel
                // (never alarming red); all sizes/dates are mono; amber is reserved
                // for the Keep primary + the downsell accent only.
                <div className="mt-3 p-4 bg-paper-2 border border-line rounded-lg space-y-3.5">
                  <div className="text-sm font-semibold text-ink">Before you go</div>

                  {/* WP-B (task 1060): the TRUE wipe model. Cancelling keeps full
                      access until period-end; AT that date the account closes and
                      ALL files are permanently deleted — regardless of size (Free is
                      admin-only, there is no Free landing). Honest + calm, not a
                      scare; the one genuinely alarming fact (permanent deletion on a
                      specific date) is stated plainly. */}
                  <p className="text-[13px] text-ink-2 leading-relaxed">
                    Cancelling keeps {planMeta[effectivePlan]?.label ?? 'your plan'} until{' '}
                    <span className="font-mono text-ink">{formatDate(sub?.current_period_end ?? null)}</span>.{' '}
                    <strong className="text-ink">
                      On <span className="font-mono">{formatDate(sub?.current_period_end ?? null)}</span>, your account
                      closes and all your files are permanently deleted.
                    </strong>
                  </p>

                  {/* Download-everything-first — the prominent escape hatch. The
                      remaining paid period IS the download window. Shown ALWAYS
                      (not only over-quota): every byte goes, so everyone should
                      pull their vault before the date. */}
                  <div className="bg-paper-2 border border-amber/40 rounded-md p-3.5 space-y-2">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                      <Icon name="download" size={14} className="text-amber-deep shrink-0" />
                      Download everything first
                    </div>
                    <p className="text-[12.5px] text-ink-2 leading-relaxed">
                      {usedBytes > 0 && (
                        <>You&apos;re storing <span className="font-mono text-ink">{formatStorageSI(usedBytes)}</span>. </>
                      )}
                      The <span className="font-mono">bb</span> CLI or the desktop app can pull your whole vault in one go.{' '}
                      <a
                        href="/?sort=size&order=desc"
                        onClick={(e) => { e.preventDefault(); navigate('/?sort=size&order=desc'); setCancelConfirm(false); }}
                        className="text-amber-deep hover:text-amber transition-colors"
                      >
                        Review my files
                      </a>
                      . We can&apos;t recover them once they&apos;re deleted.
                    </p>
                  </div>

                  {/* Yearly pre-paid — honest reassurance, kept calm (mono amount) */}
                  {sub?.billing_cycle === 'yearly' && sub.current_period_end && remainingDays(sub.current_period_end) > 0 && (
                    <p className="text-[12px] text-ink-3 leading-relaxed">
                      You&apos;ve pre-paid <span className="font-mono">EUR {currentPriceYearly.toFixed(2)}</span> for the year — full access stays until then.
                    </p>
                  )}

                  {/* Downsell — keep the existing lower-plan logic, present cleanly as an amber link.
                      Explicitly excludes comingSoon plans (task 1064, D8) — Teams
                      (`business`) is not purchasable via checkout, so it must never be
                      offered as a retention downsell even though it's latent today
                      (it's the top rank, so it never satisfies "< currentRank" yet). */}
                  {(() => {
                    const currentRank = planRank[effectivePlan] ?? 0
                    const lowerPlans = orderedPaidPlans
                      .filter((p) => (planRank[p] ?? 0) < currentRank && (planRank[p] ?? 0) > 0 && !planMeta[p]?.comingSoon)
                      .map((p) => ({ id: p, ...(planMeta[p] ?? planMeta.free) }))
                    if (lowerPlans.length === 0) return null
                    return (
                      <div className="pt-0.5 text-[12.5px] text-ink-3 leading-relaxed space-y-1">
                        <div>
                          Not ready?{' '}
                          {lowerPlans.map((lp, i) => (
                            <span key={lp.id}>
                              {i > 0 && <span className="text-ink-4"> · </span>}
                              <button
                                onClick={() => { setCancelConfirm(false); setDowngradeTarget(lp.id); }}
                                className="font-medium text-amber-deep hover:text-amber transition-colors"
                              >
                                Switch to {lp.label} — <span className="font-mono">EUR {lp.priceMonthly.toFixed(2)}/mo · {formatStorageSI(lp.storageGB * 1_000_000_000)}</span>
                              </button>
                            </span>
                          ))}
                        </div>
                        {/* Over-quota-for-target note: if current usage exceeds the
                            SMALLEST offered lower tier, switching there still needs the
                            user to free up data to fit. Honest, consistent with
                            DowngradeDialog's over-quota section. */}
                        {(() => {
                          const smallest = lowerPlans.reduce((a, b) => (b.storageGB < a.storageGB ? b : a))
                          const limit = smallest.storageGB * 1_000_000_000
                          if (usedBytes <= limit) return null
                          return (
                            <p className="text-[12px] text-ink-3">
                              You&apos;re using <span className="font-mono">{formatStorageSI(usedBytes)}</span> — to fit {smallest.label}&apos;s <span className="font-mono">{formatStorageSI(limit)}</span> you&apos;d first need to free up <span className="font-mono">{formatStorageSI(usedBytes - limit)}</span>.
                            </p>
                          )
                        })()}
                      </div>
                    )
                  })()}

                  {/* Actions — Keep <plan> leads as the amber primary; Cancel is a quiet link */}
                  <div className="flex items-center gap-4 pt-1">
                    <BBButton
                      size="md"
                      variant="amber"
                      onClick={() => setCancelConfirm(false)}
                    >
                      Keep {planMeta[effectivePlan]?.label ?? 'plan'}
                    </BBButton>
                    <button
                      className="text-[12px] text-ink-4 hover:text-red transition-colors disabled:opacity-50"
                      onClick={() => void handleCancelSubscription()}
                      disabled={cancelLoading}
                    >
                      {cancelLoading ? 'Cancelling...' : 'Cancel anyway'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <button
                    className="text-[11.5px] text-ink-4 hover:text-red transition-colors disabled:opacity-50"
                    onClick={() => void startCancelFlow()}
                  >
Cancel plan
                  </button>
                </div>
              )
            )}
          </div>
    </>
  )
}
