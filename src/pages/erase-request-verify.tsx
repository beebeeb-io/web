import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { AuthShellFrame } from '../components/auth-shell-frame'
import { cancelByLink, readCancelToken, verifyByLink, type LinkVerifyResult } from '../lib/erase-request-link'
import { formatDue, itemsLabel } from '../lib/erase-request'

/**
 * `/erase-request/verify#t=<token>` (task 1918, round 3): the confirmation link from the email the
 * account address gets when someone asks, on the locked screen, to erase every file. Guus,
 * 2026-10-18: "Mm erase all files then requires email verify" / "Verify link + 72 h". Nothing is
 * scheduled until this link is used; the 72-hour wait starts at the click, and a request nobody
 * confirms lapses after 24 hours.
 *
 * Vault-free and network-quiet like the cancel page: no session, no crypto worker, no credentialed
 * request. The token is read once from the URL fragment (never sent to any server by the browser),
 * removed from the address bar, and posted in a JSON body.
 *
 * This page does NOT act on load. Confirming is the dangerous direction, and mail scanners open
 * links and run their JavaScript; a page that confirmed on load would let a scanner confirm an
 * erase the owner never saw. So it says what will happen and waits for a click.
 *
 * Round 4 (web#174 review): a reload after the token was read says "Open the link from your email
 * again" (never that the request was cancelled or ran); the page names only the places where
 * cancelling really works; it promises a confirmation email only when the server sent one; and the
 * outcome of Confirm and Cancel is announced (one live region) and takes the focus.
 */
export type CancelState = 'idle' | 'working' | 'invalid' | 'unavailable' | 'rate-limited'

export type VerifyView =
  | { kind: 'ready' }
  | { kind: 'working' }
  | (Extract<LinkVerifyResult, { kind: 'verified' }> & { cancel: CancelState })
  | Extract<LinkVerifyResult, { kind: 'already' | 'expired' | 'invalid' | 'unavailable' }>
  | { kind: 'cancelled' }
  /** No token in the address (a reload after it was read, or a cut-off link). */
  | { kind: 'reopen' }

const COOLDOWN_HOURS = 72

/** Where cancelling really works (round 4). Never "any device". */
const CANCEL_WHERE_SIGNED_IN = "on the locked screen or in Beebeeb on the web while you're signed in"

/** The sentence the live region announces after an action (round 4). */
export function verifyAnnouncement(view: VerifyView): string {
  switch (view.kind) {
    case 'verified':
      if (view.cancel === 'invalid') return 'This page could not cancel it.'
      if (view.cancel === 'unavailable' || view.cancel === 'rate-limited') return 'The cancel is unconfirmed.'
      return `Erase confirmed. Every file moves to the trash on ${formatDue(view.dueAt)}.`
    case 'already':
      return 'Already confirmed. Nothing changed.'
    case 'expired':
      return 'The confirmation link expired. Nothing will be moved.'
    case 'invalid':
      return 'This link does not work any more.'
    case 'unavailable':
      return view.rateLimited ? 'Too many tries. Nothing was processed.' : 'We could not reach Beebeeb. The outcome is unknown.'
    case 'cancelled':
      return 'Erase cancelled. Nothing will be moved to the trash.'
    default:
      return ''
  }
}

