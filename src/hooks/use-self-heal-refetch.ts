// ─── Self-heal refetch hook ─────────────────────
// Re-fetches a page's file list when the realtime channel re-establishes or
// the tab becomes visible again, so a deletion/trash performed on ANOTHER
// client while this tab was disconnected (backgrounded, asleep, network blip)
// doesn't leave a ghost row behind.
//
// The legacy WebSocket path has no missed-event replay: an event produced
// while the socket is down is simply lost. The SSE sync engine has gapless
// catch-up, but it isn't live on every surface. Listening to the
// `beebeeb:ws-connected` window event (dispatched by use-websocket.ts on
// `ws.onopen`) AND `visibilitychange` self-heals regardless.

import { useEffect, useRef } from 'react'

/**
 * Refetch on the transition to (re)connected or visible.
 *
 * Loop-safety:
 *  - The callback is held in a ref, so the effect's dependency array is empty
 *    and the listeners are attached exactly once for the component's lifetime —
 *    a state update inside the callback can never re-arm the effect.
 *  - Each trigger is debounced (one trailing call per quiet window), so a burst
 *    of `visibilitychange` + `ws-connected` firing together coalesces into a
 *    single refetch.
 *  - We never trigger on the hidden→nothing or disconnected transitions, only
 *    on the rising edge into connected/visible.
 *
 * @param refetch  The page's fetch function (fetchFiles / fetchAllFiles).
 * @param debounceMs  Trailing-debounce window. Defaults to 400ms.
 */
export function useSelfHealRefetch(refetch: () => void, debounceMs = 400) {
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const trigger = () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        refetchRef.current()
      }, debounceMs)
    }

    const onConnected = () => trigger()
    const onVisibility = () => {
      // Only the transition INTO visible self-heals; going hidden is a no-op.
      if (document.visibilityState === 'visible') trigger()
    }

    window.addEventListener('beebeeb:ws-connected', onConnected)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (timer !== null) clearTimeout(timer)
      window.removeEventListener('beebeeb:ws-connected', onConnected)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [debounceMs])
}
