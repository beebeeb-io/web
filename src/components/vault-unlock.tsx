import { type FormEvent, useState, useCallback } from 'react'
import { AuthShell } from './auth-shell'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useKeys } from '../lib/key-context'
import { useAuth } from '../lib/auth-context'
import { fromBase64 } from '../lib/crypto'
import {
  listPasskeys,
  startPasskeyLogin,
  finishPasskeyLogin,
  getVaultKeyEscrow,
  serverOptsToGetOptions,
  credentialToAuthenticationJSON,
  getEmail,
} from '../lib/api'
import {
  prfExtensionInputs,
  extractPrfOutput,
  getVaultWrapKey,
  decryptVaultBlob,
} from '../lib/passkey-vault'

export function VaultUnlock() {
  const { unlockVault, vaultExists, setMasterKeyDirect } = useKeys()
  const { logout, refreshUser } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)

  // Check if passkeys are available (browser supports WebAuthn)
  const canUsePasskey = typeof window !== 'undefined' && !!window.PublicKeyCredential

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const ok = await unlockVault(password)
      if (!ok) {
        setError('Wrong password. Try again.')
      }
    } catch {
      setError('Failed to unlock vault.')
    } finally {
      setSubmitting(false)
    }
  }

  const handlePasskeyUnlock = useCallback(async () => {
    setError('')
    setPasskeyLoading(true)

    try {
      const email = getEmail()
      if (!email) {
        setError('Could not determine account email for passkey lookup.')
        return
      }

      // Step 1: Check if user has passkeys registered
      let hasPasskeys = false
      try {
        const keys = await listPasskeys()
        hasPasskeys = keys.length > 0
      } catch {
        // If listing fails, still try — the user might have passkeys
        hasPasskeys = true
      }

      if (!hasPasskeys) {
        setError('No passkeys registered. Use your password to unlock.')
        return
      }

      // Step 2: Start passkey authentication
      const startRes = await startPasskeyLogin(email)
      const getOptions = serverOptsToGetOptions(startRes.publicKey)

      // Step 3: Call WebAuthn API with PRF extension
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
        setError('Passkey authentication was cancelled.')
        return
      }

      // Step 4: Complete server-side authentication
      const credentialData = credentialToAuthenticationJSON(credential)
      await finishPasskeyLogin(credentialData, startRes.auth_state, startRes.user_id)
      await refreshUser()

      // Step 5: Retrieve and decrypt vault key
      const credentialId = credential.id
      const extensionResults = credential.getClientExtensionResults()
      const prfOutput = extractPrfOutput(extensionResults)
      const wrapKey = await getVaultWrapKey(credentialId, prfOutput, false)

      if (!wrapKey) {
        setError('Passkey verified, but no vault key is linked to it. Use your password.')
        return
      }

      const escrowBlob = await getVaultKeyEscrow(credentialId)
      if (!escrowBlob) {
        setError('Passkey verified, but no vault key found on the server. Use your password.')
        return
      }

      const encryptedBlob = fromBase64(escrowBlob)
      const masterKey = await decryptVaultBlob(wrapKey, encryptedBlob)

      if (!masterKey) {
        setError('Failed to decrypt vault key. The escrow may be corrupted. Use your password.')
        return
      }

      setMasterKeyDirect(masterKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey unlock failed.')
    } finally {
      setPasskeyLoading(false)
    }
  }, [setMasterKeyDirect, refreshUser])

  if (!vaultExists) return null

  return (
    <AuthShell
      title="Vault locked"
      subtitle="Enter your password to unlock your encrypted files."
    >
      <form onSubmit={handleSubmit}>
        <div className="mb-3.5">
          <label className="text-xs font-medium text-ink-2 mb-1.5 block">Password</label>
          <div className="flex items-center gap-2 border border-line rounded-md bg-paper px-3 py-2 transition-all focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep">
            <Icon name="lock" size={16} className="text-ink-4 shrink-0" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
              autoFocus
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

        {error && <p className="text-xs text-red mb-3">{error}</p>}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full"
          disabled={submitting || !password}
        >
          {submitting ? 'Unlocking...' : 'Unlock vault'}
        </BBButton>

        {canUsePasskey && (
          <>
            <div className="flex items-center gap-3 my-4 text-[11px] text-ink-4 select-none">
              <div className="flex-1 h-px bg-line" />
              <span className="tracking-wider uppercase">or</span>
              <div className="flex-1 h-px bg-line" />
            </div>

            <button
              type="button"
              className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-medium text-ink border border-line-2 rounded-lg bg-paper hover:bg-paper-2 active:bg-paper-3 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-deep focus-visible:ring-offset-2 disabled:opacity-50"
              onClick={handlePasskeyUnlock}
              disabled={passkeyLoading}
            >
              <span className="flex items-center justify-center w-6 h-6 rounded-md bg-amber-bg">
                <Icon name="key" size={13} className="text-amber-deep" />
              </span>
              {passkeyLoading ? 'Waiting for device...' : 'Unlock with passkey'}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={logout}
          className="w-full mt-3 text-xs text-ink-3 hover:text-ink-2 transition-colors"
        >
          Log out and use a different account
        </button>
      </form>
    </AuthShell>
  )
}
