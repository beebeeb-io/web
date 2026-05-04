import { type FormEvent, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'
import { TwoFactorPrompt } from '../components/two-factor-prompt'
import { DeviceProvision } from '../components/device-provision'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { devAutoAuth } from '../lib/dev-auth'
import { startPasskeyLogin, finishPasskeyLogin, getMe, setToken, hexToBytes, opaqueLoginStart as apiOpaqueLoginStart, opaqueLoginFinish as apiOpaqueLoginFinish, serverOptsToGetOptions, credentialToAuthenticationJSON } from '../lib/api'
import { opaqueLoginStart, opaqueLoginFinish, toBase64, fromBase64 } from '../lib/crypto'

export function Login() {
  const navigate = useNavigate()
  const { login, refreshUser, verify2fa } = useAuth()
  const { unlock, unlockVault, vaultExists, cryptoReady, cryptoError } = useKeys()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 2FA state
  const [partialToken, setPartialToken] = useState<string | null>(null)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [devLoading, setDevLoading] = useState(false)

  const handleDevSkip = useCallback(async () => {
    if (!import.meta.env.DEV) return
    setDevLoading(true)
    const ok = await devAutoAuth()
    if (ok) {
      navigate('/')
    } else {
      setDevLoading(false)
    }
  }, [navigate])

  // Device provisioning state — shown when OPAQUE auth succeeds but no vault exists on this device
  const [needsProvision, setNeedsProvision] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!cryptoReady) {
      setError(cryptoError ?? 'Encryption module is not loaded yet. Please wait.')
      return
    }

    setSubmitting(true)

    // Try OPAQUE first, then legacy fallback
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
        navigate('/')
      } else {
        // No vault on this device — needs mnemonic provisioning
        setNeedsProvision(true)
        setSubmitting(false)
      }
    } catch {
      // OPAQUE failed — try legacy login
      try {
        const result = await login(email, password)
        if (result.requires_2fa && result.partial_token) {
          setPartialToken(result.partial_token)
        } else if (result.salt) {
          const saltBytes = fromBase64(result.salt)
          await unlock(password, saltBytes)
          navigate('/')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid email or password')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handle2faVerify(code: string) {
    if (!partialToken) return
    const result = await verify2fa(partialToken, code)
    if (result?.salt) {
      const salt = hexToBytes(result.salt)
      await unlock(password, salt)
    }
    navigate('/')
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

      // Step 3: Call WebAuthn API with converted options
      const credential = await navigator.credentials.get({
        publicKey: getOptions,
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
        await getMe()
        // Note: passkey login skips password-based key unlock.
        // The vault key would need to be stored encrypted on the server
        // or retrieved via another mechanism. For now, navigate to drive.
        navigate('/')
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

  // Show device provisioning when OPAQUE auth succeeded but no vault on this device
  if (needsProvision) {
    return (
      <DeviceProvision
        password={password}
        onProvisioned={() => navigate('/')}
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
              className="ml-auto text-[11px] text-amber-deep hover:underline"
              tabIndex={-1}
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
              className="password-toggle text-ink-3 hover:text-ink-2 p-0.5 rounded-sm"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
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
            'Log in'
          )}
        </BBButton>

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
