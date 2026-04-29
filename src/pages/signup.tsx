import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'
import { opaqueRegisterStart, opaqueRegisterFinish, opaqueLoginStart as apiOpaqueLoginStart, opaqueLoginFinish as apiOpaqueLoginFinish } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import {
  opaqueRegistrationStart,
  opaqueRegistrationFinish,
  opaqueLoginStart,
  opaqueLoginFinish,
  deriveX25519Public,
  computeRecoveryCheck,
  toBase64,
} from '../lib/crypto'

function getPasswordStrength(pw: string): {
  level: number
  label: string
  color: string
} {
  const len = pw.length
  if (len < 8) return { level: 1, label: 'Weak', color: 'bg-red' }
  if (len < 12) return { level: 2, label: 'Fair', color: 'bg-amber' }
  if (len < 16) return { level: 3, label: 'Good', color: 'bg-green' }
  return { level: 4, label: 'Strong', color: 'bg-green' }
}

export function Signup() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const { setMasterKey, cryptoReady, cryptoError } = useKeys()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const strength = getPasswordStrength(password)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!cryptoReady) {
      setError(cryptoError ?? 'Encryption module is not loaded yet. Please wait.')
      return
    }

    setSubmitting(true)
    try {
      // 1. OPAQUE registration (2-round-trip)
      const regStart = await opaqueRegistrationStart(password)
      const serverResp = await opaqueRegisterStart(email, toBase64(regStart.message))
      const serverMsg = Uint8Array.from(atob(serverResp.server_message), c => c.charCodeAt(0))
      const regUpload = await opaqueRegistrationFinish(regStart.state, password, serverMsg)

      // 2. Finish registration on server
      await opaqueRegisterFinish(email, toBase64(regUpload))

      // 3. Log in immediately to get the OPAQUE export key (= master key)
      const loginStart = await opaqueLoginStart(password)
      const loginResp = await apiOpaqueLoginStart(email, toBase64(loginStart.message))
      const loginMsg = Uint8Array.from(atob(loginResp.server_message), c => c.charCodeAt(0))
      const loginFinish = await opaqueLoginFinish(loginStart.state, password, loginMsg)
      await apiOpaqueLoginFinish(email, toBase64(loginFinish.message), loginResp.server_state)

      // 4. Export key (first 32 bytes) IS the master key
      const masterKey = loginFinish.exportKey.slice(0, 32)
      setMasterKey(masterKey)

      // 5. Register X25519 public key for sharing
      const x25519Pub = await deriveX25519Public(masterKey)
      const recoveryCheck = await computeRecoveryCheck(masterKey)

      await refreshUser()
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Encrypted end-to-end before it leaves your device. We can't read any of it."
    >
      <form onSubmit={handleSubmit}>
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

        <div className="mb-1.5">
          <BBInput
            label="Password"
            type={showPassword ? 'text' : 'password'}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
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
            hint="Used to unlock your vault on this device. Your email provider never sees it."
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

        <div className="mt-2.5 mb-3.5">
          <BBCheckbox
            checked={accepted}
            onChange={setAccepted}
            label="I understand that Beebeeb cannot recover my account if I lose both my password and recovery phrase."
          />
        </div>

        {error && (
          <p className="text-xs text-red mb-3">{error}</p>
        )}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full"
          disabled={!accepted || submitting || password.length < 8}
        >
          {submitting ? 'Creating account...' : 'Create account'}
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
        <div className="border-t border-line mt-4.5 pt-3.5 flex items-center gap-2 text-[11px] text-ink-3">
          <Icon name="shield" size={14} className="text-amber-deep shrink-0" />
          <span>Stored in Frankfurt · Hetzner · under EU jurisdiction</span>
        </div>
      </form>
    </AuthShell>
  )
}
