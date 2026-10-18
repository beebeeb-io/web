import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { BBButton } from '@beebeeb/shared'
import { getEraseRequest, restoreEraseRequest } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { sharedEraseStatus } from '../lib/erase-status-store'
import {
  RESTORE_DONE_TEXT,
  RESTORE_POLL_MS,
  createLatestGate,
  formatEraseDate,
  inTrashText,
  parseEraseStatus,
  restoreEverything,
  restoreLabel,
  restoreOffer,
  restoreErrorAfterRead,
  restoreProgressText,
  restoreUpdate,
  type EraseExecuted,
  type EraseStatus,
  type LatestGate,
  type RestoreErrorKind,
  type RestoreDeps,
  type RestoreOffer,
} from '../lib/erase-request'

/**
 * Task 1918 round 4 — "Restore everything from the erase on <date>".
 *
 * An erase moves every file and folder to the trash; the owner must be able to bring all of it
 * back in ONE action, whatever its size. The server restores it in batches (server#232 round 4,
 * `POST /api/v1/account/erase-request/{id}/restore`); this block starts it, shows progress while
 * the server continues ("<n> restored, <m> still in the trash", read every 5 s) and says when
 * nothing of the erase is left in the trash. It is drawn where the owner looks after an erase:
 * the locked screen's card, the Trash page, and the empty drive.
 *
 * Round 4b (web#174 review):
 * - one sequencing authority: the block reads through the gate it is given (the locked screen
 *   passes its own), so a late read from either side never overwrites a newer action;
 * - a status that no longer carries this erase stops the polling and says so;
 * - counts, not "everything is back" (items may have been deleted for good one by one);
 * - an error is cleared once a later read shows progress; an unknown outcome has a real
 *   "Check again" button;
 * - after an action the error (if any) takes the focus, else the result line. The result line is
 *   one `role="status"` live region; an error is `role="alert"`.
 *
 * Round 4c (web#174 review):
 * - the counts never come from a cache older than the person's own action: the offers read fresh
 *   on mount, and starting or finishing a restore invalidates the shared status cache;
 * - after a refused or unknown outcome the block reads once, so the true state shows; after an
 *   UNKNOWN outcome any fresh status replaces the error with the truth ("The restore did not
 *   start." when it shows none), while a definite refusal's error stays until the next click;
 * - a status that no longer carries this erase still goes to the parent (`onStatus`).
 */
export const RESTORE_DEPS: RestoreDeps = { restore: restoreEraseRequest, status: getEraseRequest }

/** What the block shows: the server's offer, or `lost` when the status no longer carries this erase. */
export type RestoreView = RestoreOffer | 'lost'

export const RESTORE_LOST_TEXT = "The restore can't be followed here any more. Trash shows what is still there."

export interface RestoreFromEraseViewProps {
  executed: EraseExecuted
  offer: RestoreView
  busy: boolean
  rowsRestored: number
  inTrash: number | null
  error: string
  onRestore: () => void
  /** The last outcome is unknown: draw "Check again" (round 4b). */
  checkAgain?: boolean
  onCheckAgain?: () => void
  /** A plain line next to the offer, e.g. "The restore did not start." (round 4c). */
  notice?: string
  resultRef?: Ref<HTMLParagraphElement>
  errorRef?: Ref<HTMLParagraphElement>
}

