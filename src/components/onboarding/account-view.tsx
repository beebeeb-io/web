import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { BBButton, BBInput, Icon } from '@beebeeb/shared'
import { summarizeAccount, formatSize, type AccountSummary, type Tone } from '../../lib/onboarding/account-summary'
import type { AccountScreen, PlannedStep, StepScreen } from '../../lib/onboarding/plan'
import type { OnboardingDocument } from '../../lib/onboarding/types'
import { ActionError, type OnboardingPorts } from '../../lib/onboarding/ports'
import { ErrorLine, OnboardingFrame, Spinner } from './frame'
import { TrialStartCard } from '../no-card-trial'
import { trialOfferView } from '../../lib/no-card-trial'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-line bg-paper-2',
  attention: 'border-amber-deep bg-amber-bg',
  restricted: 'border-line-2 bg-paper-2',
}

function UsageBar({ summary }: { summary: AccountSummary }) {
  const u = summary.usage
  if (!u) return null
  const allowancePct =
    u.allowanceBytes !== null && u.quotaBytes > 0 ? Math.min(100, (u.allowanceBytes / u.quotaBytes) * 100) : null
  return (
    <div className="mb-4" data-testid="usage">
      <div className="relative h-[6px] rounded-full bg-paper-3 overflow-hidden">
        <div
          className={`h-full rounded-full ${u.overAllowance ? 'bg-amber-deep' : 'bg-amber'}`}
          style={{ width: `${Math.round(u.fraction * 100)}%` }}
        />
        {allowancePct !== null && u.overAllowance && (
          <div className="absolute top-0 bottom-0 w-px bg-ink-3" style={{ left: `${allowancePct}%` }} aria-hidden />
        )}
      </div>
      <div className="flex items-baseline justify-between mt-1.5 text-[11px] font-mono text-ink-3">
        <span data-testid="usage-used">{formatSize(u.usedBytes)} used</span>
        <span data-testid="usage-quota">of {formatSize(u.quotaBytes)}</span>
      </div>
      {u.overAllowanceNote && (
        <p className="text-[11px] text-ink-3 mt-1" data-testid="usage-over-allowance">
          {u.overAllowanceNote}
        </p>
      )}
    </div>
  )
}

