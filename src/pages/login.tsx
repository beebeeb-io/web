import { type FormEvent, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { TwoFactorPrompt } from '../components/two-factor-prompt'
import { DeviceProvision } from '../components/device-provision'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { devAutoAuth } from '../lib/dev-auth'
import { startPasskeyLogin, finishPasskeyLogin, setToken, hexToBytes, opaqueLoginStart as apiOpaqueLoginStart, opaqueLoginFinish as apiOpaqueLoginFinish, serverOptsToGetOptions, credentialToAuthenticationJSON, getVaultKeyEscrow } from '../lib/api'
import { opaqueLoginStart, opaqueLoginFinish, toBase64, fromBase64 } from '../lib/crypto'
import { prfExtensionInputs, extractPrfOutput, getVaultWrapKey, decryptVaultBlob } from '../lib/passkey-vault'

export function Login() {
  const navigate = useNavigate()
  const { refreshUser, verify2fa } = useAuth()
  const { unlock, unlockVault, vaultExists, cryptoReady, cryptoError, isUnlocked, setMasterKeyDirect } = useKeys()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 2FA state
  const [partialToken, setPartialToken] = useState<string | null>(null)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [devLoading, setDevLoading] = useState(false)
  // Show passkey login if the browser supports WebAuthn
  const showPasskeyLogin = typeof window !== 'undefined' && !!window.PublicKeyCredential

  const navigateAfterLogin = useCallback(() => {
    navigate('/')
  }, [navigate])

  const handleDevSkip = useCallback(async () => {
    if (!import.meta.env.DEV) return
    setDevLoading(true)
    const ok = await devAutoAuth()
    if (ok) {
      navigateAfterLogin()
    } else {
      setDevLoading(false)
    }
  }, [navigateAfterLogin])

  // Device provisioning state — shown when OPAQUE auth succeeds but no vault exists on this device
  const [needsProvision, setNeedsProvision] = useState(false)

  // Passkey vault fallback — passkey auth succeeded but vault couldn't auto-unlock
  // (no PRF, no localStorage key, no escrow, or decryption failed).
  // User needs to enter their password so we can unlock or provision the vault.
  const [passkeyNeedsPassword, setPasskeyNeedsPassword] = useState(false)
  const [passkeyFallbackPassword, setPasskeyFallbackPassword] = useState('')
  const [passkeyFallbackShowPw, setPasskeyFallbackShowPw] = useState(false)
  const [passkeyFallbackSubmitting, setPasskeyFallbackSubmitting] = useState(false)
  const [passkeyFallbackError, setPasskeyFallbackError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!cryptoReady) {
      setError(cryptoError ?? 'Encryption module is not loaded yet. Please wait.')
      return
    }

    setSubmitting(true)

    // OPAQUE is mandatory — no fallback path.
    try {
      const loginStart = await opaqueLoginStart(password)
      const serverResp = await apiOpaqueLoginStart(email, toBase64(loginStart.message))
      const serverMsg = Uint8Array.from(atob(serverResp.server_message), c => c.charCodeAt(0))
      const loginFinish = await opaqueLoginFinish(loginStart.state, password, serverMsg)
      await apiOpaqueLoginFinish(email, toBase64(loginFinish.message), serverResp.server_state)

      // OPAQUE auth succeeded — refresh user session
      await refreshUser()

      // Now unlock the local vault
      if (vaultExists) {
        const ok = await unlockVault(password)
        if (!ok) {
          setError('Wrong password — could not unlock vault on this device.')
          setSubmitting(false)
          return
        }
        navigateAfterLogin()
      } else {
        // No vault on this device — needs mnemonic provisioning
        setNeedsProvision(true)
        setSubmitting(false)
      }
    } catch (opaqueErr) {
      // OPAQUE is mandatory — never fall back to password auth.
      if (import.meta.env.DEV) console.warn('[login] OPAQUE failed:', opaqueErr)
      setError('Authentication failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handle2faVerify(code: string) {
    if (!partialToken) return
    try {
      const result = await verify2fa(partialToken, code)
      if (result?.salt) {
        const salt = hexToBytes(result.salt)
        await unlock(password, salt)
      }
      navigateAfterLogin()
    } catch {
      setError('Incorrect code or session expired. Please try again.')
    }
  }

  async function handlePasskeyFallback(e: FormEvent) {
    e.preventDefault()
    setPasskeyFallbackError('')

    if (!cryptoReady) {
      setPasskeyFallbackError(cryptoError ?? 'Encryption module is not loaded yet. Please wait.')
      return
    }

    setPasskeyFallbackSubmitting(true)

    try {
      // Run OPAQUE to validate the password (also refreshes the session)
      const loginStart = await opaqueLoginStart(passkeyFallbackPassword)
      const serverResp = await apiOpaqueLoginStart(email, toBase64(loginStart.message))
      const serverMsg = Uint8Array.from(atob(serverResp.server_message), c => c.charCodeAt(0))
      const loginFinish = await opaqueLoginFinish(loginStart.state, passkeyFallbackPassword, serverMsg)
      await apiOpaqueLoginFinish(email, toBase64(loginFinish.message), serverResp.server_state)
      await refreshUser()

      // Try unlocking the local vault with this password
      if (vaultExists) {
        const ok = await unlockVault(passkeyFallbackPassword)
        if (!ok) {
          setPasskeyFallbackError('Password accepted, but could not unlock the local vault. Try your recovery phrase instead.')
          setPasskeyFallbackSubmitting(false)
          return
        }
        navigateAfterLogin()
      } else {
        // No local vault — hand off to device provisioning (recovery phrase / QR)
        setPassword(passkeyFallbackPassword)
        setPasskeyNeedsPassword(false)
        setNeedsProvision(true)
        setPasskeyFallbackSubmitting(false)
      }
    } catch {
      setPasskeyFallbackError('Wrong password. Please try again.')
    } finally {
      setPasskeyFallbackSubmitting(false)
    }
  }

  async function handlePasskeyLogin() {
    setError('')

    if (!email) {
      setError('Enter your email first to sign in with passkey')
      return
    }

    setPasskeyLoading(true)
    try {
      // Step 1: Get challenge from server (binary fields are base64url strings)
      const startRes = await startPasskeyLogin(email)

      // Step 2: Convert server options to browser-compatible format
      const getOptions = serverOptsToGetOptions(startRes.publicKey)

      // Step 3: Call WebAuthn API with PRF extension for vault key derivation
      const prfExt = prfExtensionInputs()
      const credential = await navigator.credentials.get({
        publicKey: {
          ...getOptions,
          extensions: {
            ...getOptions.extensions,
            ...prfExt,
          },
        },
      }) as PublicKeyCredential | null

      if (!credential) {
        setError('Passkey authentication was cancelled')
        setPasskeyLoading(false)
        return
      }

      // Step 4: Convert credential response to JSON for webauthn-rs
      const credentialData = credentialToAuthenticationJSON(credential)

      const result = await finishPasskeyLogin(
        credentialData,
        startRes.auth_state,
        startRes.user_id,
      )

      if (result.session_token) {
        setToken(result.session_token)
        await refreshUser()

        if (isUnlocked) {
          navigateAfterLogin()
          return
        }

        // Step 5: Attempt passkey vault unlock via escrow.
        // Wrapped in try-catch so any failure in the PRF/escrow/decrypt
        // path gracefully falls through to the password prompt instead
        // of showing a generic "Passkey authentication failed" error.
        try {
          const credentialId = credential.id
          const extensionResults = credential.getClientExtensionResults()
          const prfOutput = extractPrfOutput(extensionResults)

          // Retrieve vault wrap key (from PRF output or localStorage fallback)
          const wrapKey = await getVaultWrapKey(credentialId, prfOutput, false)

          if (wrapKey) {
            // Retrieve the encrypted vault blob from the server
            const escrowBlob = await getVaultKeyEscrow(credentialId)

            if (escrowBlob) {
              const encryptedBlob = fromBase64(escrowBlob)
              const masterKey = await decryptVaultBlob(wrapKey, encryptedBlob)

              if (masterKey) {
                setMasterKeyDirect(masterKey)
                navigateAfterLogin()
                return
              }
            }
          }
        } catch (vaultErr) {
          if (import.meta.env.DEV) {
            console.warn('[passkey-login] Vault auto-unlock failed, falling back to password:', vaultErr)
          }
        }

        // Vault unlock failed — show password fallback prompt
        setPasskeyNeedsPassword(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey authentication failed')
    } finally {
      setPasskeyLoading(false)
    }
  }

  // Show 2FA prompt when login returned requires_2fa
  if (partialToken) {
    return (
      <AuthShell
        title="Two-factor authentication"
        subtitle="Your account is protected with 2FA."
      >
        <TwoFactorPrompt
          onVerify={handle2faVerify}
          onCancel={() => {
            setPartialToken(null)
            setError('')
          }}
        />
      </AuthShell>
    )
  }

  // Passkey auth succeeded but vault couldn't auto-unlock — ask for password
  if (passkeyNeedsPassword) {
    return (
      <AuthShell
        title="Unlock your vault"
        subtitle="Passkey verified. Enter your password to decrypt your files on this device."
      >
        <form onSubmit={handlePasskeyFallback}>
          {/* Success indicator */}
          <div className="flex items-start gap-2.5 mb-5 px-3.5 py-3 rounded-md bg-green/5 border border-green/15">
            <Icon name="check" size={14} className="text-green shrink-0 mt-px" />
            <p className="text-xs text-ink-2 leading-relaxed">
              Identity confirmed via passkey. Your vault still needs your password to unlock.
            </p>
          </div>

          <div className="mb-3.5">
            <label className="text-xs font-medium text-ink-2 mb-1.5 block">Password</label>
            <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 transition-all focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep">
              <Icon name="lock" size={16} className="text-ink-4 shrink-0" />
              <input
                type={passkeyFallbackShowPw ? 'text' : 'password'}
                placeholder="Your password"
                value={passkeyFallbackPassword}
                onChange={(e) => setPasskeyFallbackPassword(e.currentTarget.value)}
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
                autoComplete="current-password"
                autoFocus
                required
              />
              <button
                type="button"
                className="text-ink-3 hover:text-ink-2 p-0.5 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-deep"
                onClick={() => setPasskeyFallbackShowPw(!passkeyFallbackShowPw)}
                aria-label={passkeyFallbackShowPw ? 'Hide password' : 'Show password'}
              >
                <Icon name={passkeyFallbackShowPw ? 'eye-off' : 'eye'} size={15} />
              </button>
            </div>
          </div>

          {passkeyFallbackError && (
            <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-md bg-red/5 border border-red/15">
              <Icon name="shield" size={14} className="text-red shrink-0 mt-px" />
              <p className="text-xs text-red leading-relaxed">{passkeyFallbackError}</p>
            </div>
          )}

          <BBButton
            type="submit"
            variant="amber"
            size="lg"
            className="w-full"
            disabled={passkeyFallbackSubmitting || !passkeyFallbackPassword}
          >
            {passkeyFallbackSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
                Unlocking vault...
              </span>
            ) : (
              'Unlock vault'
            )}
          </BBButton>
        </form>
      </AuthShell>
    )
  }

  // Show device provisioning when OPAQUE auth succeeded but no vault on this device
  if (needsProvision) {
    return (
      <DeviceProvision
        password={password}
        onProvisioned={navigateAfterLogin}
      />
    )
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to unlock your encrypted vault."
    >
      <form onSubmit={handleSubmit} data-crypto-ready={cryptoReady ? 'true' : 'false'}>
        <BBInput
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          icon="mail"
          className="mb-3.5"
          autoComplete="email"
          required
        />

        {/* Password field with show/hide toggle and Forgot link */}
        <div className="mb-1.5">
          <div className="flex items-baseline mb-1.5">
            <label className="text-xs font-medium text-ink-2">Password</label>
            <Link
              to="/forgot-password"
              className="ml-auto text-[11px] text-amber-deep hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-deep rounded"
            >
              Forgot?
            </Link>
          </div>
          <div
            className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 transition-all focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep"
          >
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="password-toggle text-ink-3 hover:text-ink-2 p-0.5 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-deep"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} />
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-2 mt-3 mb-3 px-3 py-2.5 rounded-md bg-red/5 border border-red/15">
            <Icon name="shield" size={14} className="text-red shrink-0 mt-px" />
            <p className="text-xs text-red leading-relaxed">{error}</p>
          </div>
        )}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full mt-3"
          disabled={submitting}
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
              Unlocking vault...
            </span>
          ) : (
            'Sign in'
          )}
        </BBButton>

        {showPasskeyLogin && (
          <>
            {/* OR divider */}
            <div className="flex items-center gap-3 my-5 text-[11px] text-ink-4 select-none">
              <div className="flex-1 h-px bg-line" />
              <span className="tracking-wider uppercase">or</span>
              <div className="flex-1 h-px bg-line" />
            </div>

            {/* Passkey — first-class option with distinct styling */}
            <button
              type="button"
              className="w-full flex items-center justify-center gap-2.5 px-lg py-2.5 text-sm font-medium text-ink border border-line-2 rounded-lg bg-paper hover:bg-paper-2 active:bg-paper-3 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-deep focus-visible:ring-offset-2"
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading}
            >
              <span className="flex items-center justify-center w-6 h-6 rounded-md bg-amber-bg">
                <Icon name="key" size={13} className="text-amber-deep" />
              </span>
              {passkeyLoading ? 'Waiting for device...' : 'Sign in with passkey'}
            </button>
          </>
        )}

        {/* Dev-mode bypass — only rendered when Vite DEV flag is true (tree-shaken in prod) */}
        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={handleDevSkip}
            disabled={devLoading}
            className="w-full mt-3 flex items-center justify-center gap-1.5 py-2 text-xs font-mono text-ink-3 hover:text-ink-2 border border-dashed border-line rounded-lg transition-colors disabled:opacity-50"
          >
            {devLoading ? (
              <><span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> authenticating…</>
            ) : (
              <>⚡ Skip to app (dev auto-login)</>
            )}
          </button>
        )}

        <p className="text-xs text-ink-3 text-center mt-5">
          New to Beebeeb?{' '}
          <Link
            to="/signup"
            className="text-amber-deep font-medium hover:underline"
          >
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
