/**
 * Admin impersonation redemption page — route: /auth/impersonate?token=…
 *
 * Receives the single-use token issued by the admin portal
 * (POST /api/v1/admin/users/:id/impersonate) and exchanges it for a real
 * session via POST /api/v1/auth/impersonate. On success, stores the session,
 * stashes the impersonation marker so the support-view banner shows up, and
 * redirects to /. On failure shows a clear error page.
 *
 * The token has a 15-minute TTL and is single-use, so this page must run
 * exactly once per impersonation handoff. Refreshing after success will
 * 401 — that is the intended behaviour.
 *
 * See task 0161.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BBButton, BBLogo, Icon } from '@beebeeb/shared'
import { redeemImpersonationToken, getMe } from '../../lib/api'

type Phase =
  | { kind: 'redeeming' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

export function ImpersonateRedeem() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const [phase, setPhase] = useState<Phase>({ kind: 'redeeming' })
  // React StrictMode double-invokes useEffect in dev. The token is single-use
  // so a second POST would always fail with 401 and clobber a successful
  // redemption. Guard with a ref so the network call is sent at most once
  // per page load regardless of strict-mode behaviour.
  const fired = useRef(false)
  // Task 1691 follow-up (1693 bug-rel round): StrictMode's mount1 → cleanup →
  // mount2 cycle sets the mount1 closure's `cancelled = true` while the
  // redeem POST it started is still in flight. The async work then completed
  // AFTER mount2 early-returned on fired.current, so the ONLY thing between
  // the user and the drive was the final `if (cancelled) return` — which
  // bailed before setPhase('success')/location.replace('/'), leaving the
  // page stuck on "Starting support view" while the target session was
  // already live (reproduced on localhost: POST /auth/impersonate 200,
  // /auth/me 200, sessionStorage markers set, no navigation). Once the
  // redeem+getMe+markers have actually succeeded, the transition MUST NOT
  // be suppressed by the stale cleanup flag — the page load is the unit
  // that matters here (the token is single-use; the session IS live), so
  // the completed work re-runs its transition on remount via a ref instead
  // of trusting a per-mount cancellation flag.
  const succeededRef = useRef(false)

  const completeSuccess = useCallback(() => {
    if (succeededRef.current) return
    succeededRef.current = true
    setPhase({ kind: 'success' })
    // Hard navigate so AuthProvider, KeyProvider, and the rest of the
    // tree re-initialise with the impersonated session token.
    window.location.replace('/')
  }, [])

  const finishError = useCallback((message: string) => {
    // An error surfaced by the single redeem attempt is real: the token was
    // rejected (single-use, 15-minute TTL). No remount can fix that, so
    // unlike the success path this is intentionally once-per-page-load —
    // the fired guard above means a second attempt never happens anyway.
    setPhase({ kind: 'error', message })
  }, [])

  useEffect(() => {
    if (fired.current) return
    if (succeededRef.current) {
      // Remount after the async flow already completed (StrictMode):
      // re-drive the transition that mount1's stale cancelled flag suppressed.
      completeSuccess()
      return
    }
    fired.current = true

    if (!token) {
      finishError('Missing impersonation token in the URL.')
      return
    }

    ;(async () => {
      try {
        const result = await redeemImpersonationToken(token)
        // Fetch /me so the impersonation banner can read the target email
        // out of session state. On failure we still mark success — the
        // banner will resolve the email lazily on the next /me poll.
        try {
          const me = await getMe()
          if (me.email) {
            sessionStorage.setItem('bb_impersonating_email', me.email)
          }
        } catch {
          /* non-fatal — the banner will show without an email until /me succeeds */
        }
        if (result.admin_user_id) {
          sessionStorage.setItem('bb_impersonating_admin_id', result.admin_user_id)
        }
        // Task 1691 follow-up: NOT gated on `cancelled` — see succeededRef
        // above. The redeem succeeded; this page load is done either way.
        completeSuccess()
      } catch (err) {
        // Task 1691 follow-up: NOT gated on `cancelled` either — under
        // StrictMode the stale cleanup flag would suppress the error screen
        // exactly like it suppressed the success transition (mount2 sits on
        // "Starting support view" forever). The attempt is once-per-page-load
        // (fired ref), so a remount cannot change the outcome; show it.
        const message =
          err instanceof Error
            ? err.message
            : 'This impersonation link has expired or already been used.'
        finishError(message)
      }
    })()

    // No cancellation cleanup: the flow's transitions are deliberately NOT
    // gated on a per-mount cancelled flag (task 1691 follow-up — the stale
    // flag was exactly what stranded the page). A genuinely unmounted
    // component's setPhase is a harmless no-op in React 18+.
  }, [token, completeSuccess, finishError])

  return (
    <div className="auth-bg min-h-screen flex flex-col items-center justify-center bg-paper px-4 py-6 sm:p-xl">
      <div className="auth-card w-full max-w-[28rem] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        <div className="px-5 py-4 sm:px-xl sm:py-lg border-b border-line">
          <BBLogo size={16} />
        </div>
        <div className="px-5 py-6 sm:px-xl sm:py-lg">
          {phase.kind === 'redeeming' && (
            <div className="flex flex-col items-center text-center gap-3 py-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
              <h2 className="text-lg font-semibold text-ink mt-2">Starting support view</h2>
              <p className="text-[13px] text-ink-3 leading-relaxed max-w-[26rem]">
                Validating impersonation link and signing you in as the target user.
              </p>
            </div>
          )}
          {phase.kind === 'success' && (
            <div className="flex flex-col items-center text-center gap-3 py-2">
              <Icon name="check" size={20} className="text-green" />
              <h2 className="text-lg font-semibold text-ink">Signed in</h2>
              <p className="text-[13px] text-ink-3 leading-relaxed">Redirecting to the drive…</p>
            </div>
          )}
          {phase.kind === 'error' && (
            <div className="flex flex-col items-center text-center gap-3 py-2">
              <Icon name="x" size={20} className="text-red" />
              <h2 className="text-lg font-semibold text-ink">Link unavailable</h2>
              <p className="text-[13px] text-ink-3 leading-relaxed max-w-[26rem]">
                This impersonation link has expired or already been used. Ask the admin to
                generate a fresh link.
              </p>
              <p className="text-[11px] text-ink-4 font-mono mt-1 break-all">{phase.message}</p>
              <div className="mt-3">
                <BBButton variant="ghost" size="sm" onClick={() => navigate('/login', { replace: true })}>
                  Return to login
                </BBButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
