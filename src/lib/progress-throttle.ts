/**
 * LD-0001 PR-C review item 12 — the preview re-renders at most once per
 * 150 ms while a whole-file transfer runs, plus on every phase change and on
 * the final `done` event. The clock is injectable so the rule is testable
 * without bun's fake timers.
 */
import type { TransferProgress } from './encrypted-download'

export const TRANSFER_UI_THROTTLE_MS = 150

type Timer = ReturnType<typeof setTimeout>

export interface TransferThrottle {
  /** Feed one progress event. */
  push(p: TransferProgress): void
  /** Emit the most recent deferred event now (if any). */
  flush(): void
  /** Drop a deferred event and its timer (effect cleanup). */
  cancel(): void
}

export function createTransferThrottle(
  onUpdate: (p: TransferProgress) => void,
  now: () => number = () => Date.now(),
  schedule: (fn: () => void, ms: number) => Timer = (fn, ms) => setTimeout(fn, ms),
  cancelTimer: (t: Timer) => void = (t) => clearTimeout(t),
): TransferThrottle {
  let lastEmit = Number.NEGATIVE_INFINITY
  let lastPhase: TransferProgress['phase'] | null = null
  let pending: TransferProgress | null = null
  let timer: Timer | null = null

  const emit = (p: TransferProgress) => {
    pending = null
    lastEmit = now()
    lastPhase = p.phase
    onUpdate(p)
  }

  const clear = () => {
    if (timer !== null) {
      cancelTimer(timer)
      timer = null
    }
  }

  return {
    push(p) {
      const immediate =
        p.phase !== lastPhase || p.phase === 'done' || now() - lastEmit >= TRANSFER_UI_THROTTLE_MS
      if (immediate) {
        clear()
        emit(p)
        return
      }
      pending = p
      if (timer === null) {
        timer = schedule(() => {
          timer = null
          if (pending) emit(pending)
        }, TRANSFER_UI_THROTTLE_MS)
      }
    },
    flush() {
      clear()
      if (pending) emit(pending)
    },
    cancel() {
      clear()
      pending = null
    },
  }
}
