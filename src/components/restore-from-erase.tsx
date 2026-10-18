import { useCallback, useEffect, useRef, useState, type Ref } from 'react'
import { BBButton } from '@beebeeb/shared'
import { getEraseRequest, restoreEraseRequest } from '../lib/api'
import {
  RESTORE_DONE_TEXT,
  RESTORE_POLL_MS,
  createLatestGate,
  formatEraseDate,
  parseEraseStatus,
  restoreEverything,
  restoreLabel,
  restoreOffer,
  restoreProgressText,
  type EraseExecuted,
  type EraseStatus,
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
 * everything is back. It is drawn where the owner looks after an erase: the locked screen's
 * "done" card, the Trash page, and the empty drive.
 *
 * Accessibility (round 4): the outcome line is one `role="status"` live region that takes the
 * focus after the click; an error is `role="alert"`.
 */
export const RESTORE_DEPS: RestoreDeps = { restore: restoreEraseRequest, status: getEraseRequest }

export interface RestoreFromEraseViewProps {
  executed: EraseExecuted
  offer: RestoreOffer
  busy: boolean
  rowsRestored: number
  inTrash: number | null
  error: string
  onRestore: () => void
  resultRef?: Ref<HTMLParagraphElement>
}

/** Pure presentation (SSR-tested in `test/1918-erase-request-r4.test.tsx`). */
export function RestoreFromEraseView(props: RestoreFromEraseViewProps) {
  const { executed, offer } = props
  if (offer === 'none') return null
  const status =
    offer === 'running'
      ? `${restoreProgressText(props.rowsRestored, props.inTrash)}. The rest follows in the background; this updates by itself.`
      : offer === 'done'
        ? RESTORE_DONE_TEXT
        : ''
  return (
    <div className="rounded-lg border border-line bg-paper px-3.5 py-3 mb-2.5 text-left" data-testid="erase-restore">
      {offer === 'offer' && (
        <>
          <p className="text-[12px] text-ink-2 leading-relaxed mb-2">
            Everything this erase moved is in the trash
            {executed.restorable_until ? (
              <>
                {' '}until <span className="text-ink">{formatEraseDate(executed.restorable_until)}</span>
              </>
            ) : null}
            . Bring it all back in one step: folders return where they were.
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
        <p role="alert" className="text-[12px] text-red mt-2" data-testid="erase-restore-error">
          {props.error}
        </p>
      )}
    </div>
  )
}

export interface RestoreFromEraseProps {
  executed: EraseExecuted
  deps?: RestoreDeps
  /** A fresh status the block read (the parent may apply it). */
  onStatus?: (status: EraseStatus) => void
  /** Everything is back (the parent may refresh its listing). */
  onDone?: () => void
  pollMs?: number
}

/** The stateful block: starts the restore, polls while it runs, reports when it is done. */
export function RestoreFromErase({ executed, deps = RESTORE_DEPS, onStatus, onDone, pollMs = RESTORE_POLL_MS }: RestoreFromEraseProps) {
  const [shown, setShown] = useState<EraseExecuted>(executed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resultRef = useRef<HTMLParagraphElement>(null)
  const [focusTick, setFocusTick] = useState(0)
  const alive = useRef(true)
  const gate = useRef(createLatestGate())
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
  }, [executed])

  const offer = restoreOffer(shown)

  const applyStatus = useCallback(
    (status: EraseStatus) => {
      const next = status.last_executed
      if (!next || next.id !== shown.id) return
      setShown(next)
      onStatus?.(status)
    },
    [shown.id, onStatus],
  )

  const poll = useCallback(async () => {
    const seq = gate.current.begin()
    try {
      const status = parseEraseStatus(await deps.status())
      if (!alive.current || !gate.current.isLatest(seq) || !status) return
      applyStatus(status)
    } catch {
      // the next poll tries again
    }
  }, [deps, applyStatus])

  useEffect(() => {
    if (offer !== 'running') return
    const id = setInterval(() => void poll(), pollMs)
    return () => clearInterval(id)
  }, [offer, poll, pollMs])

  useEffect(() => {
    if (offer === 'done' && !doneReported.current) {
      doneReported.current = true
      onDone?.()
    }
  }, [offer, onDone])

  useEffect(() => {
    if (focusTick > 0) resultRef.current?.focus()
  }, [focusTick])

  const start = useCallback(async () => {
    setBusy(true)
    setError('')
    const outcome = await restoreEverything(deps, shown.id)
    if (!alive.current) return
    setBusy(false)
    gate.current.supersede()
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
      void poll()
    }
    setFocusTick((n) => n + 1)
  }, [deps, shown.id, poll])

  return (
    <RestoreFromEraseView
      executed={shown}
      offer={offer}
      busy={busy}
      rowsRestored={shown.restore?.rows_restored ?? 0}
      inTrash={shown.in_trash}
      error={error}
      onRestore={() => void start()}
      resultRef={resultRef}
    />
  )
}

/**
 * For pages that do not hold the erase status themselves (Trash, the empty drive): reads it once
 * and draws the block while something of the last erase is in the trash or a restore runs.
 */
export function RestoreFromEraseOffer({
  onDone,
  deps = RESTORE_DEPS,
  className,
}: {
  onDone?: () => void
  deps?: RestoreDeps
  /** Wraps the block (only when it is drawn), e.g. page padding. */
  className?: string
}) {
  const [executed, setExecuted] = useState<EraseExecuted | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const status = parseEraseStatus(await deps.status())
        if (live && status) setExecuted(status.last_executed)
      } catch {
        // no offer without a status
      }
    })()
    return () => {
      live = false
    }
  }, [deps])
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
