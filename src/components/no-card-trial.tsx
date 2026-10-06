/**
 * The no-card trial, drawn (task 1757; spec 4b.3, 4b.4, 4b.7).
 *
 * Presentational pieces shared by the plan chooser, the billing page, the account
 * page and the drive banners. Nothing here fetches: the document-derived views come
 * from `src/lib/no-card-trial.ts`, and the start is a callback so the account page
 * (ports) and the chooser (the API client) share one form.
 *
 * Voice: a trial here has no card, so these components never say "charged" about the
 * trial and never ask for payment details. What happens at the end is said plainly,
 * including the part that hurts (files above the allowance are read-only, then deleted).
 * Amber marks the one primary action and the encryption state, nothing else.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BBButton, Icon } from '@beebeeb/shared'
import { getPlans, type Plan } from '../lib/api'
import { PAID_CHECKOUT_PATH } from '../lib/account-state'
import { formatSize } from '../lib/onboarding/account-summary'
import {
  NEVER_PAID_RETENTION_DAYS,
  hasAllowance,
  startTrialErrorCopy,
  type NoCardTrialStatus,
  type TrialEndedStatus,
  type TrialOfferView,
} from '../lib/no-card-trial'
import { readPlanIntent, type BillingCycle } from '../lib/plan-intent'
import { DEFAULT_TRIAL_PLAN, buildTrialPlanOptions, isTrialPlanSlug, type TrialPlanSlug } from '../lib/trial-checkout'
import { TrialPlanPicker } from './trial-plan-picker'

type AvailableOffer = Extract<TrialOfferView, { kind: 'available' }>
type UnavailableOffer = Extract<TrialOfferView, { kind: 'unavailable' }>

/**
 * "Up to 10 GB for 14 days. No card, nothing to cancel. When it ends, your 2 GB stays."
 * With no allowance (task 1837) nothing stays, and the line says what does happen: the
 * files go read-only and are deleted {@link NEVER_PAID_RETENTION_DAYS} days later unless
 * a plan is chosen.
 */
export function trialTermsLine(offer: AvailableOffer): string {
  const head = `Up to ${formatSize(offer.capBytes)} for ${offer.lengthDays} days. No card, nothing to cancel.`
  if (hasAllowance(offer.allowanceBytes)) return `${head} When it ends, your ${formatSize(offer.allowanceBytes)} stays.`
  return `${head} If you do not choose a plan by then, your files become read-only and are deleted ${NEVER_PAID_RETENTION_DAYS} days after it ends.`
}

/** Plan options from the API when it answers, the constants otherwise. */
function usePlanOptions() {
  const [apiPlans, setApiPlans] = useState<Plan[] | null>(null)
  useEffect(() => {
    let alive = true
    getPlans()
      .then((p) => alive && setApiPlans(p))
      .catch(() => {
        /* plan-constants fallback */
      })
    return () => {
      alive = false
    }
  }, [])
  return useMemo(() => buildTrialPlanOptions(apiPlans), [apiPlans])
}

/**
 * Pick the plan whose features the trial shows, then start. `onStart` rejects with
 * the error to word; this component words it and stays on the page.
 */
