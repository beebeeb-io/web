// ─── WS event-burst coalescing (task 2489) ──────────────────────────────────
//
// The server publishes one event per row: emptying a Trash of 2835 files is
// 2835 `file.deleted` events. A page that refetches over the network per event
// turns that burst into thousands of requests, past the per-user rate limit,
// and the resulting refusals ban the account for minutes. A page that refetches
// on file events runs its refetch once, `quietMs` after the last event, and at
// least every `maxWaitMs` while a steady stream (a large upload elsewhere) lasts.

import type { WsEvent } from '../hooks/use-websocket'
import { createScopedTimer, type TimerHooks } from './scoped-timer'

export interface BurstTiming {
  quietMs: number
  maxWaitMs: number
}

export interface WsBurstCoalescer {
  /** Feed every WS event here; matching ones (re)arm the run. */
  listener: (event: WsEvent) => void
  /** Drop the pending run, if any (unmount). */
  cancel: () => void
}

/** One scope for the whole page: a coalesced refetch is never navigation-bound. */
const PAGE_SCOPE = () => ''

export function createWsBurstCoalescer(
  types: readonly string[],
  timing: BurstTiming,
  run: () => void,
  timers?: TimerHooks,
): WsBurstCoalescer {
  const typeSet = new Set(types)
  const timer = createScopedTimer(PAGE_SCOPE, timers)
  return {
    listener(event: WsEvent): void {
      if (!typeSet.has(event.type)) return
      timer.schedule(timing.quietMs, run, timing.maxWaitMs)
    },
    cancel: () => timer.cancel(),
  }
}
