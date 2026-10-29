import { useEffect, useRef, useState, useSyncExternalStore, type Ref } from 'react'
import { BBButton } from '@beebeeb/shared'
import { getEraseRequest, restoreEraseRequest } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { sharedEraseStatus, watchLastExecuted } from '../lib/erase-status-store'
import {
  RESTORE_DONE_TEXT,
  formatEraseDate,
  inTrashText,
  restoreLabel,
  restoreOffer,
  restoreProgressText,
  type EraseExecuted,
  type EraseStatus,
  type LatestGate,
  type RestoreDeps,
} from '../lib/erase-request'
import { createRestoreController, type RestoreController, type RestoreView } from '../lib/restore-controller'

export type { RestoreView } from '../lib/restore-controller'

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
 *
 * Round 4d: the behaviour lives in `lib/restore-controller.ts` (a plain object this component
 * binds to), so the tests drive it instead of reading this source; the Trash / empty-drive offer
 * follows the shared cache (`watchLastExecuted`) and re-reads after every own trash action and
 * live trash event.
 */

export const RESTORE_DEPS: RestoreDeps = { restore: restoreEraseRequest, status: getEraseRequest }

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
  /** The person clicked "Restore everything" (round 4d: the locked screen pins the block). */
  onAction?: () => void
  pollMs?: number
}

/** The stateful block: a binding to `createRestoreController`. */
export function RestoreFromErase({ executed, deps = RESTORE_DEPS, gate, onStatus, onDone, onAction, pollMs }: RestoreFromEraseProps) {
  const ctrlRef = useRef<RestoreController | null>(null)
  if (ctrlRef.current === null) {
    ctrlRef.current = createRestoreController({
      executed,
      deps,
      gate,
      pollMs,
      invalidate: () => sharedEraseStatus.invalidate(),
    })
  }
  const ctrl = ctrlRef.current
  ctrl.setCallbacks({ onStatus, onDone, onAction })
  useEffect(() => {
    ctrl.attach()
    return () => ctrl.detach()
  }, [ctrl])
  // The parent read a newer status of this erase: follow it.
  useEffect(() => {
    ctrl.setExecuted(executed)
  }, [ctrl, executed])
  const state = useSyncExternalStore(ctrl.subscribe, ctrl.getState, ctrl.getState)

  const resultRef = useRef<HTMLParagraphElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (state.focusTick > 0) (errorRef.current ?? resultRef.current)?.focus()
  }, [state.focusTick])

  return (
    <RestoreFromEraseView
      executed={state.shown}
      offer={state.view}
      busy={state.busy}
      rowsRestored={state.shown.restore?.rows_restored ?? 0}
      inTrash={state.shown.in_trash}
      error={state.error}
      onRestore={() => void ctrl.start()}
      checkAgain={state.checkAgain}
      onCheckAgain={() => void ctrl.poll({ followUp: true })}
      notice={state.notice}
      resultRef={resultRef}
      errorRef={errorRef}
    />
  )
}

/**
 * For pages that do not hold the erase status themselves (Trash, the empty drive). Follows the
 * account's last erase through the shared cache: fresh on mount, and fresh again after every
 * `invalidate()` (the person's own trash actions, the trash's live events). Drawn while something
 * of the last erase is in the trash or a restore runs; once drawn it stays (so the block can say
 * that nothing is left, or hide itself when its offer is gone).
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
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    if (!key) return
    return watchLastExecuted(sharedEraseStatus, key, (next) => {
      setExecuted(next)
      const offer = restoreOffer(next)
      if (offer === 'offer' || offer === 'running') setDrawn(true)
    })
  }, [key])
  const deps = useRef<RestoreDeps>({
    restore: restoreEraseRequest,
    status: () => sharedEraseStatus.read(key, { force: true }),
  })
  deps.current.status = () => sharedEraseStatus.read(key, { force: true })
  if (!drawn || !executed) return null
  return (
    <div className={className}>
      <RestoreFromErase key={executed.id} executed={executed} deps={deps.current} onDone={onDone} />
    </div>
  )
}
