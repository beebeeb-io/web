import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'
import { forgotPassword } from '../lib/api'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || submitting) return
    setError('')
    setSubmitting(true)
    try {
      await forgotPassword(email.trim())
      // Server returns the same response whether the address exists or not
      // — that's deliberate, so the UI must mirror it. Always show success.
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle="If an account exists for that address, we just sent a reset link. The link expires in 1 hour."
      >
        <div className="flex items-start gap-2.5 p-3 mb-5 bg-amber-bg border border-amber/20 rounded-md">
          <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
          <p className="text-xs text-ink-2 leading-relaxed">
            We can&apos;t tell you whether the email is registered — that would
            leak which accounts exist. If you don&apos;t receive a link, the
            address probably isn&apos;t on file.
          </p>
        </div>
        <Link to="/login">
          <BBButton variant="default" size="lg" className="w-full justify-center">
            Back to sign in
          </BBButton>
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with. We&rsquo;ll send a one-time link."
    >
      <form onSubmit={handleSubmit}>
        <label className="block text-xs font-medium text-ink-2 mb-1.5">
          Email
        </label>
        <BBInput
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {error && <p className="text-xs text-red mt-3">{error}</p>}

        <BBButton
          type="submit"
          variant="amber"
          size="lg"
          className="w-full mt-4"
          disabled={submitting || !email.trim()}
        >
          {submitting ? 'Sending...' : 'Send reset link'}
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
