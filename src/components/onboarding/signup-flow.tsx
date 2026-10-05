import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BBButton, BBCheckbox, BBInput, Icon } from '@beebeeb/shared'
import { runBreachCheck } from '../../lib/onboarding/breach-step'
import { CeremonyError, type BreachCheckProxy, type CeremonyProxy, type PasswordEvaluation } from '../../lib/crypto'
import { planScreen, type Screen, type StepScreen } from '../../lib/onboarding/plan'
import { runCreateAccount } from '../../lib/onboarding/create-account'
import { formatCountdown, resendRemainingSeconds } from '../../lib/onboarding/resend'
import { ActionError, type OnboardingPorts } from '../../lib/onboarding/ports'
import type { OnboardingDocument, SignupPolicy } from '../../lib/onboarding/types'
import {
  StepBlocked,
  StepFallback,
  SignupUnavailable,
  UnsupportedSchema,
  UpdateRequired,
} from './blocking-screens'
import { ErrorLine, OnboardingFrame, RegionFooter, Spinner } from './frame'

/**
 * The pre-account flow (stage `pre_account`): enter_email, verify_email_code,
 * accept_terms, set_password, save_recovery_phrase, create_account, in the
 * order and with the numbers the document declares.
 *
 * What lives where (spec 5.5, 5.12):
 *   - The planner (`planScreen`) picks the screen. This file never decides
 *     order, never skips a step on its own, never invents policy.
 *   - Password policy, the breach gate, the recovery phrase and OPAQUE all run
 *     in the core WASM ceremony. The fields below are inputs and buttons.
 *   - The ceremony is wiped (`dispose` = `abandon` + free) when the flow is
 *     left, restarted, or fails for a reason the person cannot retry.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Session {
  email: string
  pilotKey: string
  ticket: string
  /** Held only until the device vault is wrapped (create_account), then dropped. */
  password: string
  /** When email-start last succeeded, for the "send a new code in m:ss" countdown. */
  emailSentAt: number | null
}

const freshSession = (): Session => ({ email: '', pilotKey: '', ticket: '', password: '', emailSentAt: null })

interface Ctx {
  doc: OnboardingDocument
  policy: SignupPolicy
  ports: OnboardingPorts
  /** Null until the WASM ceremony is ready; the secret-bearing steps wait for it. */
  ceremony: CeremonyProxy | null
  session: React.MutableRefObject<Session>
  screen: StepScreen
  /** Mark a spec step done; clear removes ids so the planner returns to them. */
  done: (id: string) => void
  undo: (...ids: string[]) => void
  notice: string
  setNotice: (n: string) => void
  startOver: () => void
}

/** A context in which the ceremony exists (the steps that touch the password or phrase). */
type CeremonyCtx = Ctx & { ceremony: CeremonyProxy }

function ceremonyMessage(code: string): string {
  switch (code) {
    case 'password_mismatch':
      return 'The two passwords do not match.'
    case 'password_too_short':
      return 'That password is too short.'
    case 'phrase_word_mismatch':
      return 'Those words do not match your recovery phrase. Check them against what you wrote down.'
    case 'breach_prefix_mismatch':
      return 'We could not check this password against known breaches. Try again.'
    case 'phrase_answer_count':
      return 'Fill in every word.'
    default:
      return 'Something went wrong on this device. Try again.'
  }
}

// ── enter_email ──────────────────────────────────────────────────────────────

