import { useCallback, useEffect, useRef, useState, type Ref } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { cancelEraseRequest, createEraseRequest, getEraseRequest } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { sharedEraseStatus } from '../lib/erase-status-store'
import {
  attachEraseRefresh,
  cancelErase,
  cancelNote,
  createLatestGate,
  eraseCard,
  eraseRefreshPlan,
  formatDue,
  itemsLabel,
  type EraseCard,
  type EraseDeps,
  type EraseStatus,
} from '../lib/erase-request'

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
 */
const ERASE_DEPS: EraseDeps = { create: createEraseRequest, cancel: cancelEraseRequest, status: getEraseRequest }

type BannerCard = Extract<EraseCard, { kind: 'awaiting' | 'pending' | 'moving' }>

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
    text = `You asked to erase all files in this account (${itemsLabel(card.request.item_count)}). Nothing happens unless you confirm it with the link we emailed you.`
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
  const [card, setCard] = useState<BannerCard | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [checkAgain, setCheckAgain] = useState(false)
  const [focusTick, setFocusTick] = useState(0)
  const noteRef = useRef<HTMLParagraphElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const alive = useRef(true)
  const gate = useRef(createLatestGate())

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const show = useCallback((status: EraseStatus) => {
    const next = eraseCard(status)
    setCard(next.kind === 'awaiting' || next.kind === 'pending' || next.kind === 'moving' ? next : null)
  }, [])

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!key) return
      const seq = gate.current.begin()
      try {
        const status = await sharedEraseStatus.read(key, { force: opts.force === true })
        if (!alive.current || !gate.current.isLatest(seq) || !status) return
        show(status)
        if (opts.force) setCheckAgain(false)
      } catch {
        // No banner without a status; the next refresh tries again.
      }
    },
    [key, show],
  )

  useEffect(() => {
    void load()
  }, [load])

  const refreshKey = card ? `${card.kind}:${card.request.due_at}` : 'none'
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    // Focus and visibility go through the cache (a fresh answer is reused for 30 s).
    return attachEraseRefresh({ win: window, doc: document, refresh: () => void load(), plan: eraseRefreshPlan(card, Date.now()) })
    // The plan only changes with the card's kind and due time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, load])

  useEffect(() => {
    if (focusTick > 0) (errorRef.current ?? noteRef.current)?.focus()
  }, [focusTick])

  const cancel = useCallback(async () => {
    if (!card) return
    setBusy(true)
    setError('')
    setNote('')
    setCheckAgain(false)
    const outcome = await cancelErase(ERASE_DEPS, card.request.id)
    if (!alive.current) return
    setBusy(false)
    gate.current.supersede()
    sharedEraseStatus.invalidate()
    if (outcome.kind === 'still_pending') {
      setError(outcome.message)
    } else {
      setNote(cancelNote(outcome) ?? '')
      if (outcome.kind === 'replaced') show(outcome.status)
      else if (outcome.kind === 'unknown') setCheckAgain(true)
      else if (outcome.kind !== 'already_started') setCard(null)
    }
    setFocusTick((n) => n + 1)
    void load({ force: true })
  }, [card, load, show])

  return (
    <EraseRequestBannerView
      card={card}
      busy={busy}
      note={note}
      error={error}
      onCancel={() => void cancel()}
      noteRef={noteRef}
      errorRef={errorRef}
      checkAgain={checkAgain}
      onCheckAgain={() => void load({ force: true })}
    />
  )
}
