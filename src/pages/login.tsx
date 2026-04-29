import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'
import { TwoFactorPrompt } from '../components/two-factor-prompt'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { startPasskeyLogin, finishPasskeyLogin, getMe, setToken, hexToBytes, opaqueLoginStart as apiOpaqueLoginStart, opaqueLoginFinish as apiOpaqueLoginFinish } from '../lib/api'
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
      // Step 1: Get challenge from server
      const startRes = await startPasskeyLogin(email)

      // Step 2: Call WebAuthn API
      const credential = await navigator.credentials.get({
        publicKey: startRes.publicKey,
      }) as PublicKeyCredential | null

      if (!credential) {
        setError('Passkey authentication was cancelled')
        setPasskeyLoading(false)
        return
      }

      // Step 3: Send credential back to server
      const response = credential.response as AuthenticatorAssertionResponse
      const credentialData = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: bufferToBase64url(response.authenticatorData),
          clientDataJSON: bufferToBase64url(response.clientDataJSON),
          signature: bufferToBase64url(response.signature),
          userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
        },
      }

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
      <AuthShell
        title="Set up this device"
        subtitle="Your account is authenticated, but this device needs your recovery phrase."
      >
        <div className="rounded-lg border border-line bg-paper-2 p-4">
          <div className="flex items-start gap-3">
            <Icon name="shield" size={18} className="text-amber-deep mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-ink mb-1">No vault found on this device</p>
              <p className="text-xs text-ink-3 leading-relaxed">
                Enter your recovery phrase to set up this device. Your recovery phrase
                was shown when you created your account.
              </p>
            </div>
          </div>
        </div>

        <BBButton
          type="button"
          variant="default"
          size="md"
          className="w-full mt-4"
          onClick={() => {
            setNeedsProvision(false)
            setError('')
          }}
        >
          Back to login
        </BBButton>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to unlock your vault."
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
          <div className="flex items-baseline mb-1.5">
            <label className="text-xs font-medium text-ink-2">Password</label>
            <span className="ml-auto text-[11px] text-amber-deep cursor-pointer hover:underline">
              Forgot?
            </span>
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
              required
            />
            <button
              type="button"
              className="text-ink-3 hover:text-ink-2 transition-colors"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={16} />
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red mb-3 mt-3">{error}</p>
        )}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full mt-3"
          disabled={submitting}
        >
          {submitting ? 'Logging in...' : 'Log in'}
        </BBButton>

        {/* OR divider */}
        <div className="flex items-center gap-2.5 my-5 text-[11px] text-ink-4">
          <div className="flex-1 h-px bg-line" />
          <span>OR</span>
          <div className="flex-1 h-px bg-line" />
        </div>

        <BBButton
          type="button"
          variant="default"
          size="md"
          className="w-full gap-2"
          onClick={handlePasskeyLogin}
          disabled={passkeyLoading}
        >
          <Icon name="key" size={14} />
          {passkeyLoading ? 'Waiting for device...' : 'Sign in with passkey'}
        </BBButton>

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

// ─── WebAuthn helpers ──────────────────────────────

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