export function TrialStartCard({
  offer,
  onStart,
  initialPlan,
  initialCycle,
  title,
}: {
  offer: AvailableOffer
  onStart: (choice: { plan: TrialPlanSlug; cycle: BillingCycle }) => Promise<void>
  initialPlan?: string | null
  initialCycle?: BillingCycle
  title?: string
}) {
  const intent = useMemo(() => readPlanIntent(), [])
  const planOptions = usePlanOptions()
  // The offer is the authority for the length (heading, terms, button AND every row):
  // a plan's own `trial_days` or the 14-day fallback must never contradict it.
  const options = useMemo(() => planOptions.map((o) => ({ ...o, trialDays: offer.lengthDays })), [planOptions, offer.lengthDays])
  const [plan, setPlan] = useState<TrialPlanSlug>(
    isTrialPlanSlug(initialPlan) ? initialPlan : isTrialPlanSlug(intent?.plan) ? intent.plan : DEFAULT_TRIAL_PLAN,
  )
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle ?? intent?.cycle ?? 'monthly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onStart({ plan, cycle })
    } catch (err) {
      setError(startTrialErrorCopy(err, offer.allowanceBytes))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3.5" data-testid="trial-start">
      <div>
        <p className="text-[13.5px] font-semibold text-ink">{title ?? `Try a plan for ${offer.lengthDays} days`}</p>
        <p className="text-xs text-ink-3 mt-0.5 leading-relaxed" data-testid="trial-terms">
          {trialTermsLine(offer)}
        </p>
      </div>
      <TrialPlanPicker
        noCard
        label="Plan to try"
        options={options}
        plan={plan}
        cycle={cycle}
        onPlanChange={setPlan}
        onCycleChange={setCycle}
      />
      {error && (
        <p role="alert" className="text-xs text-red leading-relaxed" data-testid="trial-start-error">
          {error}
        </p>
      )}
      <BBButton
        variant="amber"
        size="lg"
        className="w-full justify-center"
        onClick={() => void start()}
        disabled={busy}
        data-testid="start-trial"
      >
        {busy ? 'Starting' : `Start ${offer.lengthDays}-day trial, no card`}
      </BBButton>
    </div>
  )
}

/** Why no trial can start right now, in words, with the way forward (a plan) where there is one. */
export function TrialUnavailableNote({ offer, showPlansLink = true }: { offer: UnavailableOffer; showPlansLink?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-paper-2 px-3.5 py-3" data-testid="trial-unavailable" data-reason={offer.reason}>
      <p className="text-[13px] text-ink-2 leading-relaxed">{offer.message}</p>
      {showPlansLink && offer.reason !== 'email_unverified' && (
        <Link
          to={PAID_CHECKOUT_PATH}
          className="mt-1.5 inline-block text-[12.5px] font-medium text-amber-deep hover:underline"
          data-testid="trial-unavailable-plans"
        >
          See plans
        </Link>
      )}
    </div>
  )
}

/** Subscribe is paid checkout: a trial without a card has nothing to convert (server `trial_convert_unavailable`). */
function SubscribeButton({ testId }: { testId: string }) {
  const navigate = useNavigate()
  return (
    <BBButton size="sm" variant="amber" className="shrink-0" onClick={() => navigate(PAID_CHECKOUT_PATH)} data-testid={testId}>
      Subscribe
    </BBButton>
  )
}

function CapMeter({ status }: { status: NoCardTrialStatus }) {
  return (
    <div className="min-w-[10rem] flex-1">
      <div className="h-[5px] rounded-full bg-paper-3 overflow-hidden" aria-hidden>
        <div
          className={`h-full rounded-full ${status.atCap ? 'bg-amber-deep' : 'bg-amber'}`}
          style={{ width: `${Math.round(status.fraction * 100)}%` }}
        />
      </div>
      <div className="mt-1 font-mono text-[11px] text-ink-3" data-testid="trial-cap-meter">
        {formatSize(status.usedBytes)} of {formatSize(status.capBytes)}
      </div>
    </div>
  )
}

/**
 * The running trial: end date, days left, cap meter, and one sentence on what the end
 * means. `banner` sits at the top of the drive; `panel` is the billing page card.
 */
