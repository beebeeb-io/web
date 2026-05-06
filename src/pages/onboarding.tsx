import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { BBCheckbox } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { MnemonicVerify } from '../components/mnemonic-verify'
import { Turnstile, type TurnstileHandle } from '../components/turnstile'
import {
  opaqueRegisterStart,
  opaqueRegisterFinish,
  ApiError,
} from '../lib/api'
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
import { encryptedUpload } from '../lib/encrypted-upload'

type Step = 'display' | 'verify' | 'password' | 'processing'

const STEP_NUMBER: Record<Step, number> = {
  display: 2,
  verify: 3,
  password: 4,
  processing: 4,
}

const TOTAL_STEPS = 4

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

  const email = (location.state as { email?: string } | null)?.email ?? ''

  // Redirect to signup if no email in router state
  useEffect(() => {
    if (!email) {
      navigate('/signup', { replace: true })
    }
  }, [email, navigate])

  const [step, setStep] = useState<Step>('display')
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

  // Turnstile ref — exposes getToken() + reset()
  const turnstileRef = useRef<TurnstileHandle>(null)

  const strength = evaluatePassword(password)
  const passwordsMatch =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const messageToneClass: Record<PasswordFeedback['messageTone'], string> = {
    red: 'text-red',
    'ink-3': 'text-ink-3',
    green: 'text-green',
  }

  // Generate mnemonic on mount
  const generated = useRef(false)
  useEffect(() => {
    if (!email || generated.current) return
    if (!cryptoReady) return
    generated.current = true
    generateRecoveryPhrase().then(({ phrase: p, masterKey: mk }) => {
      setPhrase(p)
      setMasterKeyBytes(mk)
    })
  }, [email, cryptoReady])

  const words = phrase.split(' ').filter(Boolean)

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

    try {
      // 1. OPAQUE registration (2-round-trip)
      // Grab the Turnstile token (null in dev mode / if widget hasn't fired yet)
      const cfToken = turnstileRef.current?.getToken() ?? null
      setProcessingStatus('Setting up account encryption...')
      const regStart = await opaqueRegistrationStart(password)
      const serverResp = await opaqueRegisterStart(email, toBase64(regStart.message), cfToken)
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
      await opaqueRegisterFinish(
        email,
        toBase64(regUpload),
        toBase64(x25519Pub),
        toBase64(recoveryCheck),
        referralSource,
        referralSharerId,
        referralCode,
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
          '- Docs: https://docs.beebeeb.io',
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
        await encryptedUpload(welcomeFile, fileId, fileKey)
      } catch {
        // Welcome file is a nice-to-have — never block account creation on failure
      }

      // 6. Refresh user state and navigate to drive
      setProcessingStatus('Almost there...')
      await refreshUser()
      navigate('/', { replace: true })
    } catch (err) {
      // 403 captcha_verification_failed → reset widget and prompt retry
      if (err instanceof ApiError && err.status === 403) {
        turnstileRef.current?.reset()
        setError('Verification failed. Please try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
      setStep('password')
    }
  }, [masterKeyBytes, email, password, confirmPassword, cryptoReady, cryptoError, setMasterKey, refreshUser, navigate])

  if (!email) return null

  const stepNumber = STEP_NUMBER[step]

  // Turnstile is invisible — mount it early so the widget has time to complete
  // the challenge before the user reaches the password step.
  const turnstileWidget = <Turnstile ref={turnstileRef} />

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4 py-6 sm:p-xl">
      {/* Invisible Turnstile widget — renders a zero-size hidden div */}
      {turnstileWidget}
      <div className="w-full max-w-[820px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4 sm:px-xl sm:py-lg border-b border-line">
          <BBLogo size={15} />
          <div className="ml-auto flex items-center gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`w-7 h-[3px] rounded-full ${
                  i < stepNumber ? 'bg-ink' : 'bg-paper-3'
                }`}
              />
            ))}
            <span className="ml-2 text-xs font-medium text-ink-2">
              {stepNumber} / {TOTAL_STEPS}
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
                        <BBButton size="sm" onClick={() => navigator.clipboard.writeText(phrase)}>
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
                  Stored in Falkenstein. Hetzner. Under EU jurisdiction.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
