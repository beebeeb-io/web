import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

/**
 * /logout — performs a full session logout, then redirects to /login.
 *
 * Logout is also reachable from the account menu and the command palette;
 * this route exists so a direct hit on /logout (typed URL, external link, a
 * "sign out" deep-link) does the right thing instead of 404ing on NotFound.
 *
 * `logout()` clears the in-memory keys + local vault, POSTs /auth/logout, and
 * sets the user to null — at which point we send the visitor to /login. If the
 * visitor was already signed out, we redirect immediately.
 */
export function Logout() {
  const { user, logout } = useAuth()

  useEffect(() => {
    // Fire exactly once on mount; `logout` is a stable useCallback.
    void logout()
  }, [logout])

  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <div className="flex items-center gap-2.5 text-ink-3 text-sm">
        <span className="inline-block w-3.5 h-3.5 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
        Signing out…
      </div>
    </div>
  )
}
