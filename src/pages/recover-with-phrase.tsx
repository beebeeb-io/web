/**
 * /recover-with-phrase — password recovery using the 12-word BIP39 phrase.
 *
 * Flow:
 *  Step 1 (phrase):  enter email + recovery phrase → derive master key →
 *                    compute recovery_check → POST recover-with-phrase-start
 *  Step 2 (password): set new password → OPAQUE registration →
 *                    POST recover-with-phrase-finalize
 *  Step 3 (success): show confirmation → navigate to drive
 *
 * Server endpoints are not yet live (rust-engineer task 0034). If start
 * returns null (404 / unavailable), show a friendly "try later" message
 * rather than an error.
 */

import { type FormEvent, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'
import {
  recoverWithPhraseStart,
  recoverOpaqueRegister,
  recoverWithPhraseFinalize,
  ApiError,
} from '../lib/api'
import {
  recoverFromPhrase,
  computeRecoveryCheck,
  opaqueRegistrationStart,
  opaqueRegistrationFinish,
  deriveX25519Public,
  toBase64,
  initCrypto,
} from '../lib/crypto'
import { useKeys } from '../lib/key-context'
import { useAuth } from '../lib/auth-context'

type Step = 'phrase' | 'password' | 'success' | 'unavailable'

const WORD_COUNT = 12

function normalisePhrase(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

function validatePhrase(phrase: string): string | null {
  const words = phrase.split(' ')
  if (words.length !== WORD_COUNT) return `Recovery phrase must be exactly ${WORD_COUNT} words (you entered ${words.length}).`
  if (words.some((w) => !/^[a-z]+$/.test(w))) return 'Each word must contain only lowercase letters.'
  return null
}

function validatePassword(pw: string, confirm: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (pw !== confirm) return 'Passwords do not match.'
  return null
}

export function RecoverWithPhrase() {
  const navigate = useNavigate()
  const { setMasterKey } = useKeys()
  const { refreshUser } = useAuth()

  const [step, setStep] = useState<Step>('phrase')

  // Step 1 state
  const [email, setEmail] = useState('')
  const [phraseInput, setPhraseInput] = useState('')
  const [phraseError, setPhraseError] = useState('')
  const [phraseSubmitting, setPhraseSubmitting] = useState('')

  // Carried across steps (not stored persistently — lives only in component state)
  const [derivedMasterKey, setDerivedMasterKey] = useState<Uint8Array | null>(null)
  const [recoveryToken, setRecoveryToken] = useState('')

  // Step 2 state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)

  // ── Step 1: Verify phrase + call server ─────────────────────────────
  const handlePhraseSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setPhraseError('')
    if (!email.trim()) { setPhraseError('Email is required.'); return }

    const phrase = normalisePhrase(phraseInput)
    const validationError = validatePhrase(phrase)
    if (validationError) { setPhraseError(validationError); return }

    setPhraseSubmitting('Deriving keys from phrase…')
    try {
      await initCrypto()

      // Derive the master key from the 12-word phrase
      const masterKey = await recoverFromPhrase(phrase)
      const recoveryCheckBytes = await computeRecoveryCheck(masterKey)
      const recoveryCheckB64 = toBase64(recoveryCheckBytes)

      setPhraseSubmitting('Verifying with server…')
      const result = await recoverWithPhraseStart(email.trim().toLowerCase(), recoveryCheckB64)

      if (result === null) {
        // Server returned 404 — endpoint not deployed yet
        setStep('unavailable')
        return
      }

      // Store master key in component state for use in step 2
      setDerivedMasterKey(masterKey)
      setRecoveryToken(result.recovery_token)
      setStep('password')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPhraseError('The recovery phrase does not match this account. Double-check all words.')
      } else if (err instanceof ApiError && err.status === 404) {
        setStep('unavailable')
      } else {
        setPhraseError(err instanceof Error ? err.message : 'Verification failed. Try again.')
      }
    } finally {
      setPhraseSubmitting('')
    }
  }, [email, phraseInput])

  // ── Step 2: OPAQUE re-registration + finalize ────────────────────────
  const handlePasswordSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setPasswordError('')

    const validationError = validatePassword(newPassword, confirmPassword)
    if (validationError) { setPasswordError(validationError); return }
    if (!derivedMasterKey || !recoveryToken) {
      setPasswordError('Recovery session lost. Please start over.')
      setStep('phrase')
      return
    }

    setPasswordSubmitting(true)
    try {
      // 1. OPAQUE registration start (client-side) — generates request + state
      const regStart = await opaqueRegistrationStart(newPassword)

      // 2. Send client message to server to get OPAQUE server response
      //    Uses recovery token for auth (no session exists yet)
      const { server_message } = await recoverOpaqueRegister(
        recoveryToken,
        toBase64(regStart.message),
      )

      // 3. OPAQUE registration finish (client-side) — produces upload bytes
      const serverMsg = Uint8Array.from(atob(server_message), (c) => c.charCodeAt(0))
      const regUpload = await opaqueRegistrationFinish(regStart.state, newPassword, serverMsg)

      // 4. Compute new recovery check and x25519 public key from the master key
      const newRecoveryCheck = await computeRecoveryCheck(derivedMasterKey)
      const newX25519Pub = await deriveX25519Public(derivedMasterKey)

      // 5. Finalize recovery — rotates all credentials on the server
      await recoverWithPhraseFinalize(
        recoveryToken,
        toBase64(regUpload),
        toBase64(newRecoveryCheck),
        toBase64(newX25519Pub),
      )

      // 6. Re-wrap master key under the new password and store in vault
      await setMasterKey(derivedMasterKey, newPassword)

      // Clear sensitive data from component state
      setDerivedMasterKey(null)

      setStep('success')
      await refreshUser()
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setStep('unavailable')
      } else if (err instanceof ApiError && err.status === 400) {
        setPasswordError('Recovery token expired. Please start the process again.')
        setStep('phrase')
      } else {
        setPasswordError(err instanceof Error ? err.message : 'Recovery failed. Please try again.')
      }
    } finally {
      setPasswordSubmitting(false)
    }
  }, [newPassword, confirmPassword, derivedMasterKey, recoveryToken, email, setMasterKey, refreshUser])

  // ── Renders ──────────────────────────────────────────────────────────

  if (step === 'unavailable') {
    return (
      <AuthShell title="Recovery unavailable" hideTrust>
        <div className="flex items-start gap-2.5 p-3 rounded-md bg-paper-2 border border-line mb-4">
          <Icon name="cloud" size={14} className="text-ink-3 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-ink-2 leading-relaxed">
            The recovery service is not available right now. This feature is currently
            being deployed. Please try again in a few minutes.
          </p>
        </div>
        <BBButton
          variant="default"
          size="lg"
          className="w-full justify-center"
          onClick={() => setStep('phrase')}
        >
          Try again
        </BBButton>
        <div className="text-center mt-4">
          <Link to="/forgot-password" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
            ← Recovery options
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (step === 'success') {
    return (
      <AuthShell
        title="Password updated"
        subtitle="Your vault is unlocked with your new password. Your files are unchanged."
        hideTrust
      >
        <div className="flex items-start gap-2.5 p-3 rounded-md bg-paper-2 border border-line mb-5">
          <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-ink-2 leading-relaxed">
            Your recovery phrase remains valid — save it somewhere safe for the future.
          </p>
        </div>
        <BBButton
          variant="amber"
          size="lg"
          className="w-full justify-center"
          onClick={() => navigate('/', { replace: true })}
        >
          Go to drive
        </BBButton>
      </AuthShell>
    )
  }

  if (step === 'password') {
    return (
      <AuthShell
        title="Set a new password"
        subtitle="Your phrase was verified. Choose a strong password for your account."
        step={2}
        totalSteps={2}
      >
        <form onSubmit={handlePasswordSubmit}>
          <div className="space-y-4">
            <BBInput
              label="New password"
              type="password"
              autoFocus
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPasswordError('') }}
            />
            <BBInput
              label="Confirm password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError('') }}
            />
          </div>

          {passwordError && <p className="text-xs text-red mt-3">{passwordError}</p>}

          <BBButton
            type="submit"
            variant="amber"
            size="lg"
            className="w-full mt-5"
            disabled={passwordSubmitting || !newPassword || !confirmPassword}
          >
            {passwordSubmitting
              ? <><span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />Updating…</>
              : 'Set new password'}
          </BBButton>
        </form>

        <div className="text-center mt-4">
          <button
            onClick={() => setStep('phrase')}
            className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors"
          >
            ← Back
          </button>
        </div>
      </AuthShell>
    )
  }

  // ── Step 1: phrase entry ─────────────────────────────────────────────
  return (
    <AuthShell
      title="Recover with phrase"
      subtitle="Enter your email and the 12-word recovery phrase from your account setup."
      step={1}
      totalSteps={2}
    >
      <form onSubmit={handlePhraseSubmit}>
        <div className="space-y-4">
          <BBInput
            label="Email address"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setPhraseError('') }}
          />

          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">
              Recovery phrase
            </label>
            <textarea
              required
              autoComplete="off"
              spellCheck={false}
              rows={3}
              placeholder="word1 word2 word3 … word12"
              value={phraseInput}
              onChange={(e) => { setPhraseInput(e.target.value); setPhraseError('') }}
              className="w-full font-mono text-[13px] text-ink bg-paper border border-line rounded-md px-3 py-2 outline-none resize-none placeholder:text-ink-4 focus:border-line-2 transition-colors leading-relaxed"
            />
            <p className="text-[11px] text-ink-4 mt-1">
              Paste or type all {WORD_COUNT} words, separated by spaces. Case-insensitive.
            </p>
          </div>
        </div>

        {phraseError && <p className="text-xs text-red mt-3">{phraseError}</p>}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full mt-5"
          disabled={!!phraseSubmitting || !email.trim() || !phraseInput.trim()}
        >
          {phraseSubmitting
            ? <><span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />{phraseSubmitting}</>
            : 'Verify phrase →'}
        </BBButton>
      </form>

      <div className="text-center mt-4 space-y-2">
        <div>
          <Link to="/forgot-password" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
            ← Recovery options
          </Link>
        </div>
        <div>
          <Link to="/login" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
            Back to sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  )
}
