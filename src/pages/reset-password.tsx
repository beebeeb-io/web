import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'
import { resetPassword } from '../lib/api'

const MIN_PASSWORD_LENGTH = 12

export function ResetPassword() {
  const navigate = useNavigate()
  const { token = '' } = useParams<{ token: string }>()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!token) {
    return (
      <AuthShell
        title="Reset link is missing"
        subtitle="The link you opened doesn't include a token. Request a new one."
      >
        <Link to="/forgot-password">
          <BBButton variant="amber" size="lg" className="w-full justify-center">
            Send a new reset link
          </BBButton>
        </Link>
      </AuthShell>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      await resetPassword(token, password)
      // Reset succeeded — server invalidated old sessions and issued a fresh
      // one. Send the user to the login page to re-establish their vault on
      // this device; we don't drop them straight into /, because their local
      // vault keys derive from the OLD password and need re-provisioning.
      navigate('/login?reset=ok', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick something at least 12 characters. A passphrase is fine."
    >
      <form onSubmit={handleSubmit}>
        <label className="block text-xs font-medium text-ink-2 mb-1.5">
          New password
        </label>
        <div className="relative mb-3">
          <BBInput
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            required
            minLength={MIN_PASSWORD_LENGTH}
            placeholder="At least 12 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-3 hover:text-ink-2 transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            <Icon name={showPassword ? 'eye-off' : 'eye'} size={14} />
          </button>
        </div>

        <label className="block text-xs font-medium text-ink-2 mb-1.5">
          Confirm new password
        </label>
        <BBInput
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          required
          placeholder="Repeat the password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        <div className="flex items-start gap-2.5 p-3 mt-4 bg-amber-bg border border-amber/20 rounded-md">
          <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
          <p className="text-xs text-ink-2 leading-relaxed">
            Your files are encrypted with keys tied to this device. After the
            reset you&apos;ll sign in fresh — bring your recovery phrase if
            you don&apos;t already have a working session on another device.
          </p>
        </div>

        {error && <p className="text-xs text-red mt-3">{error}</p>}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full mt-4"
          disabled={submitting || password.length < MIN_PASSWORD_LENGTH || password !== confirm}
        >
          {submitting ? 'Resetting...' : 'Reset password'}
        </BBButton>
      </form>

      <div className="text-center mt-4">
        <Link to="/login" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}
