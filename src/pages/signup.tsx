import { type FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '@beebeeb/shared'
import { BBCheckbox } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { shouldShowPilotKeyField, buildOnboardingState, pilotKeyBlocksSubmit } from '../lib/signup-pilot-gate'
import { signupEmailStart } from '../lib/api'
import { isLegacyFallbackError } from '../lib/signup-email-code'
import { userFriendlyError } from '../lib/user-friendly-error'

// Referral keys — read here, forwarded to onboarding, cleared after signup
export const REFERRAL_SOURCE_KEY = 'bb_ref_source'
export const REFERRAL_SHARER_KEY = 'bb_ref_sharer'
export const REFERRAL_CODE_KEY   = 'bb_ref_code'

export function Signup() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // When onboarding's gated register-start is rejected (403 pilot_key_required),
  // it bounces back here with the email + entered key + the server's message so
  // we can re-render the form with the error inline next to the key field.
  const navState = location.state as
    | { email?: string; pilotKey?: string; pilotKeyError?: string }
    | null

  const [email, setEmail] = useState(navState?.email ?? '')
  const [pilotKey, setPilotKey] = useState(navState?.pilotKey ?? '')
  const [pilotKeyError, setPilotKeyError] = useState(navState?.pilotKeyError ?? '')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  // Task 1525: Continue now makes a real network call (signup/email-start)
  // before navigating — disable the button and show a busy label for that
  // round trip rather than letting a double-click fire it twice.
  const [submitting, setSubmitting] = useState(false)

  // Task 1520: the server's pilot gate is OFF by default (launched, phase 2 —
  // BB_REQUIRE_PILOT_KEY=0 on both prod nodes). See src/lib/signup-pilot-gate.ts
  // for the full rationale — the field only reappears after a real server
  // refusal bounces us back here.
  const showPilotKeyField = shouldShowPilotKeyField(navState)

  // Persist referral attribution from URL params into localStorage so it
  // survives the multi-step onboarding flow.
  // Handles two sources:
  //   ?ref=share&sharer=<id>    — from the share-view acquisition CTA
  //   ?ref=referral&code=<code> — from the /r/<code> referral landing page
  useEffect(() => {
    const ref = searchParams.get('ref')
    const sharer = searchParams.get('sharer')
    const code = searchParams.get('code')
    if (ref) localStorage.setItem(REFERRAL_SOURCE_KEY, ref)
    if (sharer) localStorage.setItem(REFERRAL_SHARER_KEY, sharer)
    if (code) localStorage.setItem(REFERRAL_CODE_KEY, code)
  }, [searchParams])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setPilotKeyError('')

    const trimmedEmail = email.trim()

    if (!trimmedEmail) {
      setError('Email is required.')
      return
    }

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Please enter a valid email address.')
      return
    }

    if (pilotKeyBlocksSubmit({ showPilotKeyField, pilotKey })) {
      setPilotKeyError('A pilot access key is required to sign up.')
      return
    }

    // Task 1525: verify the email with a code BEFORE any account exists.
    // Continue now calls /signup/email-start itself, THEN navigates — so a
    // rate-limit or other real server refusal shows up right here, on the
    // form the user is looking at, instead of after a silent jump to
    // /onboarding. The key (if any) is re-checked server-side at
    // register-start (during onboarding). buildOnboardingState carries it
    // forward only when one was entered — most signups have none, and
    // opaqueRegisterStart/Finish only send the X-Beebeeb-Pilot-Key header
    // when a key is present.
    setSubmitting(true)
    try {
      await signupEmailStart(trimmedEmail)
      navigate('/onboarding', {
        state: { ...buildOnboardingState(trimmedEmail, pilotKey), emailCodeSupported: true },
      })
    } catch (err) {
      if (isLegacyFallbackError(err)) {
        // Server predates task 1525 (no /signup/email-start route at all —
        // a rolling deploy still mid-rollout, or a rollback). Fall back to
        // the pre-1525 flow exactly as it worked before: no code screen, go
        // straight to the recovery phrase.
        navigate('/onboarding', {
          state: { ...buildOnboardingState(trimmedEmail, pilotKey), emailCodeSupported: false },
        })
        return
      }
      // Real refusal (429 rate-limited, 400 malformed address the server
      // disagrees with, network failure) — stay on this page and say so.
      setError(userFriendlyError(err))
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Encrypted end-to-end before it leaves your device. We can't read any of it."
      step={1}
      totalSteps={4}
      hideTrust
    >
      <form onSubmit={handleSubmit}>
        {/* Pilot-gate notice — only shown when a real server refusal bounced
            us back here (see showPilotKeyField above). Signups are open by
            default; this never renders on a fresh visit to /signup. */}
        {showPilotKeyField && (
          <div className="mb-4 rounded-lg border border-line bg-paper-2 px-3.5 py-3">
            <p className="text-[13px] font-semibold text-ink mb-0.5">
              Pilot access key required
            </p>
            <p className="text-xs text-ink-3 leading-relaxed">
              Signups currently require a pilot access key. Contact the team if you're a pilot.
            </p>
          </div>
        )}

        <BBInput
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          icon="mail"
          className="mb-3.5"
          required
        />

        {showPilotKeyField && (
          <BBInput
            label="Pilot access key"
            type="text"
            placeholder="Enter your access key"
            value={pilotKey}
            onChange={(e) => { setPilotKey(e.currentTarget.value); setPilotKeyError('') }}
            icon="key"
            className="mb-3.5"
            autoComplete="off"
            error={pilotKeyError || undefined}
            data-testid="pilot-key-input"
            required
          />
        )}

        <div className="mt-2.5">
          <BBCheckbox
            checked={accepted}
            onChange={setAccepted}
            label="I understand that Beebeeb cannot recover my account if I lose both my password and recovery phrase. We can't recover this."
          />
        </div>

        <p className="text-[11px] text-ink-3 mt-2 mb-3.5">
          By creating an account, you agree to our{' '}
          <a href="https://beebeeb.io/terms" target="_blank" rel="noopener noreferrer" className="text-amber-deep hover:underline">Terms of Service</a>
          {' '}and{' '}
          <a href="https://beebeeb.io/privacy" target="_blank" rel="noopener noreferrer" className="text-amber-deep hover:underline">Privacy Policy</a>.
          Your data is processed by Initlabs B.V. under GDPR.
        </p>

        {error && (
          <p className="text-xs text-red mb-3">{error}</p>
        )}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full"
          disabled={
            submitting ||
            !accepted ||
            !email.trim() ||
            pilotKeyBlocksSubmit({ showPilotKeyField, pilotKey })
          }
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
              Sending code...
            </span>
          ) : (
            'Continue'
          )}
        </BBButton>

        <p className="text-xs text-ink-3 text-center mt-4">
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-amber-deep font-medium hover:underline"
          >
            Log in
          </Link>
        </p>

        {/* Footer */}
        <div className="border-t border-line mt-[18px] pt-3.5 flex items-center gap-2 text-[11px] text-ink-3">
          <Icon name="shield" size={14} className="text-amber-deep shrink-0" />
          <span>End-to-end encrypted · EU servers · Zero-knowledge</span>
        </div>
      </form>
    </AuthShell>
  )
}
