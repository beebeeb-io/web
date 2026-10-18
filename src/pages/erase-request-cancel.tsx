import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { AuthShellFrame } from '../components/auth-shell-frame'
import { cancelByLink, readCancelToken } from '../lib/erase-request-link'

/**
 * `/erase-request/cancel#t=<token>` (task 1918): the cancel link from the erase-request emails
 * (the notice, and the confirmation email's second link).
 *
 * Vault-free and network-quiet like the survey page: no session, no crypto worker, no
 * credentialed request (`AuthShellFrame`, not `AuthShell`). The token is read once from the URL
 * fragment (never sent to any server by the browser), removed from the address bar, and posted in
 * a JSON body.
 *
 * Round 4 (server#232 / web#174 review): the page waits for ONE click on "Cancel the erase" and
 * never acts on load. The cancel link arrives in the same email as the confirmation link, and
 * mail scanners open links and run their JavaScript: a page that cancelled on load let a scanner
 * cancel every request (and use up the 3-a-day limit) before the owner could confirm. A reload
 * after the token was read finds no token and says to open the link from the email again,
 * instead of claiming anything about the request; the token is never stored.
 */
export type CancelView =
  | { kind: 'ready' }
  | { kind: 'working' }
  | { kind: 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'unavailable'; rateLimited: boolean }
  /** No token in the address (a reload after it was read, or a cut-off link). */
  | { kind: 'reopen' }

/** The sentence the live region announces after an action (round 4). */
export function cancelAnnouncement(view: CancelView): string {
  switch (view.kind) {
    case 'cancelled':
      return 'Erase cancelled. Nothing will be moved to the trash.'
    case 'invalid':
      return 'This link can no longer cancel anything.'
    case 'unavailable':
      return view.rateLimited ? 'Too many tries. The cancel was not processed.' : 'We could not reach Beebeeb. The cancel is unconfirmed.'
    default:
      return ''
  }
}

export function EraseRequestCancelPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const tokenRef = useRef<string | null | undefined>(undefined)

  // Read once (StrictMode runs effects twice; the ref keeps the first read).
  if (tokenRef.current === undefined) tokenRef.current = readCancelToken(location.hash)
  const [view, setView] = useState<CancelView>(() => (tokenRef.current ? { kind: 'ready' } : { kind: 'reopen' }))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const acted = useRef(false)

  useEffect(() => {
    if (location.hash) navigate(location.pathname, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After an action, the result's heading takes the focus (round 4).
  useEffect(() => {
    if (acted.current && view.kind !== 'working') titleRef.current?.focus()
  }, [view])

  const cancel = async () => {
    const token = tokenRef.current
    if (!token) {
      setView({ kind: 'reopen' })
      return
    }
    acted.current = true
    setView({ kind: 'working' })
    setView(await cancelByLink(token))
  }

  return <EraseCancelView view={view} onCancel={() => void cancel()} titleRef={titleRef} />
}

export interface EraseCancelViewProps {
  view: CancelView
  onCancel: () => void
  titleRef?: React.Ref<HTMLHeadingElement>
}

/** Pure presentation of every state (SSR-tested in `test/1918-erase-request-r4.test.tsx`). */
export function EraseCancelView({ view, onCancel, titleRef }: EraseCancelViewProps) {
  const { title, body } = cancelContent(view, onCancel)
  return (
    <AuthShellFrame title={title} hideTrust titleRef={titleRef}>
      {body}
      {/* One live region for the outcome, mounted in every state so the change is announced. */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="erase-link-live">
        {cancelAnnouncement(view)}
      </p>
    </AuthShellFrame>
  )
}

function cancelContent(view: CancelView, onCancel: () => void): { title: string; body: React.ReactNode } {
  if (view.kind === 'ready' || view.kind === 'working') {
    return {
      title: 'Cancel the erase?',
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-link-ready">
          <p>
            Someone signed in to this Beebeeb account asked to move every file and folder in it to the trash.
            Cancelling stops that: nothing moves.
          </p>
          <p>If you didn't ask for the erase yourself, cancel it, then reset your password.</p>
          <BBButton
            type="button"
            variant="amber"
            size="lg"
            className="w-full"
            disabled={view.kind === 'working'}
            onClick={onCancel}
            data-testid="erase-link-cancel"
          >
            {view.kind === 'working' ? 'Cancelling…' : 'Cancel the erase'}
          </BBButton>
        </div>
      ),
    }
  }

  if (view.kind === 'cancelled') {
    return {
      title: 'Erase cancelled',
      body: (
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
      ),
    }
  }

  if (view.kind === 'reopen') {
    return {
      title: 'Open the link from your email again',
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-link-reopen">
          <p>
            This page works only with the link from the email, and it forgets the link as soon as it has read it.
            After a reload it can't tell what happened before.
          </p>
          <p>
            Open the cancel link in the email again and click Cancel: the page then says whether there was still a
            request to cancel.
          </p>
        </div>
      ),
    }
  }

  if (view.kind === 'invalid') {
    return {
      title: "This link can't cancel anything now",
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-link-invalid">
          <p>The request it belongs to was already cancelled, it lapsed, or the move to the trash has started.</p>
          <p>
            Sign in to see where things stand. Anything that was moved is in the trash, where it can still be
            restored before it is deleted for good.
          </p>
          <a href="/login" className="text-amber-deep font-medium hover:underline">
            Go to sign in
          </a>
        </div>
      ),
    }
  }

  return {
    title: 'We could not confirm the cancel',
    body: (
      <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-link-unavailable">
        <p role="alert">
          {view.rateLimited
            ? 'Too many tries from this network just now, so this one was not processed. Wait a minute, then try again.'
            : "We could not reach Beebeeb, so we can't tell whether it was cancelled. Try again: if it already went through, this page will say the link can't cancel anything now."}
        </p>
        <BBButton type="button" variant="amber" size="lg" className="w-full" onClick={onCancel}>
          Try again
        </BBButton>
      </div>
    ),
  }
}
