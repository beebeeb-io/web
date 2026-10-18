import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { AuthShellFrame } from '../components/auth-shell-frame'
import { cancelByLink, readCancelToken } from '../lib/erase-request-link'

/**
 * `/erase-request/cancel#t=<token>` (task 1918): the one-click cancel link from the email the
 * account address gets the moment someone asks, on the locked screen, to erase every file.
 *
 * Vault-free and network-quiet like the survey page: no session, no crypto worker, no
 * credentialed request (`AuthShellFrame`, not `AuthShell`). The token is read once from the
 * URL fragment (never sent to any server by the browser), removed from the address bar, and
 * posted in a JSON body. The page cancels on load: that is the safe direction, so a mail
 * scanner opening the link can only stop an erase.
 */
type View =
  | { kind: 'working' }
  | { kind: 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'unavailable'; rateLimited: boolean }

export function EraseRequestCancelPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const tokenRef = useRef<string | null | undefined>(undefined)
  const [view, setView] = useState<View>({ kind: 'working' })

  // Read once (StrictMode runs effects twice; the ref keeps the first read).
  if (tokenRef.current === undefined) tokenRef.current = readCancelToken(location.hash)

  const run = async () => {
    const token = tokenRef.current
    if (!token) {
      setView({ kind: 'invalid' })
      return
    }
    setView({ kind: 'working' })
    setView(await cancelByLink(token))
  }

  const started = useRef(false)
  useEffect(() => {
    if (location.hash) navigate(location.pathname, { replace: true })
    if (started.current) return
    started.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (view.kind === 'working') {
    return (
      <AuthShellFrame title="Cancelling the erase" hideTrust>
        <p className="text-[13px] text-ink-3" data-testid="erase-link-working">One moment…</p>
      </AuthShellFrame>
    )
  }

  if (view.kind === 'cancelled') {
    return (
      <AuthShellFrame title="Erase cancelled" hideTrust>
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-link-cancelled">
          <p>Nothing will be moved to the trash. Your files stay where they are.</p>
          <p>
            If you didn't ask for the erase yourself, someone else knows your password or can read your
            email. Reset your password now.
          </p>
          <a href="/login" className="text-amber-deep font-medium hover:underline">
            Go to sign in
          </a>
        </div>
      </AuthShellFrame>
    )
  }

  if (view.kind === 'invalid') {
    return (
      <AuthShellFrame title="This link does not work any more" hideTrust>
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-link-invalid">
          <p>It was already used, or the time to cancel has passed.</p>
          <p>
            If the wait is over, the files are in the trash, where they can still be restored before they are
            deleted for good. Sign in to see where things stand.
          </p>
          <a href="/login" className="text-amber-deep font-medium hover:underline">
            Go to sign in
          </a>
        </div>
      </AuthShellFrame>
    )
  }

  return (
    <AuthShellFrame title="We could not confirm the cancel" hideTrust>
      <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-link-unavailable">
        <p>
          {view.rateLimited
            ? 'Too many tries from this network just now, so this one was not processed. Wait a minute, then try again.'
            : "We could not reach Beebeeb, so we can't tell whether it was cancelled. Try again: if it already went through, this page will say the link was used."}
        </p>
        <BBButton type="button" variant="amber" size="lg" className="w-full" onClick={() => void run()}>
          Try again
        </BBButton>
      </div>
    </AuthShellFrame>
  )
}