function EnterEmailStep({ ctx }: { ctx: Ctx }) {
  const { session, ports, doc, screen } = ctx
  const [email, setEmail] = useState(session.current.email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!EMAIL_RE.test(trimmed)) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const previous = session.current.email
      const same = previous !== '' && previous.toLowerCase() === trimmed.toLowerCase()
      if (same && session.current.emailSentAt !== null) {
        // Same address, mail already sent: do not send a second one.
        ctx.done('enter_email')
        return
      }
      // The verified email changed: core withdraws verification, keeps the secrets.
      if (previous && !same && session.current.ticket) {
        await ctx.ceremony?.emailChanged()
        session.current.ticket = ''
        ctx.undo('verify_email_code')
      }
      await ports.actions.emailStart(trimmed, session.current.pilotKey)
      session.current.email = trimmed
      session.current.emailSentAt = Date.now()
      ctx.setNotice('')
      ctx.done('enter_email')
    } catch (err) {
      setError(
        err instanceof ActionError && err.code === 'rate_limited'
          ? 'Too many requests for this address. Try again later.'
          : 'We could not send the email. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <OnboardingFrame
      screen="step:enter_email"
      title="Create your account"
      subtitle="Start with your email. Everything you store is encrypted on your device before it leaves it, so we cannot read any of it."
      position={screen.position}
      total={screen.total}
    >
      <form onSubmit={submit}>
        <BBInput
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          icon="mail"
          className="mb-3.5"
          autoComplete="email"
          data-testid="onboarding-email"
          required
        />
        {error && <ErrorLine>{error}</ErrorLine>}
        <BBButton type="submit" variant="amber" size="lg" className="w-full" disabled={busy || !email.trim()}>
          Continue
        </BBButton>
        <RegionFooter line={doc.copy.region_line} />
      </form>
    </OnboardingFrame>
  )
}

// ── pilot_key ────────────────────────────────────────────────────────────────

function PilotKeyStep({ ctx }: { ctx: Ctx }) {
  const [key, setKey] = useState(ctx.session.current.pilotKey)
  return (
    <OnboardingFrame
      screen="step:pilot_key"
      title="Pilot access key"
      subtitle="Sign-up currently needs a pilot access key. Contact the team if you are a pilot."
      position={ctx.screen.position}
      total={ctx.screen.total}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ctx.session.current.pilotKey = key.trim()
          ctx.done('pilot_key')
        }}
      >
        <BBInput
          label="Access key"
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          icon="key"
          autoComplete="off"
          className="mb-3.5"
          data-testid="onboarding-pilot-key"
          required
        />
        <BBButton type="submit" variant="amber" size="lg" className="w-full" disabled={!key.trim()}>
          Continue
        </BBButton>
      </form>
    </OnboardingFrame>
  )
}

// ── verify_email_code ────────────────────────────────────────────────────────

/** Wrong guesses the server allows across all live codes of one address (contract README). */
const GUESS_BUDGET = 5