/** Pure presentation (SSR-tested in `test/1918-erase-request-r4*.test.tsx`). */
export function RestoreFromEraseView(props: RestoreFromEraseViewProps) {
  const { executed, offer } = props
  if (offer === 'none') return null
  const status =
    offer === 'running'
      ? `${restoreProgressText(props.rowsRestored, props.inTrash)}. The rest follows in the background; this updates by itself.`
      : offer === 'done'
        ? RESTORE_DONE_TEXT
        : offer === 'lost'
          ? RESTORE_LOST_TEXT
          : (props.notice ?? '')
  const left = inTrashText(props.inTrash)
  return (
    <div className="rounded-lg border border-line bg-paper px-3.5 py-3 mb-2.5 text-left" data-testid="erase-restore">
      {offer === 'offer' && (
        <>
          <p className="text-[12px] text-ink-2 leading-relaxed mb-2" data-testid="erase-restore-left">
            {left ?? 'Files from this erase are still in the trash'}
            {executed.restorable_until ? (
              <>
                {' '}until <span className="text-ink">{formatEraseDate(executed.restorable_until)}</span>
              </>
            ) : null}
            . Folders come back where they were.
          </p>
          <BBButton
            type="button"
            variant="amber"
            size="sm"
            onClick={props.onRestore}
            disabled={props.busy}
            data-testid="erase-restore-button"
          >
            {props.busy ? 'Starting the restore…' : restoreLabel(executed)}
          </BBButton>
        </>
      )}
      <p
        ref={props.resultRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={`text-[12px] text-ink-2 leading-relaxed outline-none ${status ? 'mt-1' : 'sr-only'}`}
        data-testid="erase-restore-status"
      >
        {status}
      </p>
      {props.error && (
        <p ref={props.errorRef} tabIndex={-1} role="alert" className="text-[12px] text-red mt-2 outline-none" data-testid="erase-restore-error">
          {props.error}
        </p>
      )}
      {props.checkAgain && props.onCheckAgain && (
        <BBButton type="button" variant="default" size="sm" className="mt-2" onClick={props.onCheckAgain} data-testid="erase-restore-check-again">
          Check again
        </BBButton>
      )}
    </div>
  )
}

export interface RestoreFromEraseProps {
  executed: EraseExecuted
  deps?: RestoreDeps
  /**
   * The sequencing authority (round 4b). The locked screen passes its own gate, so the block's
   * reads and the screen's reads and actions are ordered by ONE counter.
   */
  gate?: LatestGate
  /** A fresh status the block read; it started after every action the gate knows of. */
  onStatus?: (status: EraseStatus) => void
  /** Nothing of the erase is left in the trash (the parent re-reads / refreshes its listing). */
  onDone?: () => void
  pollMs?: number
}

/** The stateful block: starts the restore, polls while it runs, reports when it is done. */
export function RestoreFromErase({ executed, deps = RESTORE_DEPS, gate, onStatus, onDone, pollMs = RESTORE_POLL_MS }: RestoreFromEraseProps) {
  const [shown, setShown] = useState<EraseExecuted>(executed)
  const [lost, setLost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Round 4c: a definite refusal's error stays until the next click; an unknown one is replaced
  // by the next fresh status.
  const errorKind = useRef<RestoreErrorKind>(null)
  const [notice, setNotice] = useState('')
  const [checkAgain, setCheckAgain] = useState(false)
  const resultRef = useRef<HTMLParagraphElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [focusTick, setFocusTick] = useState(0)
  const alive = useRef(true)
  const ownGate = useRef<LatestGate>(createLatestGate())
  const seqGate = gate ?? ownGate.current
  const doneReported = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The parent read a newer status: follow it.
  useEffect(() => {
    setShown(executed)
    setLost(false)
  }, [executed])

  const offer: RestoreView = lost ? 'lost' : restoreOffer(shown)

  const applyStatus = useCallback(
    (status: EraseStatus) => {
      const update = restoreUpdate(shown.id, status)
      const after = restoreErrorAfterRead(errorKind.current, update.kind === 'lost' ? null : update.executed)
      if (after.clear) {
        setError('')
        errorKind.current = null
      }
      if (after.notice) setNotice(after.notice)
      setCheckAgain(false)
      if (update.kind === 'lost') {
        // This erase is no longer the account's last one (or it aged out): stop following it,
        // and still hand the status to the parent (its card follows it).
        setLost(true)
        onStatus?.(status)
        return
      }
      setShown(update.executed)
      onStatus?.(status)
    },
    [shown.id, onStatus],
  )

  const poll = useCallback(async () => {
    const seq = seqGate.begin()
    try {
      const status = parseEraseStatus(await deps.status())
      if (!alive.current || !seqGate.isLatest(seq) || !status) return
      applyStatus(status)
    } catch {
      // the next poll tries again
    }
  }, [deps, applyStatus, seqGate])

  useEffect(() => {
    if (offer !== 'running') return
    const id = setInterval(() => void poll(), pollMs)
    return () => clearInterval(id)
  }, [offer, poll, pollMs])

  useEffect(() => {
    if (offer === 'done' && !doneReported.current) {
      doneReported.current = true
      sharedEraseStatus.invalidate()
      onDone?.()
    }
  }, [offer, onDone])

  useEffect(() => {
    if (focusTick > 0) (errorRef.current ?? resultRef.current)?.focus()
  }, [focusTick])

  const start = useCallback(async () => {
    setBusy(true)
    setError('')
    errorKind.current = null
    setNotice('')
    setCheckAgain(false)
    const outcome = await restoreEverything(deps, shown.id)
    if (!alive.current) return
    setBusy(false)
    // The answer is newer than any read still in flight, on either side, and newer than any
    // cached status (round 4c).
    seqGate.supersede()
    sharedEraseStatus.invalidate()
    if (outcome.kind === 'done') {
      setShown((s) => ({
        ...s,
        in_trash: 0,
        restore: { state: 'done', requested_at: s.restore?.requested_at ?? null, rows_restored: outcome.rowsRestored, finished_at: null },
      }))
    } else if (outcome.kind === 'running') {
      setShown((s) => ({
        ...s,
        in_trash: outcome.inTrash ?? s.in_trash,
        restore: { state: 'running', requested_at: s.restore?.requested_at ?? null, rows_restored: outcome.rowsRestored, finished_at: null },
      }))
    } else {
      setError(outcome.message)
      errorKind.current = outcome.kind
      if (outcome.kind === 'unknown') setCheckAgain(true)
      // Round 4c: read once, so the true state (or 'lost') shows.
      void poll()
    }
    setFocusTick((n) => n + 1)
  }, [deps, shown.id, seqGate, poll])

  return (
    <RestoreFromEraseView
      executed={shown}
      offer={offer}
      busy={busy}
      rowsRestored={shown.restore?.rows_restored ?? 0}
      inTrash={shown.in_trash}
      error={error}
      onRestore={() => void start()}
      checkAgain={checkAgain}
      onCheckAgain={() => void poll()}
      notice={notice}
      resultRef={resultRef}
      errorRef={errorRef}
    />
  )
}

/**
 * For pages that do not hold the erase status themselves (Trash, the empty drive): reads the
 * status through the shared cache, FRESH on mount (round 4c: the count it shows must not predate
 * the person's own action), and draws the block while something of the last erase is in the
 * trash or a restore runs.
 */
export function RestoreFromEraseOffer({
  onDone,
  className,
}: {
  onDone?: () => void
  /** Wraps the block (only when it is drawn), e.g. page padding. */
  className?: string
}) {
  const { user } = useAuth()
  const key = user?.user_id ?? ''
  const [executed, setExecuted] = useState<EraseExecuted | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    // Round 4c: fresh, never a cached count from before the person's own action.
    sharedEraseStatus.read(key, { force: true }).then(
      (status) => {
        if (live && status) setExecuted(status.last_executed)
      },
      () => {
        // no offer without a status
      },
    )
    return () => {
      live = false
    }
  }, [key])
  // The block polls through the same cache, forced (progress must be fresh), so the banner and
  // the other offer see it too.
  const deps = useMemo<RestoreDeps>(
    () => ({ restore: restoreEraseRequest, status: () => sharedEraseStatus.read(key, { force: true }) }),
    [key],
  )
  // Only while there is something to restore (or a restore runs): a restore that finished on
  // another day is not news on every visit.
  if (!executed) return null
  const offer = restoreOffer(executed)
  if (offer !== 'offer' && offer !== 'running') return null
  return (
    <div className={className}>
      <RestoreFromErase executed={executed} deps={deps} onDone={onDone} />
    </div>
  )
}