export function NoCardTrialStatusCard({
  status,
  canSubscribe,
  variant,
}: {
  status: NoCardTrialStatus
  canSubscribe: boolean
  variant: 'banner' | 'panel'
}) {
  const subscribe = canSubscribe ? <SubscribeButton testId="trial-subscribe" /> : null

  if (variant === 'banner') {
    return (
      <div
        role="status"
        data-testid="trial-banner-no-card"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 bg-paper-2 border-b border-line text-[12.5px] text-ink"
      >
        <Icon name="clock" size={12} className="text-amber-deep shrink-0" />
        <span className="flex-1 min-w-[14rem] text-ink-2 leading-relaxed">
          <span className="font-semibold text-ink">Trial, no card.</span>{' '}
          {status.endsOn ? (
            <>
              Ends <span className="font-mono text-ink" data-testid="trial-ends-on">{status.endsOn}</span>.{' '}
            </>
          ) : null}
          <span className="font-mono text-ink" data-testid="trial-days-left">{status.daysLeftLabel}</span>.{' '}
          <span data-testid="trial-consequence">{status.consequence}</span>
          {status.sharingNote ? <> <span data-testid="trial-sharing-note">{status.sharingNote}</span></> : null}
        </span>
        <CapMeter status={status} />
        {subscribe}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-paper-2 px-6 py-5" data-testid="billing-no-card-trial">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-deep mb-1">Trial, no card</div>
      <h2 className="text-lg font-bold text-ink leading-snug mb-1">
        {status.endsOn ? (
          <>
            Your trial runs until <span className="font-mono" data-testid="trial-ends-on">{status.endsOn}</span>
          </>
        ) : (
          'Your trial is running'
        )}
      </h2>
      <p className="text-[13px] text-ink-3 mb-3">
        <span className="font-mono text-ink-2" data-testid="trial-days-left">{status.daysLeftLabel}</span>
        {' · '}up to <span className="font-mono">{formatSize(status.capBytes)}</span> of storage
      </p>
      <div className="mb-3 max-w-md">
        <CapMeter status={status} />
      </div>
      <p className="text-[13.5px] text-ink-2 leading-relaxed mb-1" data-testid="trial-consequence">
        {status.consequence}
      </p>
      {status.sharingNote && (
        <p className="text-[13px] text-ink-3 leading-relaxed mb-1" data-testid="trial-sharing-note">
          {status.sharingNote}
        </p>
      )}
      <p className="text-[13px] text-ink-3 leading-relaxed mb-4">
        There is no card on file and no subscription, so there is nothing to cancel.
      </p>
      {subscribe}
    </div>
  )
}

/** The trial ended with files above the allowance (or with no allowance at all): read-only, a deletion date, how to trim, and Subscribe. */
export function TrialEndedCard({
  status,
  variant,
}: {
  status: TrialEndedStatus
  variant: 'banner' | 'panel'
}) {
  const subscribe = status.canSubscribe ? <SubscribeButton testId="trial-ended-subscribe" /> : null

  if (variant === 'banner') {
    return (
      <div
        role="alert"
        data-testid="trial-ended-banner"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 bg-red/10 border-b border-red/30 text-[12.5px]"
      >
        <Icon name="lock" size={13} className="text-red shrink-0" />
        <span className="flex-1 min-w-[16rem] text-ink leading-relaxed">
          <span data-testid="trial-ended-body">{status.body}</span>{' '}
          <span className="text-ink-2" data-testid="trial-ended-trim">{status.trimGuidance}</span>
        </span>
        {subscribe}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-red/30 bg-red/5 px-6 py-5" data-testid="billing-trial-ended">
      <div className="flex items-start gap-3">
        <Icon name="lock" size={16} className="text-red shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-red mb-1">{status.allowanceBytes === null ? 'Read-only' : 'Read-only above your allowance'}</div>
          <h2 className="text-lg font-bold text-ink leading-snug mb-1.5">{status.headline}</h2>
          <p className="text-[13.5px] text-ink-2 leading-relaxed mb-1" data-testid="trial-ended-body">
            {status.body}
          </p>
          <p className="text-[13px] text-ink-3 leading-relaxed mb-4" data-testid="trial-ended-trim">
            {status.trimGuidance}
          </p>
          {subscribe}
        </div>
      </div>
    </div>
  )
}
