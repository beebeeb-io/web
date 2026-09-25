import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { BBCheckbox } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { MnemonicVerify } from '../components/mnemonic-verify'
import { SignupEmailCodeStep } from '../components/signup-email-code-step'
import {
  ApiError,
  opaqueRegisterStart,
  opaqueRegisterFinish,
} from '../lib/api'
import { initialOnboardingStep, signupTicketInvalidCopy } from '../lib/signup-email-code'
import { REFERRAL_SOURCE_KEY, REFERRAL_SHARER_KEY, REFERRAL_CODE_KEY } from './signup'
import { generateRecoveryKitPDF } from '../lib/recovery-kit-pdf'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import {
  generateRecoveryPhrase,
  opaqueRegistrationStart,
  opaqueRegistrationFinish,
  deriveX25519Public,
  computeRecoveryCheck,
  deriveFileKey,
  toBase64,
} from '../lib/crypto'
import { userFriendlyError } from '../lib/user-friendly-error'
import { encryptedUpload } from '../lib/encrypted-upload'

type Step = 'code' | 'display' | 'verify' | 'password' | 'processing'

// Task 1525: a code step now precedes the recovery-phrase display WHEN the
// server has the capability (`navState.emailCodeSupported`, decided by
// signup.tsx's email-start call). A legacy/stale server (404 on
// /signup/email-start) skips it entirely — step numbers below fall back to
// the exact pre-1525 4-step count so that path looks unchanged.
const STEP_NUMBER_WITH_CODE: Record<Step, number> = {
  code: 2,
  display: 3,
  verify: 4,
  password: 5,
  processing: 5,
}
const STEP_NUMBER_LEGACY: Record<Step, number> = {
  code: 2, // unreachable when emailCodeSupported is false
  display: 2,
  verify: 3,
  password: 4,
  processing: 4,
}
const TOTAL_STEPS_WITH_CODE = 5
const TOTAL_STEPS_LEGACY = 4

const BULLET_POINTS = [
  { icon: 'eye' as const, title: "We can't see it", desc: 'Encrypted on your device before upload.' },
  { icon: 'key' as const, title: "We can't reset it", desc: "Lost phrase = lost access. That's the deal." },
  { icon: 'shield' as const, title: "You're the only custodian", desc: 'No backdoors, no master keys, no exceptions.' },
]

type PasswordFeedback = {
  level: 1 | 2 | 3 | 4
  label: string
  meterColor: string
  message: string
  messageTone: 'red' | 'ink-3' | 'green'
  meetsMinimum: boolean
}

const MIN_PASSWORD_LENGTH = 12

function evaluatePassword(pw: string): PasswordFeedback {
  if (pw.length === 0) {
    return {
      level: 1,
      label: '',
      meterColor: 'bg-paper-3',
      message: '',
      messageTone: 'ink-3',
      meetsMinimum: false,
    }
  }

  const hasMixedCase = /[A-Z]/.test(pw) && /[a-z]/.test(pw)
  const hasNumOrSym = /\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)

  if (pw.length < MIN_PASSWORD_LENGTH) {
    const remaining = MIN_PASSWORD_LENGTH - pw.length
    return {
      level: 1,
      label: 'Too short',
      meterColor: 'bg-red',
      message: `Needs at least ${MIN_PASSWORD_LENGTH} characters — ${remaining} more to go.`,
      messageTone: 'red',
      meetsMinimum: false,
    }
  }

  // length >= MIN_PASSWORD_LENGTH
  let score = 2
  if (hasMixedCase) score++
  if (hasNumOrSym) score++

  if (score === 2) {
    return {
      level: 2,
      label: 'Fair',
      meterColor: 'bg-amber',
      message: 'Mix in upper- and lowercase plus a number or symbol to make it stronger.',
      messageTone: 'ink-3',
      meetsMinimum: true,
    }
  }
  if (score === 3) {
    return {
      level: 3,
      label: 'Good',
      meterColor: 'bg-green',
      message: !hasMixedCase
        ? 'Mix in upper- and lowercase to make it stronger.'
        : 'Add a number or symbol to make it stronger.',
      messageTone: 'ink-3',
      meetsMinimum: true,
    }
  }
  return {
    level: 4,
    label: 'Strong',
    meterColor: 'bg-green',
    message: 'Strong.',
    messageTone: 'green',
    meetsMinimum: true,
  }
}

