// ─── Scope-guarded timers (task 1700 review S2) ─────────────────────────────
//
// The drive schedules delayed actions for the currently watched folder/path:
// the empty-derive confirmation (250 ms) and the WS refetch coalescer (500 ms).
// A user can navigate inside that window, and a stale timer firing afterwards
// would apply the OLD parent's rows under the NEW breadcrumb — or empty the new
// folder. A scoped timer captures the scope at schedule time and bails when the
// scope no longer matches at fire time.

export interface ScopedTimer {
  /**
   * Schedule `fn`, replacing any pending run. `fn` fires only if the scope
   * still matches the one captured here. With `maxWaitMs`, a run that keeps
   * being replaced (a steady event stream) still fires at most `maxWaitMs`
   * after the first schedule of the stream (task 2493).
   */
  schedule(delayMs: number, fn: () => void, maxWaitMs?: number): void
  /** Drop the pending run, if any. */
  cancel(): void
  /** True while a run is scheduled. */
  readonly pending: boolean
}

/** The timers and clock a scoped timer runs on; tests pass a fake clock. */
export interface TimerHooks {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  now: () => number
}

const realTimers: TimerHooks = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export function createScopedTimer(
  getCurrentScope: () => string,
  timers: TimerHooks = realTimers,
): ScopedTimer {
  let timer: unknown = null
  // When the pending run was first scheduled; reset when it fires or is cancelled.
  let firstScheduledAt: number | null = null
  const clear = () => {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
  }
  return {
    schedule(delayMs: number, fn: () => void, maxWaitMs?: number): void {
      clear()
      const now = timers.now()
      firstScheduledAt ??= now
      const delay = maxWaitMs === undefined
        ? delayMs
        : Math.max(0, Math.min(delayMs, firstScheduledAt + maxWaitMs - now))
      const scheduled = getCurrentScope()
      timer = timers.setTimeout(() => {
        timer = null
        firstScheduledAt = null
        // The view may have navigated since scheduling — never apply a stale
        // parent's action.
        if (scheduled !== getCurrentScope()) return
        fn()
      }, delay)
    },
    cancel(): void {
      clear()
      firstScheduledAt = null
    },
    get pending(): boolean {
      return timer !== null
    },
  }
}