function CapabilityRows({ summary }: { summary: AccountSummary }) {
  return (
    <ul className="border border-line rounded-md divide-y divide-line mb-4" data-testid="capabilities">
      {summary.rows.map((r) => (
        <li key={r.name} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]" data-capability={r.name} data-allowed={r.allowed}>
          <span className="flex items-center gap-2 text-ink">
            <Icon name={r.allowed ? 'check' : 'lock'} size={13} className={r.allowed ? 'text-amber-deep' : 'text-ink-4'} />
            {r.label}
          </span>
          <span className="text-ink-3 text-xs">
            {r.detail}
            {r.rawReason ? <span className="font-mono ml-1.5 text-ink-4">{r.rawReason}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The email-confirmation step of the account stage (`verify_email`). */
export function VerifyEmailStep({
  screen,
  ports,
}: {
  screen: StepScreen
  ports: OnboardingPorts
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await ports.actions.verifyEmail(code.trim())
      await ports.actions.refresh()
    } catch (err) {
      setError(
        err instanceof ActionError && err.code === 'rate_limited'
          ? 'Too many tries. Wait a few minutes and try again.'
          : 'That code is not right, or it has expired.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <OnboardingFrame
      screen="step:verify_email"
      title="Confirm your email"
      subtitle="We sent a code to the address on your account. Uploading starts once it is confirmed."
      position={screen.position}
      total={screen.total}
    >
      <form onSubmit={submit}>
        <BBInput
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          className="mb-3.5"
          data-testid="verify-email-code"
          required
        />
        {error && <ErrorLine>{error}</ErrorLine>}
        <BBButton type="submit" variant="amber" size="lg" className="w-full" disabled={busy || code.trim().length === 0}>
          Confirm
        </BBButton>
      </form>
    </OnboardingFrame>
  )
}

function StartTrialCard({ doc, ports }: { doc: OnboardingDocument; ports: OnboardingPorts }) {
  // Money fails closed: no offer, no purchase permission, no card (`trialOfferView` is null).
  const offer = trialOfferView(doc)
  if (!offer) return null
  return (
    <div className="border border-line rounded-md p-3.5" data-testid="step-start_trial">
      {offer.kind === 'available' ? (
        <TrialStartCard
          offer={offer}
          onStart={async (choice) => {
            await ports.actions.startTrial(offer.startEndpoint, { plan: choice.plan, billingCycle: choice.cycle })
            await ports.actions.refresh()
          }}
        />
      ) : (
        <p className="text-xs text-ink-3" data-testid="start-trial-unavailable">
          {offer.message}
        </p>
      )}
    </div>
  )
}

function ActionCard({ item, doc, ports }: { item: PlannedStep; doc: OnboardingDocument; ports: OnboardingPorts }) {
  const cta = doc.purchase?.ctaAllowed === true
  switch (item.step.id) {
    case 'start_trial':
      return <StartTrialCard doc={doc} ports={ports} />
    case 'choose_plan':
    case 'subscribe':
      // T8 follow-up replaces this with the document-driven plan list (T6).
      if (!cta) return null
      return (
        <Link
          to="/billing?view=change"
          data-testid={`step-${item.step.id}`}
          className="flex items-center justify-between border border-line rounded-md p-3.5 hover:bg-paper-2"
        >
          <span className="text-[13px] font-semibold text-ink">
            {item.step.id === 'choose_plan' ? 'See plans' : 'Subscribe'}
          </span>
          <Icon name="chevron-right" size={16} className="text-ink-3" />
        </Link>
      )
    case 'billing_profile':
      if (!cta) return null
      return (
        <Link
          to="/settings/billing"
          data-testid="step-billing_profile"
          className="flex items-center justify-between border border-line rounded-md p-3.5 hover:bg-paper-2"
        >
          <span className="text-[13px] font-semibold text-ink">Add your billing details</span>
          <Icon name="chevron-right" size={16} className="text-ink-3" />
        </Link>
      )
    default:
      return null
  }
}

export function AccountView({
  doc,
  screen,
  ports,
}: {
  doc: OnboardingDocument
  screen: AccountScreen
  ports: OnboardingPorts
}) {
  const summary = summarizeAccount(doc)
  const [refreshing, setRefreshing] = useState(false)
  const cards = screen.actions.map((a) => <ActionCard key={a.step.id} item={a} doc={doc} ports={ports} />)

  return (
    <OnboardingFrame screen={`account:${summary.state}`} title={summary.headline} wide>
      <div className={`border rounded-md px-3.5 py-3 mb-4 ${TONE_CLASS[summary.tone]}`} data-testid="account-state" data-state={summary.state} data-tone={summary.tone}>
        {summary.lines.length === 0 ? (
          <p className="text-xs text-ink-3">State: <span className="font-mono">{summary.state}</span></p>
        ) : (
          summary.lines.map((l, i) => (
            <p key={i} className="text-[13px] text-ink-2 leading-relaxed" data-testid="account-line">
              {l}
            </p>
          ))
        )}
      </div>

      <UsageBar summary={summary} />
      <CapabilityRows summary={summary} />

      {summary.plansManagedNote && (
        <p className="text-xs text-ink-3 mb-4" data-testid="plans-managed-note">
          {summary.plansManagedNote}
        </p>
      )}

      <div className="flex flex-col gap-2.5" data-testid="account-actions">{cards}</div>

      <div className="mt-4 flex justify-end">
        <BBButton
          variant="ghost"
          size="sm"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            try {
              await ports.actions.refresh()
            } finally {
              setRefreshing(false)
            }
          }}
        >
          {refreshing ? <Spinner label="Refreshing" /> : 'Refresh'}
        </BBButton>
      </div>
    </OnboardingFrame>
  )
}