export function EraseRequestVerifyPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const tokenRef = useRef<string | null | undefined>(undefined)

  // Read once (StrictMode runs effects twice; the ref keeps the first read).
  if (tokenRef.current === undefined) tokenRef.current = readCancelToken(location.hash)
  const [view, setView] = useState<VerifyView>(() => (tokenRef.current ? { kind: 'ready' } : { kind: 'reopen' }))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const acted = useRef(false)

  useEffect(() => {
    if (location.hash) navigate(location.pathname, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After an action, the result's heading takes the focus (round 4).
  useEffect(() => {
    if (!acted.current || view.kind === 'working') return
    if (view.kind === 'verified' && view.cancel === 'working') return
    titleRef.current?.focus()
  }, [view])

  const confirm = async () => {
    const token = tokenRef.current
    if (!token) {
      setView({ kind: 'reopen' })
      return
    }
    acted.current = true
    setView({ kind: 'working' })
    const result = await verifyByLink(token)
    setView(result.kind === 'verified' ? { ...result, cancel: 'idle' } : result)
  }

  const cancel = async () => {
    if (view.kind !== 'verified' || !view.cancelToken) return
    const verified = view
    const token = view.cancelToken
    acted.current = true
    setView({ ...verified, cancel: 'working' })
    const result = await cancelByLink(token)
    if (result.kind === 'cancelled') {
      setView({ kind: 'cancelled' })
      return
    }
    const cancelState: CancelState =
      result.kind === 'invalid' ? 'invalid' : result.rateLimited ? 'rate-limited' : 'unavailable'
    setView({ ...verified, cancel: cancelState })
  }

  return <EraseVerifyView view={view} onConfirm={() => void confirm()} onCancel={() => void cancel()} titleRef={titleRef} />
}

export interface EraseVerifyViewProps {
  view: VerifyView
  onConfirm: () => void
  onCancel: () => void
  titleRef?: React.Ref<HTMLHeadingElement>
}

/** Pure presentation of every state (SSR-tested in `test/1918-erase-request-r3/r4.test.tsx`). */
export function EraseVerifyView({ view, onConfirm, onCancel, titleRef }: EraseVerifyViewProps) {
  const { title, body } = verifyContent(view, onConfirm, onCancel)
  return (
    <AuthShellFrame title={title} hideTrust titleRef={titleRef}>
      {body}
      {/* One live region for the outcome, mounted in every state so the change is announced. */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="erase-verify-live">
        {verifyAnnouncement(view)}
      </p>
    </AuthShellFrame>
  )
}

function verifyContent(view: VerifyView, onConfirm: () => void, onCancel: () => void): { title: string; body: React.ReactNode } {
  if (view.kind === 'ready' || view.kind === 'working') {
    return {
      title: 'Confirm: erase all files?',
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-verify-ready">
          <p>
            Someone signed in to this Beebeeb account asked to move every file and folder in it to the trash. Nothing
            happens unless you confirm here.
          </p>
          <p>
            Confirming starts a {COOLDOWN_HOURS}-hour wait. When it ends, everything moves to the trash, where it can
            still be restored before it is deleted for good. Until the move starts you can cancel it with the link in
            the email, {CANCEL_WHERE_SIGNED_IN}.
          </p>
          <p>
            If you didn't ask for this, don't confirm. Close this page: an unconfirmed request lapses after 24 hours
            and nothing moves. Then change your password.
          </p>
          <BBButton
            type="button"
            variant="danger"
            size="lg"
            className="w-full"
            disabled={view.kind === 'working'}
            onClick={onConfirm}
            data-testid="erase-verify-confirm"
          >
            {view.kind === 'working' ? 'Confirming…' : 'Confirm the erase'}
          </BBButton>
        </div>
      ),
    }
  }

  if (view.kind === 'verified') {
    const emailed = view.confirmationEmailSent !== false
    return {
      title: 'Erase confirmed',
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-verify-verified">
          <p>
            On <span className="text-ink font-medium">{formatDue(view.dueAt)}</span> every file and folder in the
            account moves to the trash ({itemsLabel(view.itemCount)} when you asked).{' '}
            {view.retentionDays != null
              ? `They can be restored from there for ${view.retentionDays} days before they are deleted for good.`
              : 'They can be restored from there before they are deleted for good.'}
          </p>
          {emailed ? (
            <p>
              Changed your mind? Until the move starts you can cancel it here, with the link in the email we just sent,
              {' '}{CANCEL_WHERE_SIGNED_IN}.
            </p>
          ) : (
            <p data-testid="erase-verify-no-email">
              We could not send the confirmation email. Changed your mind? Until the move starts you can cancel it here,
              with the cancel link in the first email, {CANCEL_WHERE_SIGNED_IN}.
            </p>
          )}
          {view.cancel === 'invalid' && (
            <p role="alert" className="text-red" data-testid="erase-verify-cancel-error">
              This page could not cancel it: the request was already cancelled or the move has started. Sign in to see
              where things stand.
            </p>
          )}
          {(view.cancel === 'unavailable' || view.cancel === 'rate-limited') && (
            <p role="alert" className="text-red" data-testid="erase-verify-cancel-error">
              {view.cancel === 'rate-limited'
                ? 'Too many tries from this network just now, so the cancel was not processed. Wait a minute, then try again.'
                : "We could not reach Beebeeb, so we can't tell whether it was cancelled. Try again, or use the link in the email."}
            </p>
          )}
          {view.cancelToken && (
            <BBButton
              type="button"
              variant="amber"
              size="lg"
              className="w-full"
              disabled={view.cancel === 'working'}
              onClick={onCancel}
              data-testid="erase-verify-cancel"
            >
              {view.cancel === 'working' ? 'Cancelling…' : 'Cancel the erase'}
            </BBButton>
          )}
        </div>
      ),
    }
  }

  if (view.kind === 'already') {
    return {
      title: 'Already confirmed',
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-verify-already">
          <p>
            This link was used before; nothing changed now.
            {view.dueAt && (
              <>
                {' '}
                On <span className="text-ink font-medium">{formatDue(view.dueAt)}</span> every file and folder in the
                account moves to the trash.
              </>
            )}
          </p>
          <p>To cancel, use the cancel link in the email, or sign in: you can cancel it {CANCEL_WHERE_SIGNED_IN}.</p>
          <a href="/login" className="text-amber-deep font-medium hover:underline">
            Go to sign in
          </a>
        </div>
      ),
    }
  }

  if (view.kind === 'expired') {
    return {
      title: 'The confirmation link expired',
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-verify-expired">
          <p>
            An erase has to be confirmed within 24 hours. This one wasn't, so it lapsed: nothing was moved, and nothing
            will be.
          </p>
          <p>To erase the files after all, ask again from the locked screen.</p>
        </div>
      ),
    }
  }

  if (view.kind === 'cancelled') {
    return {
      title: 'Erase cancelled',
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-verify-cancelled">
          <p>Nothing will be moved to the trash. Your files stay where they are.</p>
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
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-verify-reopen">
          <p>
            This page works only with the link from the email. It forgets the link as soon as it has read it, so a
            reload cannot use it again.
          </p>
          <p>Open the confirmation link in the email once more. Nothing has been confirmed or cancelled from this page.</p>
        </div>
      ),
    }
  }

  if (view.kind === 'invalid') {
    return {
      title: 'This link does not work any more',
      body: (
        <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-verify-invalid">
          <p>The request it belongs to was cancelled or has already run.</p>
          <p>
            Sign in to see where things stand. Anything that was moved is in the trash, where it can still be restored
            before it is deleted for good.
          </p>
          <a href="/login" className="text-amber-deep font-medium hover:underline">
            Go to sign in
          </a>
        </div>
      ),
    }
  }

  return {
    title: 'We could not confirm the erase',
    body: (
      <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed" data-testid="erase-verify-unavailable">
        <p role="alert">
          {view.rateLimited
            ? 'Too many tries from this network just now, so this one was not processed. Wait a minute, then try again.'
            : "We could not reach Beebeeb, so we can't tell whether it was confirmed. Try again: if it already went through, this page will say so."}
        </p>
        <BBButton type="button" variant="default" size="lg" className="w-full" onClick={onConfirm}>
          Try again
        </BBButton>
      </div>
    ),
  }
}
