import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '@beebeeb/shared'
import { unlockAccount } from '../lib/api'

// Public page (task 0764A). A locked-out user CANNOT authenticate, so the unlock
// link emailed to them lands here with no auth guard. It redeems the single-use
// token (POST /api/v1/auth/unlock → {unlocked: bool}); the server never reveals
// whether the token matched an account, so the copy stays non-enumerating.
type Status = 'working' | 'unlocked' | 'failed'

export function Unlock() {
  const { token } = useParams<{ token: string }>()
  const [status, setStatus] = useState<Status>('working')

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setStatus('failed')
      return
    }
    unlockAccount(token)
      .then((res) => {
        if (!cancelled) setStatus(res.unlocked ? 'unlocked' : 'failed')
      })
      .catch(() => {
        if (!cancelled) setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (status === 'working') {
    return (
      <AuthShell title="Unlocking your account…" subtitle="One moment while we verify your unlock link.">
        <div className="text-center text-xs text-ink-3">Verifying…</div>
      </AuthShell>
    )
  }

  if (status === 'unlocked') {
    return (
      <AuthShell
        title="Your account is unlocked"
        subtitle="The temporary lock from too many sign-in attempts has been lifted."
      >
        <Link to="/login">
          <BBButton variant="amber" size="lg" className="w-full justify-center">
            Sign in
          </BBButton>
        </Link>
      </AuthShell>
    )
  }

  // failed — expired, already used, or no token. Honest, non-enumerating copy.
  return (
    <AuthShell title="This unlock link didn’t work" subtitle="It may have expired or already been used.">
      <div className="flex items-start gap-2.5 p-3 mb-4 bg-amber-bg border border-amber/20 rounded-md">
        <p className="text-xs text-ink-2 leading-relaxed">
          You don’t need to do anything — a sign-in lock lifts on its own after a short while.
          Try signing in again shortly.
        </p>
      </div>
      <Link to="/login">
        <BBButton variant="amber" size="lg" className="w-full justify-center">
          Back to sign in
        </BBButton>
      </Link>
    </AuthShell>
  )
}
