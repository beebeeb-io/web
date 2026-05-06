import { type FormEvent, useState } from 'react'
import { AuthShell } from './auth-shell'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useKeys } from '../lib/key-context'
import { useAuth } from '../lib/auth-context'

export function VaultUnlock() {
  const { unlockVault, vaultExists } = useKeys()
  const { logout } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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
