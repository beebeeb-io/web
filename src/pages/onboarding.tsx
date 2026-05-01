import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBInput } from '../components/bb-input'
import { BBLogo } from '../components/bb-logo'
import { Icon } from '../components/icons'
import { MnemonicVerify } from '../components/mnemonic-verify'
import {
  opaqueRegisterStart,
  opaqueRegisterFinish,
} from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import {
  generateRecoveryPhrase,
  opaqueRegistrationStart,
  opaqueRegistrationFinish,
  deriveX25519Public,
  computeRecoveryCheck,
  toBase64,
} from '../lib/crypto'

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

function getPasswordStrength(pw: string): {
  level: number
  label: string
  color: string
} {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++

  if (score <= 1) return { level: 1, label: 'Weak', color: 'bg-red' }
  if (score === 2) return { level: 2, label: 'Fair', color: 'bg-amber' }
  if (score === 3) return { level: 3, label: 'Good', color: 'bg-green' }
  return { level: 4, label: 'Strong', color: 'bg-green' }
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

  const strength = getPasswordStrength(password)

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

    if (password.length < 12) {
      setError('Password must be at least 12 characters.')
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
      setProcessingStatus('Setting up account encryption...')
      const regStart = await opaqueRegistrationStart(password)
      const serverResp = await opaqueRegisterStart(email, toBase64(regStart.message))
      const serverMsg = Uint8Array.from(atob(serverResp.server_message), c => c.charCodeAt(0))
      const regUpload = await opaqueRegistrationFinish(regStart.state, password, serverMsg)

      // 2. Derive X25519 public key and recovery check from mnemonic master key
      setProcessingStatus('Generating encryption keys...')
      const x25519Pub = await deriveX25519Public(masterKeyBytes)
      const recoveryCheck = await computeRecoveryCheck(masterKeyBytes)

      // 3. Finish registration on server (includes public key + recovery check)
      setProcessingStatus('Registering with server...')
      await opaqueRegisterFinish(
        email,
        toBase64(regUpload),
        toBase64(x25519Pub),
        toBase64(recoveryCheck),
      )

      // 4. Wrap master key with password, store in IndexedDB, set in memory
      setProcessingStatus('Securing your vault...')
      await setMasterKey(masterKeyBytes, password)

      // 6. Refresh user state and navigate to drive
      setProcessingStatus('Almost there...')
      await refreshUser()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStep('password')
    }
  }, [masterKeyBytes, email, password, confirmPassword, cryptoReady, cryptoError, setMasterKey, refreshUser, navigate])

  if (!email) return null

  const stepNumber = STEP_NUMBER[step]

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-xl">
      <div className="w-full max-w-[820px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-4 px-xl py-lg border-b border-line">
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
          <div className="grid grid-cols-[1.2fr_1fr]">
            {/* Left panel */}
            <div className="p-8 border-r border-line">
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
                        <div className="grid grid-cols-2 gap-x-7 gap-y-2.5">
                          {words.map((word, i) => (
                            <div key={i} className="flex items-baseline gap-2.5 pb-2 border-b border-dashed border-line">
                              <span className="font-mono text-[11px] text-ink-4 w-4.5 select-none">{String(i + 1).padStart(2, '0')}</span>
                              <span className="font-mono text-sm font-medium text-ink cursor-text">{word}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
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
                          <Icon name="download" size={14} className="mr-1.5" /> Download
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
                          className="text-ink-3 hover:text-ink-2 transition-colors"
                          onClick={() => setShowPassword(!showPassword)}
                          tabIndex={-1}
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

                  {/* Strength meter */}
                  {password.length > 0 && (
                    <div className="mb-3.5">
                      <div className="flex gap-1 mt-2">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`flex-1 h-[3px] rounded-full ${
                              i <= strength.level ? strength.color : 'bg-paper-3'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-xs mt-1 text-ink-3">
                        {strength.label} — {password.length} chars
                      </p>
                    </div>
                  )}

                  <div className="mb-3.5">
                    <BBInput
                      label="Confirm password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Type it again"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.currentTarget.value); setError('') }}
                      trailing={
                        <button
                          type="button"
                          className="text-ink-3 hover:text-ink-2 transition-colors"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          tabIndex={-1}
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
                      disabled={password.length < 12 || confirmPassword.length === 0}
                      onClick={handlePasswordSubmit}
                    >
                      Create account
                    </BBButton>
                  </div>
                </>
              )}
            </div>

            {/* Right panel — context */}
            <div className="p-8 bg-paper-2 flex flex-col">
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
                  Stored in Frankfurt · Hetzner · under EU jurisdiction
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