function VerifyEmailCodeStep({ ctx }: { ctx: Ctx }) {
  const { policy, session, ports, screen } = ctx
  const length = typeof screen.step.params.length === 'number' ? screen.step.params.length : policy.emailCode.length
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resent, setResent] = useState(false)
  // Wrong codes on this screen. The server gives all live codes ONE shared
  // guess budget (5); once it is spent a fresh code is the only way forward
  // and the server issues it at once, so the wait is lifted (task 1738 F2).
  const [failedVerifies, setFailedVerifies] = useState(0)
  const budgetSpent = failedVerifies >= GUESS_BUDGET

  // A resend sends a fresh code, but only `resend_after_seconds` after the last
  // one (the server enforces the same window); count it down live.
  // `sentAt` lives in state, not just in the session ref: the effect below must
  // re-run on EVERY resend, and a boolean that stays true after the first one
  // would not (the countdown froze at 1:00 on the second resend).
  const [sentAt, setSentAt] = useState<number | null>(session.current.emailSentAt)
  const [now, setNow] = useState(() => Date.now())
  const remaining = resendRemainingSeconds(sentAt, policy.emailCode.resendAfterSeconds, now)
  useEffect(() => {
    if (resendRemainingSeconds(sentAt, policy.emailCode.resendAfterSeconds, Date.now()) <= 0) return
    setNow(Date.now())
    const timer = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (resendRemainingSeconds(sentAt, policy.emailCode.resendAfterSeconds, t) <= 0) {
        clearInterval(timer)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [sentAt, policy.emailCode.resendAfterSeconds])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (!ctx.ceremony) {
        setError('Encryption is still loading. Try again in a moment.')
        return
      }
      const { ticket } = await ports.actions.emailVerify(session.current.email, code.trim())
      session.current.ticket = ticket
      await ctx.ceremony.emailVerified()
      ctx.setNotice('')
      ctx.done('verify_email_code')
    } catch (err) {
      if (err instanceof ActionError && err.code === 'rate_limited') {
        setError('Too many tries. Wait a few minutes before trying again.')
      } else {
        setFailedVerifies((n) => n + 1)
        setError('That code is not right, or it has expired.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function askAgain() {
    setBusy(true)
    setError('')
    try {
      await ports.actions.emailStart(session.current.email, session.current.pilotKey)
      session.current.emailSentAt = Date.now()
      setNow(session.current.emailSentAt)
      setSentAt(session.current.emailSentAt)
      setFailedVerifies(0)
      setCode('')
      setResent(true)
    } catch {
      setError('We could not send another email. Try again later.')
    } finally {
      setBusy(false)
    }
  }

  const canAskAgain = remaining <= 0 || budgetSpent

  return (
    <OnboardingFrame
      screen="step:verify_email_code"
      title="Check your email"
      // Anti-enumeration copy (spec 5.9): identical for every address.
      subtitle="If this address can be used, we sent an email. Open it to continue. If you already have an account, the email says so and links to sign-in."
      position={screen.position}
      total={screen.total}
    >
      <form onSubmit={submit}>
        {ctx.notice && (
          <p className="text-xs text-ink-2 mb-3 border border-line rounded-md bg-paper-2 px-3 py-2" data-testid="code-notice">
            {ctx.notice}
          </p>
        )}
        <BBInput
          label={`${length}-digit code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          maxLength={length}
          onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
          className="mb-3.5 font-mono"
          data-testid="onboarding-code"
          required
        />
        {error && <ErrorLine>{error}</ErrorLine>}
        {budgetSpent && (
          <p className="text-xs text-ink-2 mb-3" data-testid="guess-budget-spent">
            Too many wrong codes. Ask for a new one.
          </p>
        )}
        <BBButton type="submit" variant="amber" size="lg" className="w-full" disabled={busy || code.length !== length}>
          Verify
        </BBButton>
        <div className="mt-3 flex items-center justify-between text-xs text-ink-3">
          <button
            type="button"
            className="underline hover:text-ink-2"
            onClick={() => ctx.undo('enter_email')}
            data-testid="use-different-email"
          >
            Use a different email
          </button>
          {canAskAgain ? (
            <button type="button" className="underline hover:text-ink-2" onClick={askAgain} disabled={busy}>
              Send a new code
            </button>
          ) : (
            <span data-testid="ask-again-at">
              You can ask for a new code in <span className="font-mono">{formatCountdown(remaining)}</span>
            </span>
          )}
        </div>
        {resent && <p className="text-xs text-ink-3 mt-2">If this address can be used, a new email is on its way.</p>}
      </form>
    </OnboardingFrame>
  )
}

// ── accept_terms ─────────────────────────────────────────────────────────────

function AcceptTermsStep({ ctx }: { ctx: Ctx }) {
  const { policy, screen } = ctx
  const version =
    typeof screen.step.params.version === 'string' ? (screen.step.params.version as string) : policy.terms.version
  const [terms, setTerms] = useState(false)
  const [understood, setUnderstood] = useState(false)
  return (
    <OnboardingFrame
      screen="step:accept_terms"
      title="Terms and privacy"
      position={screen.position}
      total={screen.total}
    >
      <p className="text-xs text-ink-3 mb-3" data-testid="terms-links">
        Read the{' '}
        {policy.terms.url ? (
          <a href={policy.terms.url} target="_blank" rel="noopener noreferrer" className="text-amber-deep hover:underline">Terms of Service</a>
        ) : (
          'Terms of Service'
        )}{' '}
        and the{' '}
        {policy.terms.privacyUrl ? (
          <a href={policy.terms.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-amber-deep hover:underline">Privacy Policy</a>
        ) : (
          'Privacy Policy'
        )}
        . Version <span className="font-mono">{version}</span>.
      </p>
      <div className="flex flex-col gap-3 mb-4">
        <BBCheckbox checked={terms} onChange={setTerms} label="I accept the Terms of Service and the Privacy Policy." />
        <BBCheckbox
          checked={understood}
          onChange={setUnderstood}
          label="I understand that Beebeeb cannot recover my account if I lose both my password and my recovery phrase. We can't recover this."
        />
      </div>
      <BBButton
        variant="amber"
        size="lg"
        className="w-full"
        disabled={!terms || !understood}
        onClick={() => ctx.done('accept_terms')}
        data-testid="accept-terms-continue"
      >
        Continue
      </BBButton>
    </OnboardingFrame>
  )
}

// ── set_password ─────────────────────────────────────────────────────────────

const METER_CLASS = ['bg-red', 'bg-ink-4', 'bg-amber', 'bg-green']

function hintText(e: PasswordEvaluation): { text: string; tone: string } {
  switch (e.hint) {
    case 'need_more_characters':
      return { text: `Needs at least ${e.min_length} characters, ${e.missing_characters} more.`, tone: 'text-red' }
    case 'mix_case_and_add_number_or_symbol':
      return { text: 'Mix upper and lowercase, and add a number or symbol.', tone: 'text-ink-3' }
    case 'mix_case':
      return { text: 'Mix upper and lowercase.', tone: 'text-ink-3' }
    case 'add_number_or_symbol':
      return { text: 'Add a number or symbol.', tone: 'text-ink-3' }
    default:
      return e.strength === 'strong'
        ? { text: 'Strong.', tone: 'text-green' }
        : { text: 'Good.', tone: 'text-ink-3' }
  }
}

function SetPasswordStep({ ctx }: { ctx: CeremonyCtx }) {
  const { policy, ports, ceremony, session, screen } = ctx
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [show, setShow] = useState(false)
  const [evaluation, setEvaluation] = useState<PasswordEvaluation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Advisory meter from core. The gate is `setPassword`, never this.
  useEffect(() => {
    if (!password) {
      setEvaluation(null)
      return
    }
    let cancelled = false
    ports.ceremony
      .evaluate(password, policy.password.minLength)
      .then((e) => {
        if (!cancelled) setEvaluation(e)
      })
      .catch(() => {
        if (!cancelled) setEvaluation(null)
      })
    return () => {
      cancelled = true
    }
  }, [password, policy.password.minLength, ports.ceremony])

  const matches = password.length > 0 && password === confirmation
  const mismatch = confirmation.length > 0 && password !== confirmation

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    let breach: BreachCheckProxy | null = null
    try {
      const bc = policy.password.breachCheck
      if (bc) {
        breach = await ports.ceremony.breach(password)
        await runBreachCheck(ports, breach, bc)
      }
      await ceremony.setPassword(password, confirmation, breach)
      session.current.password = password
      ctx.done('set_password')
    } catch (err) {
      if (err instanceof CeremonyError) {
        if (err.code === 'password_breached') {
          setError('This password appears in known data breaches. Choose a different one.')
        } else if (err.code === 'breach_check_blocked') {
          setError('We could not check this password against known breaches, and we do not let you continue without that check. Try again.')
        } else {
          setError(ceremonyMessage(err.code))
        }
      } else {
        setError('Something went wrong on this device. Try again.')
      }
    } finally {
      await breach?.dispose()
      setBusy(false)
    }
  }

  const hint = evaluation ? hintText(evaluation) : null

  return (
    <OnboardingFrame
      screen="step:set_password"
      title="Set a password"
      subtitle="It unlocks your vault on this device. Your recovery phrase stays the ultimate backup."
      position={screen.position}
      total={screen.total}
    >
      <form onSubmit={submit}>
        <BBInput
          label="Password"
          type={show ? 'text' : 'password'}
          placeholder={`At least ${policy.password.minLength} characters`}
          value={password}
          onChange={(e) => {
            setPassword(e.currentTarget.value)
            setError('')
          }}
          autoComplete="new-password"
          data-testid="onboarding-password"
          trailing={
            <button
              type="button"
              className="text-ink-3 hover:text-ink-2"
              onClick={() => setShow(!show)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              <Icon name={show ? 'eye-off' : 'eye'} size={16} />
            </button>
          }
          required
        />
        {evaluation && hint && (
          <div className="mt-2 mb-3" data-testid="password-strength">
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`flex-1 h-[3px] rounded-full ${i <= evaluation.level ? METER_CLASS[evaluation.level - 1] : 'bg-paper-3'}`}
                />
              ))}
            </div>
            <div className="flex items-baseline justify-between mt-1.5 gap-3">
              <p className={`text-xs ${hint.tone}`} data-testid="password-strength-message">{hint.text}</p>
              <p className="text-[11px] text-ink-4 font-mono shrink-0">
                {evaluation.length} / {evaluation.min_length}
              </p>
            </div>
          </div>
        )}
        <BBInput
          label="Confirm password"
          type={show ? 'text' : 'password'}
          placeholder="Type it again"
          value={confirmation}
          onChange={(e) => {
            setConfirmation(e.currentTarget.value)
            setError('')
          }}
          autoComplete="new-password"
          className="mt-3"
          data-testid="onboarding-password-confirm"
          required
        />
        <div className="mb-3.5 min-h-[16px] mt-1.5">
          {mismatch && <p className="text-xs text-red" data-testid="confirm-mismatch">Does not match yet.</p>}
          {matches && <p className="text-xs text-green" data-testid="confirm-match">Match.</p>}
        </div>
        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="flex items-center gap-3">
          <BBButton type="button" variant="ghost" onClick={() => ctx.undo('accept_terms')}>
            Back
          </BBButton>
          <BBButton
            type="submit"
            variant="amber"
            size="lg"
            className="flex-1"
            disabled={busy || !matches || !evaluation?.meets_minimum}
            data-testid="set-password-continue"
          >
            {busy ? 'Checking' : 'Continue'}
          </BBButton>
        </div>
      </form>
    </OnboardingFrame>
  )
}

// ── save_recovery_phrase (ceremony: save_phrase, then confirm_phrase) ────────

function SaveRecoveryPhraseStep({ ctx }: { ctx: CeremonyCtx }) {
  const { ceremony, screen, policy } = ctx
  const [phase, setPhase] = useState<'loading' | 'show' | 'confirm'>('loading')
  const [words, setWords] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [positions, setPositions] = useState<number[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        await ceremony.beginPhrase() // Argon2id, about a second
        setWords((await ceremony.phrase()).split(' '))
        setPhase('show')
      } catch (err) {
        setError(err instanceof CeremonyError ? ceremonyMessage(err.code) : 'Could not create your recovery phrase.')
        setPhase('show')
      }
    })()
    // Drop the words from React state when this step is left.
    return () => setWords([])
  }, [ceremony])

  async function acknowledge() {
    setBusy(true)
    setError('')
    try {
      await ceremony.acknowledgePhrase()
      const pos = await ceremony.challengePositions()
      setPositions(pos)
      setAnswers(pos.map(() => ''))
      setWords([]) // the confirm step needs no copy of the words; core compares
      setPhase('confirm')
    } catch (err) {
      setError(err instanceof CeremonyError ? ceremonyMessage(err.code) : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await ceremony.confirmPhrase(answers.map((a) => a.trim().toLowerCase()))
      ctx.done('save_recovery_phrase')
    } catch (err) {
      setError(err instanceof CeremonyError ? ceremonyMessage(err.code) : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function showAgain() {
    try {
      setWords((await ceremony.phrase()).split(' '))
      setPhase('show')
      setSaved(false)
    } catch {
      setError('The words are no longer available. Start over to get a new phrase.')
    }
  }

  if (phase === 'loading') {
    return (
      <OnboardingFrame screen="step:save_recovery_phrase" title="Your recovery phrase" position={screen.position} total={screen.total}>
        <Spinner label="Generating your recovery phrase" />
      </OnboardingFrame>
    )
  }

  if (phase === 'confirm') {
    return (
      <OnboardingFrame
        screen="step:save_recovery_phrase"
        title="Confirm your phrase"
        subtitle="Type the words you wrote down. This is how we know you can recover your account."
        position={screen.position}
        total={screen.total}
      >
        <form onSubmit={confirm} data-phase="confirm">
          <div className="flex flex-col gap-3 mb-3.5">
            {positions.map((pos, i) => (
              <BBInput
                key={pos}
                label={`Word ${pos}`}
                value={answers[i] ?? ''}
                onChange={(e) => {
                  const next = answers.slice()
                  next[i] = e.currentTarget.value
                  setAnswers(next)
                  setError('')
                }}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="font-mono"
                data-testid={`phrase-answer-${pos}`}
                required
              />
            ))}
          </div>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex items-center gap-3">
            <BBButton type="button" variant="ghost" onClick={showAgain}>
              Show the words again
            </BBButton>
            <BBButton type="submit" variant="amber" size="lg" className="flex-1" disabled={busy || answers.some((a) => !a.trim())}>
              Confirm
            </BBButton>
          </div>
        </form>
      </OnboardingFrame>
    )
  }

  return (
    <OnboardingFrame
      screen="step:save_recovery_phrase"
      title="Your recovery phrase"
      subtitle={`These ${policy.recoveryPhrase.wordCount} words are the only way to recover your account. Write them down or save them in a password manager. We can't recover this for you.`}
      position={screen.position}
      total={screen.total}
      wide
    >
      <div data-phase="show">
        {words.length > 0 && (
          <div className="bg-paper-2 border border-line rounded-lg p-4 mb-4 select-text" data-testid="phrase-words">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-2.5">
              {words.map((w, i) => (
                <div key={i} className="flex items-baseline gap-2 pb-1.5 border-b border-dashed border-line">
                  <span className="font-mono text-[11px] text-ink-4 w-5 select-none">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-mono text-sm font-medium text-ink" data-testid={`phrase-word-${i + 1}`}>{w}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="mb-3">
          <BBCheckbox checked={saved} onChange={setSaved} label="I have saved my recovery phrase offline." />
        </div>
        <BBButton
          variant="amber"
          size="lg"
          className="w-full"
          disabled={!saved || busy || words.length === 0}
          onClick={acknowledge}
          data-testid="phrase-saved"
        >
          I saved it, verify
          <Icon name="chevron-right" size={16} className="ml-1.5" />
        </BBButton>
      </div>
    </OnboardingFrame>
  )
}

// ── create_account ───────────────────────────────────────────────────────────

/**
 * The account exists on the server but finishing it on this device failed
 * (vault, refresh, network). Registering again would collide with it, so there
 * is deliberately no "Try again" and no "Start over" here: the way forward is to
 * sign in, which unlocks the vault from the password the person just chose.
 */
export function AccountCreatedSetupFailed({ position, total }: { position?: number; total?: number }) {
  return (
    <OnboardingFrame
      screen="account_created_setup_failed"
      title="Your account was created"
      subtitle="We could not finish setting it up on this device. Nothing is lost: your account, password and recovery phrase are all valid."
      position={position}
      total={total}
    >
      <p className="text-[13px] text-ink-2 leading-relaxed mb-4">
        Sign in with the email and password you just chose to finish. Do not sign up again with the same address.
      </p>
      <a
        href="/login"
        data-testid="account-created-sign-in"
        className="inline-flex w-full items-center justify-center rounded-lg bg-amber px-lg py-md text-base font-medium text-[oklch(0.22_0.01_70)] hover:brightness-95"
      >
        Sign in
        <Icon name="chevron-right" size={16} className="ml-1.5" />
      </a>
    </OnboardingFrame>
  )
}

function CreateAccountStep({ ctx }: { ctx: CeremonyCtx }) {
  const { ceremony, session, ports, doc, screen } = ctx
  const [status, setStatus] = useState('Setting up account encryption')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [accountExists, setAccountExists] = useState(false)
  const running = useRef(-1)

  useEffect(() => {
    if (running.current === attempt) return
    running.current = attempt
    ;(async () => {
      setError('')
      const outcome = await runCreateAccount({
        ceremony,
        ports,
        session: session.current,
        doc,
        onStatus: setStatus,
      })
      switch (outcome.kind) {
        case 'created':
          ctx.done('create_account')
          return
        case 'ticket_invalid':
          ctx.setNotice('Your email code expired before the account was created. Request a new one. Your password and recovery phrase are kept.')
          ctx.undo('verify_email_code')
          return
        case 'account_exists_setup_failed':
          // The account exists: no retry, no start over (either would collide with it).
          setAccountExists(true)
          return
        case 'failed_before_account':
          setError(
            outcome.rateLimited
              ? 'Too many sign-ups from this network. Try again later.'
              : 'We could not create your account. Nothing was stored. You can try again.',
          )
          return
      }
    })()
  }, [attempt, ceremony, ctx, doc, ports, session])

  if (accountExists) return <AccountCreatedSetupFailed position={screen.position} total={screen.total} />

  return (
    <OnboardingFrame screen="step:create_account" title="Creating your account" position={screen.position} total={screen.total}>
      {error ? (
        <>
          <ErrorLine>{error}</ErrorLine>
          <div className="flex gap-3">
            <BBButton variant="ghost" onClick={ctx.startOver}>Start over</BBButton>
            <BBButton variant="amber" className="flex-1" onClick={() => setAttempt((n) => n + 1)}>Try again</BBButton>
          </div>
        </>
      ) : (
        <div className="py-4" data-testid="create-account-progress">
          <Spinner label={status} />
        </div>
      )}
    </OnboardingFrame>
  )
}

// ── the flow ─────────────────────────────────────────────────────────────────

function renderStep(ctx: Ctx): ReactNode {
  const { ceremony } = ctx
  const withCeremony = (render: (c: CeremonyCtx) => ReactNode): ReactNode =>
    ceremony ? (
      render({ ...ctx, ceremony })
    ) : (
      <OnboardingFrame
        screen={`step:${ctx.screen.stepId}`}
        title="Preparing encryption"
        position={ctx.screen.position}
        total={ctx.screen.total}
      >
        <Spinner label="Loading the encryption module" />
      </OnboardingFrame>
    )
  switch (ctx.screen.stepId) {
    case 'enter_email':
      return <EnterEmailStep ctx={ctx} />
    case 'pilot_key':
      return <PilotKeyStep ctx={ctx} />
    case 'verify_email_code':
      return <VerifyEmailCodeStep ctx={ctx} />
    case 'accept_terms':
      return <AcceptTermsStep ctx={ctx} />
    case 'set_password':
      return withCeremony((c) => <SetPasswordStep ctx={c} />)
    case 'save_recovery_phrase':
      return withCeremony((c) => <SaveRecoveryPhraseStep ctx={c} />)
    case 'create_account':
      return withCeremony((c) => <CreateAccountStep ctx={c} />)
    default:
      return null
  }
}

/** Screens the planner can return that are not an interactive step. */
export function renderTerminalScreen(screen: Screen, onRefresh: () => void, onSignOut?: () => Promise<void>): ReactNode {
  switch (screen.kind) {
    case 'update_required':
      return <UpdateRequired screen={screen} onSignOut={onSignOut} />
    case 'unsupported_schema':
      return <UnsupportedSchema screen={screen} />
    case 'signup_unavailable':
      return <SignupUnavailable screen={screen} />
    case 'fallback':
      return <StepFallback screen={screen} />
    case 'blocked':
      return <StepBlocked screen={screen} onRefresh={onRefresh} />
    default:
      return null
  }
}

export function PreAccountFlow({
  doc,
  ports,
  initialCompleted,
}: {
  doc: OnboardingDocument
  ports: OnboardingPorts
  /** Tests and the fixture page only: start with these spec steps already done. */
  initialCompleted?: readonly string[]
}) {
  const policy = doc.policy
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set(initialCompleted ?? []))
  const [notice, setNotice] = useState('')
  const [ceremony, setCeremony] = useState<CeremonyProxy | null>(null)
  const [ceremonyFailed, setCeremonyFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const session = useRef<Session>(freshSession())

  const screen = useMemo(() => planScreen(doc, completed), [doc, completed])

  const needsEmailVerification = doc.steps.some((s) => s.id === 'verify_email_code' && s.required)
  const minLength = policy?.password.minLength ?? 12
  const verifyWordCount = policy?.recoveryPhrase.verifyWordCount ?? 3
  const breachRequired = !!policy?.password.breachCheck
  // The ceremony applies the value it was CONSTRUCTED with (a client cannot pick
  // it per call), so it must come from the document, not a constant.
  const breachFailOpen = policy?.password.breachCheck?.failOpen ?? true

  // One ceremony per attempt. Re-created only when the numbers it was built
  // from change or the person starts over; disposed (abandon + free) on leave.
  useEffect(() => {
    let cancelled = false
    let made: CeremonyProxy | null = null
    setCeremonyFailed(false)
    ports.ceremony
      .create({
        minLength,
        emailVerificationRequired: needsEmailVerification,
        verifyWordCount,
        breachCheckRequired: breachRequired,
        breachFailOpen,
      })
      .then((c) => {
        if (cancelled) {
          void c.dispose()
          return
        }
        made = c
        setCeremony(c)
      })
      .catch(() => {
        if (!cancelled) setCeremonyFailed(true)
      })
    return () => {
      cancelled = true
      setCeremony(null)
      if (made) void made.dispose()
    }
  }, [ports.ceremony, minLength, verifyWordCount, breachRequired, breachFailOpen, needsEmailVerification, generation])

  const done = useCallback((id: string) => setCompleted((prev) => new Set(prev).add(id)), [])
  const undo = useCallback(
    (...ids: string[]) =>
      setCompleted((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      }),
    [],
  )
  const startOver = useCallback(() => {
    session.current = freshSession()
    setCompleted(new Set())
    setNotice('')
    setGeneration((g) => g + 1)
  }, [])

  // Every pre-account step is done: the account exists, fetch the document again.
  const refreshed = useRef(false)
  useEffect(() => {
    if (screen.kind === 'created' && !refreshed.current) {
      refreshed.current = true
      void ports.actions.refresh()
    }
  }, [screen.kind, ports.actions])

  if (screen.kind === 'created') {
    return (
      <OnboardingFrame screen="created" title="Your account is ready">
        <Spinner label="Opening your vault" />
      </OnboardingFrame>
    )
  }
  if (screen.kind !== 'step') {
    return <>{renderTerminalScreen(screen, () => void ports.actions.refresh())}</>
  }
  if (!policy) return null

  if (ceremonyFailed) {
    return (
      <OnboardingFrame screen="ceremony_unavailable" title="Encryption did not load" subtitle="This page needs its encryption module to create an account. Reload and try again.">
        <BBButton variant="amber" className="w-full" onClick={() => window.location.reload()}>Reload</BBButton>
      </OnboardingFrame>
    )
  }

  const ctx: Ctx = { doc, policy, ports, ceremony, session, screen, done, undo, notice, setNotice, startOver }
  return <>{renderStep(ctx)}</>
}
