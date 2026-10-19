/**
 * Task 1918 round 4d — the "Restore everything from the erase" block's behaviour, without React.
 *
 * `restore-from-erase.tsx` used to hold this in hooks, so its tests could only read the source.
 * The logic lives here as a plain object the component binds to (`useSyncExternalStore`), and the
 * tests drive it with fake requests and timers (`test/1918-erase-request-r4d.test.tsx`).
 *
 * What it does:
 * - `start()`: `POST …/{id}/restore` (one batch at once), then follow the server: poll every
 *   `pollMs` while the restore runs; report `onDone` once nothing of the erase is left in the
 *   trash. Starting and finishing invalidate the app's status cache.
 * - a refused or unknown outcome reads once at once. An UNKNOWN outcome's error and "Check again"
 *   stay until a FOLLOW-UP read (`followUpMs` later, or a click on "Check again") shows the truth,
 *   unless a read shows the restore running or done (round 4d); a refusal's error stays until the
 *   next click.
 * - every read goes through `gate` (the locked screen passes its own: one sequencing authority);
 *   a follow-up read that a newer read superseded is rescheduled.
 * - a status that no longer carries this erase: `lost` (polling stops), and the status still goes
 *   to `onStatus`.
 */
import {
  createLatestGate,
  parseEraseStatus,
  restoreErrorAfterRead,
  restoreEverything,
  restoreOffer,
  restoreUpdate,
  FOLLOW_UP_MS,
  RESTORE_POLL_MS,
  type EraseExecuted,
  type EraseStatus,
  type LatestGate,
  type RestoreDeps,
  type RestoreErrorKind,
  type RestoreOffer,
} from './erase-request'

export type RestoreView = RestoreOffer | 'lost'

export interface RestoreState {
  shown: EraseExecuted
  view: RestoreView
  busy: boolean
  error: string
  errorKind: RestoreErrorKind
  checkAgain: boolean
  notice: string
  /** Bumped after an action's outcome: the error (if any) takes the focus, else the result. */
  focusTick: number
}

export interface RestoreCallbacks {
  /** A fresh status the block read (it started after every action the gate knows of). */
  onStatus?: (status: EraseStatus) => void
  /** Nothing of the erase is left in the trash. */
  onDone?: () => void
  /** The person clicked "Restore everything" (the locked screen pins the block to this erase). */
  onAction?: () => void
}

export interface RestoreTimers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

const realTimers: RestoreTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}

export interface RestoreControllerOptions extends RestoreCallbacks {
  executed: EraseExecuted
  deps: RestoreDeps
  gate?: LatestGate
  /** Invalidate the app's status cache (an own action changed the trash). */
  invalidate?: () => void
  pollMs?: number
  followUpMs?: number
  timers?: RestoreTimers
}

export interface RestoreController {
  getState(): RestoreState
  subscribe(listener: () => void): () => void
  /** The parent read a newer status of this erase. */
  setExecuted(executed: EraseExecuted): void
  setCallbacks(callbacks: RestoreCallbacks): void
  start(): Promise<void>
  /** A read; `followUp` = the scheduled follow-up or a click on "Check again". */
  poll(opts?: { followUp?: boolean }): Promise<void>
  /** Mounted (again): timers may run. */
  attach(): void
  /** Unmounted: stop every timer; late answers are dropped. */
  detach(): void
}

function viewOf(shown: EraseExecuted, lost: boolean): RestoreView {
  return lost ? 'lost' : restoreOffer(shown)
}