export function Onboarding() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshUser } = useAuth()
  const { setMasterKey, cryptoReady, cryptoError } = useKeys()

  const navState = location.state as
    | { email?: string; pilotKey?: string; emailCodeSupported?: boolean }
    | null
  const email = navState?.email ?? ''
  // Pilot access key, collected on the signup page while Beebeeb is in private
  // development. Threaded onto the gated OPAQUE register-start request below.
  const pilotKey = navState?.pilotKey ?? ''
  // Task 1525: whether signup.tsx's email-start call succeeded (true) or
  // 404'd against a pre-1525 server (false, legacy fallback). Fixed for the
  // lifetime of this mount — signup.tsx decides it once, before navigating
  // here, so it never changes mid-flow.
  const emailCodeSupported = navState?.emailCodeSupported ?? false

  // Redirect to signup if no email in router state
  useEffect(() => {
    if (!email) {
      navigate('/signup', { replace: true })
    }
  }, [email, navigate])

  const [step, setStep] = useState<Step>(initialOnboardingStep(navState))
  // The signup_ticket from a completed /signup/email-verify (task 1525).
  // Null until the code step succeeds; stays null for the legacy fallback,
  // where the server ignores signup_ticket entirely. Threaded into
  // register-start/finish below.
  const [ticket, setTicket] = useState<string | null>(null)
  // Set only when register-start/finish rejects the ticket as invalid
  // (expired mid-flow, wrong email, already consumed) — shown once the user
  // is bounced back to the code step.
  const [codeStepError, setCodeStepError] = useState('')
  // Task 1525 Codex review fix: true only when the invalid-ticket error came
  // from register-FINISH specifically — the ambiguous case where the
  // account may already have been created (see signupTicketInvalidCopy()'s
  // doc comment). register-START never consumes the ticket, so an invalid
  // ticket there is unambiguous and this stays false.
  const [mayAlreadyHaveAccount, setMayAlreadyHaveAccount] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [masterKeyBytes, setMasterKeyBytes] = useState<Uint8Array | null>(null)
  const [saved, setSaved] = useState(false)

  // Password step
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Processing step
  const [error, setError] = useState('')
  const [processingStatus, setProcessingStatus] = useState('')

  const strength = evaluatePassword(password)
  const passwordsMatch =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const messageToneClass: Record<PasswordFeedback['messageTone'], string> = {
    red: 'text-red',
    'ink-3': 'text-ink-3',
    green: 'text-green',
  }

  // Generate mnemonic on mount — but only once the email is actually
  // VERIFIED. Task 1525: before this, the phrase was generated the instant
  // /onboarding mounted, so a phantom signup (an existing user who "signed
  // up" again) was shown a recovery phrase that never got stored anywhere —
  // locked out, no explanation. When the server has the code capability,
  // wait for a valid `ticket` (proof the email-verify succeeded) before
  // generating anything. The legacy fallback (emailCodeSupported === false)
  // has no ticket to wait for and keeps the original immediate-generation
  // behavior unchanged.
  const generated = useRef(false)
  useEffect(() => {
    if (!email || generated.current) return
    if (!cryptoReady) return
    if (emailCodeSupported && !ticket) return
    generated.current = true
    generateRecoveryPhrase().then(({ phrase: p, masterKey: mk }) => {
      setPhrase(p)
      setMasterKeyBytes(mk)
    })
  }, [email, cryptoReady, emailCodeSupported, ticket])

  const words = phrase.split(' ').filter(Boolean)

  const handleCodeVerified = useCallback((newTicket: string) => {
    setTicket(newTicket)
    setCodeStepError('')
    setMayAlreadyHaveAccount(false)
    setStep('display')
  }, [])

  const handleWrongEmail = useCallback(() => {
    navigate('/signup', { replace: true, state: { email } })
  }, [navigate, email])

  // Task 1525 Codex review fix: the "Already finished setting up this
  // account? Sign in instead" path offered only when mayAlreadyHaveAccount
  // is set (a register-finish signup_ticket_invalid — see above). Same
  // `?email=` prefill query param login.tsx already reads.
  const handleSignInInstead = useCallback(() => {
    navigate(`/login?email=${encodeURIComponent(email)}`, { replace: true })
  }, [navigate, email])

  const handlePasswordSubmit = useCallback(async () => {
    if (!masterKeyBytes || !email) return

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (!cryptoReady) {
      setError(cryptoError ?? 'Encryption module is not loaded yet. Please wait.')
      return
    }

    setStep('processing')
    setError('')

    // Task 1525 Codex review fix (see signupTicketInvalidCopy()'s doc
    // comment): register-START only VALIDATES the ticket (never consumes
    // it), so a signup_ticket_invalid there is unambiguous. register-FINISH
    // consumes it atomically with the account INSERT — if ITS response is
    // lost and the shared request() client's single network-failure retry
    // resubmits with the now-dead ticket, the same error code comes back
    // even though the account was actually created. Set right before the
    // finish call (never reset after) so the catch block below can tell
    // which of the two calls actually threw.
    let ticketInvalidCouldMeanFinishSucceeded = false

    try {
      // 1. OPAQUE registration (2-round-trip)
      setProcessingStatus('Setting up account encryption...')
      const regStart = await opaqueRegistrationStart(password)
      const serverResp = await opaqueRegisterStart(
        email,
        toBase64(regStart.message),
        pilotKey,
        ticket ?? undefined,
      )
      const serverMsg = Uint8Array.from(atob(serverResp.server_message), c => c.charCodeAt(0))
      const regUpload = await opaqueRegistrationFinish(regStart.state, password, serverMsg)

      // 2. Derive X25519 public key and recovery check from mnemonic master key
      setProcessingStatus('Generating encryption keys...')
      const x25519Pub = await deriveX25519Public(masterKeyBytes)
      const recoveryCheck = await computeRecoveryCheck(masterKeyBytes)

      // 3. Finish registration on server (includes public key + recovery check)
      setProcessingStatus('Registering with server...')
      const referralSource = localStorage.getItem(REFERRAL_SOURCE_KEY) ?? undefined
      const referralSharerId = localStorage.getItem(REFERRAL_SHARER_KEY) ?? undefined
      const referralCode = localStorage.getItem(REFERRAL_CODE_KEY) ?? undefined
      ticketInvalidCouldMeanFinishSucceeded = true
      await opaqueRegisterFinish(
        email,
        toBase64(regUpload),
        toBase64(x25519Pub),
        toBase64(recoveryCheck),
        referralSource,
        referralSharerId,
        referralCode,
        pilotKey,
        ticket ?? undefined,
      )
      // Clear referral attribution after it has been sent
      localStorage.removeItem(REFERRAL_SOURCE_KEY)
      localStorage.removeItem(REFERRAL_SHARER_KEY)
      localStorage.removeItem(REFERRAL_CODE_KEY)

      // 4. Wrap master key with password, store in IndexedDB, set in memory
      setProcessingStatus('Securing your vault...')
      await setMasterKey(masterKeyBytes, password)

      // 5. Upload a welcome file so new users land on a non-empty drive
      setProcessingStatus('Setting up your vault...')
      try {
        const welcomeContent = [
          '# Welcome to Beebeeb',
          '',
          'Your files are now protected by end-to-end encryption.',
          'The decryption key lives on this device — we never see it.',
          '',
          '## Try it',
          '- Drag a file here to upload (it\'s encrypted before leaving your browser)',
          '- Click "Share" to create a link (the key is in the URL fragment)',
          '- Open the link in an incognito tab — watch it decrypt in the browser',
          '',
          '## Need help?',
          '- Support: support@beebeeb.io',
          '',
          'You can delete this file anytime.',
        ].join('\n')
        const welcomeFile = new File(
          [new TextEncoder().encode(welcomeContent)],
          'Welcome to Beebeeb.md',
          { type: 'text/markdown' },
        )
        const fileId = crypto.randomUUID()
        const fileKey = await deriveFileKey(masterKeyBytes, fileId)
        await encryptedUpload(
          welcomeFile,
          fileId,
          fileKey,
          masterKeyBytes,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          (serverFileId) => deriveFileKey(masterKeyBytes, serverFileId),
        )
      } catch {
        // Welcome file is a nice-to-have — never block account creation on failure
      }

      // 6. Refresh user state and navigate to drive
      setProcessingStatus('Almost there...')
      await refreshUser()
      navigate('/', { replace: true })
    } catch (err) {
      // Pilot gate (private development): register-start rejects a missing/wrong
      // key with a typed 403. The key field lives on /signup, so bounce back
      // there with the server's message to render inline next to that field —
      // rather than a generic onboarding error the user can't act on here.
      if (err instanceof ApiError && err.status === 403 && err.code === 'pilot_key_required') {
        navigate('/signup', {
          replace: true,
          state: { email, pilotKey, pilotKeyError: err.message },
        })
        return
      }
      // Task 1525: the signup_ticket expired, was already consumed, or never
      // matched this email (BB_SIGNUP_EMAIL_CODE=1 only). Unlike the pilot
      // gate above, this does NOT bounce all the way to /signup — the email
      // itself was fine, only the verification lapsed. Send the user back to
      // the code step (still on /onboarding) to request a fresh one; the
      // stale ticket and any generated phrase are discarded so a fresh
      // ticket generates a fresh phrase (never register with the OLD one).
      //
      // Codex review (PR #79): a register-FINISH invalid-ticket is
      // AMBIGUOUS — see signupTicketInvalidCopy()'s doc comment — so that
      // case additionally offers a "sign in instead" path rather than only
      // "request a new code" (which is a dead end if the account already
      // exists: /email-start for an existing email sends a sign-in link,
      // never a code).
      if (err instanceof ApiError && err.status === 403 && err.code === 'signup_ticket_invalid') {
        const { codeStepError, offerSignIn } = signupTicketInvalidCopy(
          ticketInvalidCouldMeanFinishSucceeded ? 'register-finish' : 'register-start',
        )
        setTicket(null)
        setPhrase('')
        setMasterKeyBytes(null)
        generated.current = false
        setCodeStepError(codeStepError)
        setMayAlreadyHaveAccount(offerSignIn)
        setStep('code')
        return
      }
      setError(userFriendlyError(err))
      setStep('password')
    }
  }, [masterKeyBytes, email, pilotKey, ticket, password, confirmPassword, cryptoReady, cryptoError, setMasterKey, refreshUser, navigate])

  if (!email) return null

  const stepNumber = emailCodeSupported ? STEP_NUMBER_WITH_CODE[step] : STEP_NUMBER_LEGACY[step]
  const totalSteps = emailCodeSupported ? TOTAL_STEPS_WITH_CODE : TOTAL_STEPS_LEGACY

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4 py-6 sm:p-xl">
      <div className="w-full max-w-[820px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4 sm:px-xl sm:py-lg border-b border-line">
          <BBLogo size={15} />
          <div className="ml-auto flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`w-7 h-[3px] rounded-full ${
                  i < stepNumber ? 'bg-ink' : 'bg-paper-3'
                }`}
              />
            ))}
            <span className="ml-2 text-xs font-medium text-ink-2">
              {stepNumber} / {totalSteps}
            </span>
          </div>
        </div>

        {/* Processing step — full width */}
        {step === 'processing' ? (
          <div className="p-8 flex flex-col items-center justify-center min-h-[320px]">
            <div className="w-8 h-8 border-2 border-amber border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium text-ink mb-1">Creating your account</p>
            <p className="text-xs text-ink-3">{processingStatus}</p>
            {error && (
              <p className="text-xs text-red mt-3">{error}</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
            {/* Left panel */}
            <div className="p-5 sm:p-8 md:border-r border-line">
              {step === 'code' && (
                <SignupEmailCodeStep
                  email={email}
                  onVerified={handleCodeVerified}
                  onWrongEmail={handleWrongEmail}
                  externalError={codeStepError}
                  offerSignInFallback={mayAlreadyHaveAccount}
                  onSignInInstead={handleSignInInstead}
                />
              )}

              {step === 'display' && (
                <>
                  <p className="text-xs font-medium text-ink-2 mb-2.5">
                    Recovery phrase &middot; {words.length} words
                  </p>
                  <h1 className="text-xl font-semibold text-ink mb-1.5">
                    Your master key, in words.
                  </h1>
                  <p className="text-sm text-ink-3 leading-relaxed mb-5">
                    These {words.length} words are the only way to recover your account.
                    Write them down or save to a password manager.
                  </p>

                  {words.length > 0 ? (
                    <>
                      <div className="bg-paper-2 border border-line rounded-lg p-4.5 mb-4 select-text">
                        <div className="grid grid-cols-2 sm:grid-cols-2 gap-x-4 sm:gap-x-7 gap-y-2.5">
                          {words.map((word, i) => (
                            <div key={i} className="flex items-baseline gap-2.5 pb-2 border-b border-dashed border-line">
                              <span className="font-mono text-[11px] text-ink-4 w-4.5 select-none">{String(i + 1).padStart(2, '0')}</span>
                              <span className="font-mono text-sm font-medium text-ink cursor-text">{word}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <BBButton size="sm" onClick={async () => {
                          await navigator.clipboard.writeText(phrase)
                          // Auto-clear clipboard after 60s to limit exposure of the recovery phrase
                          setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}) }, 60000)
                        }}>
                          <Icon name="copy" size={14} className="mr-1.5" /> Copy
                        </BBButton>
                        <BBButton size="sm" onClick={() => {
                          const blob = new Blob(
                            [words.map((w, i) => `${String(i + 1).padStart(2, '0')}  ${w}`).join('\n')],
                            { type: 'text/plain' },
                          )
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = 'beebeeb-recovery-phrase.txt'
                          a.click()
                          URL.revokeObjectURL(url)
                        }}>
                          <Icon name="download" size={14} className="mr-1.5" /> Download .txt
                        </BBButton>
                        <BBButton
                          size="sm"
                          variant="amber"
                          onClick={() => generateRecoveryKitPDF(phrase, email)}
                          title="Opens a print-ready page — choose 'Save as PDF' in the print dialog"
                        >
                          <Icon name="file-text" size={14} className="mr-1.5" /> Recovery Kit PDF
                        </BBButton>
                      </div>

                      {/* Mobile-only continue CTA. On md+ the same CTA appears
                          in the right panel (along with the "I've saved it"
                          checkbox); on mobile that panel sits below the phrase
                          and is easy to miss, so we surface a duplicate here
                          to spare the user from scrolling past the rationale.
                          The disabled state mirrors the canonical CTA. */}
                      <div className="md:hidden mt-5">
                        <div className="mb-3">
                          <BBCheckbox
                            checked={saved}
                            onChange={setSaved}
                            label="I've saved my recovery phrase offline."
                          />
                        </div>
                        <BBButton
                          variant="amber"
                          size="lg"
                          className="w-full"
                          disabled={!saved}
                          onClick={() => setStep('verify')}
                        >
                          I saved it — verify
                          <Icon name="chevron-right" size={16} className="ml-1.5" />
                        </BBButton>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-ink-3">
                      <div className="w-4 h-4 border-2 border-ink-3 border-t-transparent rounded-full animate-spin" />
                      Generating recovery phrase...
                    </div>
                  )}
                </>
              )}

              {step === 'verify' && (
                <MnemonicVerify
                  phrase={phrase}
                  onVerified={() => setStep('password')}
                  onBack={() => setStep('display')}
                />
              )}

              {step === 'password' && (
                <>
                  <p className="text-xs font-medium text-ink-2 mb-2.5">Device password</p>
                  <h1 className="text-xl font-semibold text-ink mb-1.5">
                    Set a password for quick access
                  </h1>
                  <p className="text-sm text-ink-3 leading-relaxed mb-5">
                    This password unlocks your vault on this device.
                    Your recovery phrase remains the ultimate backup.
                  </p>

                  <div className="mb-1.5">
                    <BBInput
                      label="Password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="At least 12 characters"
                      value={password}
                      onChange={(e) => { setPassword(e.currentTarget.value); setError('') }}
                      trailing={
                        <button
                          type="button"
                          className="text-ink-3 hover:text-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-deep rounded"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          <Icon
                            name={showPassword ? 'eye-off' : 'eye'}
                            size={16}
                          />
                        </button>
                      }
                      required
                    />
                  </div>

                  {/* Strength meter + live feedback */}
                  {password.length > 0 && (
                    <div className="mb-3.5" data-testid="password-strength">
                      <div className="flex gap-1 mt-2">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`flex-1 h-[3px] rounded-full ${
                              i <= strength.level ? strength.meterColor : 'bg-paper-3'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="flex items-baseline justify-between mt-1.5 gap-3">
                        <p
                          className={`text-xs ${messageToneClass[strength.messageTone]}`}
                          data-testid="password-strength-message"
                        >
                          {strength.message}
                        </p>
                        <p className="text-[11px] text-ink-4 font-mono shrink-0">
                          {password.length} / {MIN_PASSWORD_LENGTH}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="mb-1.5">
                    <BBInput
                      label="Confirm password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Type it again"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.currentTarget.value); setError('') }}
                      trailing={
                        <button
                          type="button"
                          className="text-ink-3 hover:text-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-deep rounded"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                        >
                          <Icon
                            name={showConfirmPassword ? 'eye-off' : 'eye'}
                            size={16}
                          />
                        </button>
                      }
                      required
                    />
                  </div>

                  {/* Live confirm-match feedback */}
                  <div className="mb-3.5 min-h-[16px]">
                    {passwordsMismatch && (
                      <p
                        className="text-xs text-red"
                        data-testid="confirm-mismatch"
                      >
                        Doesn&apos;t match yet.
                      </p>
                    )}
                    {passwordsMatch && strength.meetsMinimum && (
                      <p
                        className="text-xs text-green"
                        data-testid="confirm-match"
                      >
                        Match.
                      </p>
                    )}
                  </div>

                  {error && (
                    <p className="text-xs text-red mb-3">{error}</p>
                  )}

                  <div className="flex items-center gap-3">
                    <BBButton variant="ghost" onClick={() => setStep('verify')}>
                      Back
                    </BBButton>
                    <BBButton
                      variant="amber"
                      size="lg"
                      className="flex-1"
                      disabled={!strength.meetsMinimum || !passwordsMatch}
                      onClick={handlePasswordSubmit}
                    >
                      Create account
                    </BBButton>
                  </div>
                </>
              )}
            </div>

            {/* Right panel — context */}
            <div className="p-5 sm:p-8 bg-paper-2 flex flex-col border-t md:border-t-0 border-line">
              <p className="text-xs font-medium text-ink-2 mb-2.5">Why this matters</p>
              <h2 className="text-base font-semibold text-ink mb-5">
                True zero-knowledge means we can't reach in — and neither can anyone else.
              </h2>
              <div className="flex flex-col gap-3.5 mb-6">
                {BULLET_POINTS.map(({ icon, title, desc }, i) => (
                  <div key={i} className="flex gap-2.5">
                    <div className="mt-0.5 w-[22px] h-[22px] shrink-0 bg-amber-bg rounded-full flex items-center justify-center text-amber-deep">
                      <Icon name={icon} size={12} />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{title}</p>
                      <p className="text-xs text-ink-3 mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-auto">
                {step === 'code' && (
                  <p className="text-sm text-ink-3 leading-relaxed">
                    We check your email before anything is created — so a
                    mistyped address never leaves you holding a recovery
                    phrase and password for an account that doesn't exist.
                  </p>
                )}
                {step === 'display' && (
                  <>
                    <div className="mb-4">
                      <BBCheckbox
                        checked={saved}
                        onChange={setSaved}
                        label="I've saved my recovery phrase offline."
                      />
                    </div>
                    <BBButton
                      variant="amber"
                      size="lg"
                      className="w-full"
                      disabled={!saved || words.length === 0}
                      onClick={() => setStep('verify')}
                    >
                      I saved it — verify
                      <Icon name="chevron-right" size={16} className="ml-1.5" />
                    </BBButton>
                  </>
                )}
                {step === 'verify' && (
                  <p className="text-sm text-ink-3 leading-relaxed">
                    Type the requested words to confirm you have your recovery phrase.
                    This is the only time we'll show it.
                  </p>
                )}
                {step === 'password' && (
                  <p className="text-sm text-ink-3 leading-relaxed">
                    Your password wraps the master key on this device.
                    On a new device, you'll use either your password or recovery phrase to unlock.
                  </p>
                )}
                <p className="text-center mt-2.5 text-[11px] text-ink-4">
                  Stored in Falkenstein, Germany. Under EU jurisdiction.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
