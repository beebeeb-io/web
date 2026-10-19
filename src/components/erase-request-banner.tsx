import { useEffect, useRef, useSyncExternalStore, type Ref } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { cancelEraseRequest, createEraseRequest, getEraseRequest } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { sharedEraseStatus } from '../lib/erase-status-store'
import { formatDue, type EraseDeps } from '../lib/erase-request'
import { createBannerController, type BannerCard, type BannerController } from '../lib/erase-banner-controller'

/**
 * Task 1918 round 4 (web#174 review) — a pending "erase all files" request, shown in the UNLOCKED
 * web app with a Cancel button.
 *
 * The request is made on the locked screen. A person who confirms it and then finds their
 * recovery phrase (or signs in on a device that holds the key) no longer sees that screen; without
 * this banner the drive showed nothing at all while every file was about to move to the trash.
 * With it, the copy elsewhere can say truthfully where cancelling works: on the locked screen,
 * with the email link, or in Beebeeb on the web while signed in.
 *
 * It reads the status through the app's shared, cached read (`erase-status-store.ts`, round 4b:
 * reused for 30 s, so a navigation does not cost a request): on mount, on focus, when the tab
 * becomes visible and every minute while a request is pending; after a cancel it reads fresh. It
 * draws nothing when there is no request.
 *
 * Round 4c (web#174 review): the banner shows no counts (only what the cache may serve: that a
 * request is waiting or confirmed, and its due time); the due-time timer reads FRESH; and
 * "Check again" after an unknown cancel follows the locked screen's rule (`keepCheckAgain`
 * 'cancel'): a read only hides it once it shows no request pending, and then the note says so.
 *
 * Round 4d: the behaviour lives in `lib/erase-banner-controller.ts`, which the tests drive; the
 * note after an unknown cancel also says when the request had already run, or the move started.
 */
const ERASE_DEPS: EraseDeps = { create: createEraseRequest, cancel: cancelEraseRequest, status: getEraseRequest }

export interface EraseRequestBannerViewProps {
  card: BannerCard | null
  busy: boolean
  note: string
  error: string
  onCancel: () => void
  noteRef?: Ref<HTMLParagraphElement>
  errorRef?: Ref<HTMLParagraphElement>
  /** The last outcome is unknown: draw "Check again" (round 4b). */
  checkAgain?: boolean
  onCheckAgain?: () => void
  nowMs?: number
}

/** Pure presentation (SSR-tested in `test/1918-erase-request-r4.test.tsx`). */
export function EraseRequestBannerView({
  card,
  busy,
  note,
  error,
  onCancel,
  noteRef,
  errorRef,
  checkAgain,
  onCheckAgain,
  nowMs = Date.now(),
}: EraseRequestBannerViewProps) {
  if (!card && !note && !error) return null
  let text = ''
  if (card?.kind === 'awaiting') {
    text = 'You asked to erase all files in this account. Nothing happens unless you confirm it with the link we emailed you.'
  } else if (card?.kind === 'pending' && card.request.due_at) {
    text =
      Date.parse(card.request.due_at) <= nowMs
        ? 'Erase confirmed: every file and folder in this account moves to the trash shortly. Nothing has moved yet.'
        : `Erase confirmed: every file and folder in this account moves to the trash on ${formatDue(card.request.due_at)}.`
  } else if (card?.kind === 'moving') {
    text = 'Every file and folder in this account is moving to the trash now. Everything can be restored from Trash.'
  }
  return (
    <div
      className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-red/30 bg-red/5 text-[12.5px] text-ink"
      data-testid="erase-banner"
    >
      <Icon name="trash" size={12} className="text-red shrink-0" />
      {text && <span className="flex-1 min-w-[16rem] text-ink-2">{text}</span>}
      {card && card.kind !== 'moving' && (
        <BBButton type="button" variant="default" size="sm" onClick={onCancel} disabled={busy} data-testid="erase-banner-cancel">
          {busy ? 'Cancelling…' : card.kind === 'awaiting' ? 'Cancel the request' : 'Cancel the erase'}
        </BBButton>
      )}
      <p
        ref={noteRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={`text-ink-2 outline-none ${note ? 'basis-full' : 'sr-only'}`}
        data-testid="erase-banner-note"
      >
        {note}
      </p>
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="basis-full text-red outline-none" data-testid="erase-banner-error">
          {error}
        </p>
      )}
      {checkAgain && onCheckAgain && (
        <BBButton type="button" variant="default" size="sm" onClick={onCheckAgain} data-testid="erase-banner-check-again">
          Check again
        </BBButton>
      )}
    </div>
  )
}

export function EraseRequestBanner() {
  const { user } = useAuth()
  const key = user?.user_id ?? ''
  const ctrl = useBannerController(key)
  const state = useSyncExternalStore(ctrl.subscribe, ctrl.getState, ctrl.getState)
  const noteRef = useRef<HTMLParagraphElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (state.focusTick > 0) (errorRef.current ?? noteRef.current)?.focus()
  }, [state.focusTick])
  return (
    <EraseRequestBannerView
      card={state.card}
      busy={state.busy}
      note={state.note}
      error={state.error}
      onCancel={() => void ctrl.cancel()}
      noteRef={noteRef}
      errorRef={errorRef}
      checkAgain={state.checkAgain}
      onCheckAgain={() => void ctrl.checkAgain()}
    />
  )
}

/** One controller per account, attached while mounted. */
function useBannerController(key: string): BannerController {
  const ref = useRef<{ key: string; ctrl: BannerController } | null>(null)
  if (ref.current === null || ref.current.key !== key) {
    ref.current = {
      key,
      ctrl: createBannerController({
        cache: sharedEraseStatus,
        key,
        deps: ERASE_DEPS,
        win: typeof window === 'undefined' ? new EventTarget() : window,
        doc: typeof document === 'undefined' ? new EventTarget() : document,
      }),
    }
  }
  const ctrl = ref.current.ctrl
  useEffect(() => {
    ctrl.attach()
    return () => ctrl.detach()
  }, [ctrl])
  return ctrl
}
