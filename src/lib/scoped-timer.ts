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
   * still matches the one captured here.
   */
  schedule(delayMs: number, fn: () => void): void
  /** Drop the pending run, if any. */
  cancel(): void
  /** True while a run is scheduled. */
  readonly pending: boolean
}

export function createScopedTimer(getCurrentScope: () => string): ScopedTimer {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule(delayMs: number, fn: () => void): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      const scheduled = getCurrentScope()
      timer = setTimeout(() => {
        timer = null
        // The view may have navigated since scheduling — never apply a stale
        // parent's action.
        if (scheduled !== getCurrentScope()) return
        fn()
      }, delayMs)
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    get pending(): boolean {
      return timer !== null
    },
  }
}