export function createRestoreController(opts: RestoreControllerOptions): RestoreController {
  const timers = opts.timers ?? realTimers
  const gate = opts.gate ?? createLatestGate()
  const pollMs = opts.pollMs ?? RESTORE_POLL_MS
  const followUpMs = opts.followUpMs ?? FOLLOW_UP_MS
  let callbacks: RestoreCallbacks = { onStatus: opts.onStatus, onDone: opts.onDone, onAction: opts.onAction }
  let lost = false
  let state: RestoreState = {
    shown: opts.executed,
    view: viewOf(opts.executed, false),
    busy: false,
    error: '',
    errorKind: null,
    checkAgain: false,
    notice: '',
    focusTick: 0,
  }
  const listeners = new Set<() => void>()
  let attached = true
  let interval: unknown = null
  let followUpTimer: unknown = null
  let doneReported = state.view === 'done'

  const syncTimers = () => {
    const shouldPoll = attached && state.view === 'running'
    if (shouldPoll && interval === null) interval = timers.setInterval(() => void controller.poll(), pollMs)
    if (!shouldPoll && interval !== null) {
      timers.clearInterval(interval)
      interval = null
    }
  }

  const set = (patch: Partial<RestoreState>) => {
    const next = { ...state, ...patch }
    next.view = viewOf(next.shown, lost)
    state = next
    syncTimers()
    if (state.view === 'done' && !doneReported) {
      doneReported = true
      opts.invalidate?.()
      callbacks.onDone?.()
    }
    for (const listener of [...listeners]) listener()
  }

  const clearFollowUp = () => {
    if (followUpTimer !== null) {
      timers.clearTimeout(followUpTimer)
      followUpTimer = null
    }
  }
  const scheduleFollowUp = () => {
    clearFollowUp()
    if (!attached) return
    followUpTimer = timers.setTimeout(() => {
      followUpTimer = null
      void controller.poll({ followUp: true })
    }, followUpMs)
  }

  const apply = (status: EraseStatus, followUp: boolean) => {
    const update = restoreUpdate(state.shown.id, status)
    const after = restoreErrorAfterRead(state.errorKind, update.kind === 'lost' ? null : update.executed, followUp)
    const patch: Partial<RestoreState> = {}
    if (after.clear) {
      patch.error = ''
      patch.errorKind = null
      patch.checkAgain = false
      clearFollowUp()
    }
    if (after.notice) patch.notice = after.notice
    if (update.kind === 'lost') {
      lost = true
    } else {
      patch.shown = update.executed
    }
    set(patch)
    callbacks.onStatus?.(status)
  }

  const controller: RestoreController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setExecuted(executed) {
      if (executed === state.shown) return
      lost = false
      set({ shown: executed })
    },
    setCallbacks(next) {
      callbacks = next
    },
    async start() {
      if (state.busy) return
      clearFollowUp()
      set({ busy: true, error: '', errorKind: null, notice: '', checkAgain: false })
      callbacks.onAction?.()
      const outcome = await restoreEverything(opts.deps, state.shown.id)
      if (!attached) return
      // Newer than any read in flight on either side, and than any cached status.
      gate.supersede()
      opts.invalidate?.()
      const focusTick = state.focusTick + 1
      if (outcome.kind === 'done') {
        const s = state.shown
        set({
          busy: false,
          focusTick,
          shown: {
            ...s,
            in_trash: 0,
            restore: { state: 'done', requested_at: s.restore?.requested_at ?? null, rows_restored: outcome.rowsRestored, finished_at: null },
          },
        })
      } else if (outcome.kind === 'running') {
        const s = state.shown
        set({
          busy: false,
          focusTick,
          shown: {
            ...s,
            in_trash: outcome.inTrash ?? s.in_trash,
            restore: { state: 'running', requested_at: s.restore?.requested_at ?? null, rows_restored: outcome.rowsRestored, finished_at: null },
          },
        })
      } else {
        set({ busy: false, focusTick, error: outcome.message, errorKind: outcome.kind, checkAgain: outcome.kind === 'unknown' })
        // Read once at once (the true state, or 'lost'); after an unknown outcome a follow-up
        // read decides what the doubt resolves to.
        if (outcome.kind === 'unknown') scheduleFollowUp()
        void controller.poll()
      }
    },
    async poll({ followUp = false } = {}) {
      if (followUp) clearFollowUp()
      const seq = gate.begin()
      let status: EraseStatus | null = null
      try {
        status = parseEraseStatus(await opts.deps.status())
      } catch {
        if (followUp && attached) scheduleFollowUp()
        return
      }
      if (!attached) return
      if (!gate.isLatest(seq)) {
        // A newer read or action superseded this one: a follow-up never ran, so it runs again.
        if (followUp) scheduleFollowUp()
        return
      }
      if (status) apply(status, followUp)
    },
    attach() {
      attached = true
      syncTimers()
    },
    detach() {
      attached = false
      clearFollowUp()
      syncTimers()
    },
  }
  return controller
}
