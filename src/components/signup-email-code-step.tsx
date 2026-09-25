import { useCallback, useEffect, useRef, useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { signupEmailStart, signupEmailVerify } from '../lib/api'
import { EMAIL_CODE_LENGTH, sanitizeCode, codeDigitsForDisplay } from '../lib/signup-email-code'
import { userFriendlyError } from '../lib/user-friendly-error'

interface SignupEmailCodeStepProps {
  email: string
  /** Called with the signup_ticket once the code is confirmed valid. */
  onVerified: (ticket: string) => void
  /** "Wrong email? Go back" — the user mistyped their address. */
  onWrongEmail: () => void
  /**
   * Set once, from onboarding.tsx, when a previously-valid ticket was
   * rejected on register-start/finish (`signup_ticket_invalid` — the ticket
   * expired mid-flow). Shown as the initial error so the user knows why
   * they're back here, same pattern as TwoFactorPrompt's `error` prop.
   */
  externalError?: string
}

/**
 * Task 1525 — the "check your inbox" step. IDENTICAL copy whether `email`
 * already has an account or not (the server's own anti-enumeration
 * invariant: `POST /signup/email-start` always returns the same 202). A
 * user with an existing account receives a sign-in link instead of a code
 * and simply can never produce a valid one here — that's the enforcement
 * mechanism, not a client-side branch.
 *
 * Code entry mirrors `two-factor-prompt.tsx`'s hidden-input + visual-digit-
 * box pattern (paste-friendly, autocomplete="one-time-code", mono digits),
 * widened from 6 to `EMAIL_CODE_LENGTH` (8) digits.
 */
export function SignupEmailCodeStep({
  email,
  onVerified,
  onWrongEmail,
  externalError,
}: SignupEmailCodeStepProps) {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(externalError ?? '')
  const [resending, setResending] = useState(false)
  const [resendNotice, setResendNotice] = useState('')
  const hiddenRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)

  useEffect(() => {
    hiddenRef.current?.focus()
  }, [])

  const doVerify = useCallback(
    async (candidate: string) => {
      setSubmitting(true)
      setError('')
      try {
        const { signup_ticket } = await signupEmailVerify(email, candidate)
        onVerified(signup_ticket)
      } catch (err) {
        // Deliberately undifferentiated by the server (wrong / expired /
        // reused / attempt-capped all render the same "invalid or expired
        // code" — no signal about which). Surface it as-is; it's already
        // honest and actionable.
        setError(userFriendlyError(err))
        setCode('')
        submittedRef.current = false
        hiddenRef.current?.focus()
      } finally {
        setSubmitting(false)
      }
    },
    [email, onVerified],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = sanitizeCode(e.target.value)
      setCode(digits)
      setError('')
      submittedRef.current = false
      if (digits.length === EMAIL_CODE_LENGTH) {
        submittedRef.current = true
        void doVerify(digits)
      }
    },
    [doVerify],
  )

  async function handleResend() {
    setResending(true)
    setResendNotice('')
    setError('')
    try {
      await signupEmailStart(email)
      setResendNotice('Code resent — check your inbox.')
      setCode('')
      submittedRef.current = false
      hiddenRef.current?.focus()
    } catch (err) {
      // Rate-limit (429) and every other failure land here with the same
      // honest, already-formatted message from the shared request() client
      // (e.g. "Rate limited — try again in 58 minutes") — never a generic
      // "something went wrong" that hides a real wait time.
      setError(userFriendlyError(err))
    } finally {
      setResending(false)
    }
  }

  const digits = codeDigitsForDisplay(code)

  return (
    <>
      <p className="text-xs font-medium text-ink-2 mb-2.5">Verify your email</p>
      <h1 className="text-xl font-semibold text-ink mb-1.5">Check your inbox</h1>
      <p className="text-sm text-ink-3 leading-relaxed mb-5" data-testid="signup-code-copy">
        If <span className="font-medium text-ink" data-testid="signup-code-email">{email}</span> can sign
        up, we've sent it a verification code. Enter the {EMAIL_CODE_LENGTH} digits below to continue.
      </p>

      <div className="relative">
        <input
          ref={hiddenRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          name="signup-email-code"
          id="signup-email-code"
          value={code}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && code.length === EMAIL_CODE_LENGTH) void doVerify(code)
          }}
          maxLength={EMAIL_CODE_LENGTH}
          disabled={submitting}
          className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-text"
          aria-label="Verification code"
          data-testid="signup-code-input"
        />

        {/* Visual digit boxes — decorative, the real input is the hidden field above */}
        <div className="flex gap-1.5 flex-wrap justify-center mb-3.5" aria-hidden="true">
          {digits.map((d, i) => (
            <div
              key={i}
              className={`w-9 h-11 flex items-center justify-center font-mono text-lg font-semibold border rounded-md bg-paper transition-all select-none ${
                d.trim()
                  ? 'border-line-2 text-ink'
                  : i === code.length
                    ? 'border-amber-deep ring-2 ring-amber/30 text-ink-4'
                    : 'border-line text-ink-4'
              }`}
            >
              {d.trim() || ''}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red mb-3 text-center" data-testid="signup-code-error">
          {error}
        </p>
      )}

      {submitting && <p className="text-xs text-ink-3 text-center mb-3">Verifying...</p>}

      {resendNotice && !error && (
        <p className="text-xs text-green text-center mb-3">{resendNotice}</p>
      )}

      <BBButton
        variant="amber"
        size="lg"
        className="w-full"
        disabled={submitting || code.length !== EMAIL_CODE_LENGTH}
        onClick={() => void doVerify(code)}
      >
        Verify
      </BBButton>

      <div className="flex items-center justify-between mt-4">
        <button
          type="button"
          className="text-xs text-ink-3 hover:text-ink cursor-pointer transition-colors"
          onClick={onWrongEmail}
        >
          Wrong email? Go back
        </button>
        <button
          type="button"
          className="text-xs text-amber-deep font-medium hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => void handleResend()}
          disabled={resending}
        >
          {resending ? 'Resending...' : 'Resend code'}
        </button>
      </div>
    </>
  )
}
