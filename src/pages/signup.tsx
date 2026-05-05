import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBInput } from '../components/bb-input'
import { Icon } from '../components/icons'

// Referral keys — read here, forwarded to onboarding, cleared after signup
export const REFERRAL_SOURCE_KEY = 'bb_ref_source'
export const REFERRAL_SHARER_KEY = 'bb_ref_sharer'

export function Signup() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [email, setEmail] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')

  // Persist ?ref=share&sharer=<id> from share-view CTA links into localStorage
  // so the attribution data survives through the multi-step onboarding flow.
  useEffect(() => {
    const ref = searchParams.get('ref')
    const sharer = searchParams.get('sharer')
    if (ref) localStorage.setItem(REFERRAL_SOURCE_KEY, ref)
    if (sharer) localStorage.setItem(REFERRAL_SHARER_KEY, sharer)
  }, [searchParams])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Email is required.')
      return
    }

    navigate('/onboarding', { state: { email } })
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Encrypted end-to-end before it leaves your device. We can't read any of it."
      step={1}
      totalSteps={4}
      hideTrust
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

        <div className="mt-2.5 mb-3.5">
          <BBCheckbox
            checked={accepted}
            onChange={setAccepted}
            label="I understand that Beebeeb cannot recover my account if I lose both my password and recovery phrase. We can't recover this."
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
          disabled={!accepted || !email.trim()}
        >
          Continue
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
          <span>Stored in Falkenstein. Hetzner. Under EU jurisdiction.</span>
        </div>
      </form>
    </AuthShell>
  )
}
