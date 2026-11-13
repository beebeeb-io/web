// ─── WS event-burst coalescing (task 2489) ──────────────────────────────────
//
// The server publishes one event per row: emptying a Trash of 2835 files is
// 2835 `file.deleted` events. A page that refetches over the network per event
// turns that burst into thousands of requests, past the per-user rate limit,
// and the resulting refusals ban the account for minutes. A page that refetches
// on file events runs its refetch once, `quietMs` after the last event.

import type { WsEvent } from '../hooks/use-websocket'

export interface WsBurstCoalescer {
  /** Feed every WS event here; matching ones (re)arm the trailing run. */
  listener: (event: WsEvent) => void
  /** Drop the pending run, if any (unmount). */
  cancel: () => void
}

export function createWsBurstCoalescer(
  types: readonly string[],
  quietMs: number,
  run: () => void,
): WsBurstCoalescer {
  const typeSet = new Set(types)
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  return {
    listener(event: WsEvent): void {
      if (!typeSet.has(event.type)) return
      cancel()
      timer = setTimeout(() => {
        timer = null
        run()
      }, quietMs)
    },
    cancel,
  }
}
