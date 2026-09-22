import { useCallback, useEffect, useRef } from 'react'
import { getApiUrl, getStreamToken } from '../lib/api'

export interface WsEvent {
  type: string
  data: Record<string, unknown>
  timestamp: string
}

interface UseWebSocketOptions {
  onEvent: (event: WsEvent) => void
  enabled?: boolean
}

const WS_URL = getApiUrl().replace(/^http/, 'ws') + '/ws'
const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 1_000

/**
 * Task 1471 Codex review finding (thread PRRT_kwDOSLX6Nc6k3xUz, PR #55) —
 * `connect()` used to trust the `enabled` gate checked before it was
 * invoked, with nothing re-checked after the `await getStreamToken()`. If
 * `enabled` flipped to `false` while that await was in flight (logout, or
 * this tab losing the BroadcastChannel leader election), the effect's
 * cleanup had already run but the in-flight continuation had no way to
 * observe it — it could still open a WebSocket after cleanup, or its
 * `catch` branch could install a reconnect timer while disabled, leaving a
 * logged-out/follower tab receiving events or repeatedly requesting stream
 * tokens.
 *
 * `attemptConnect` is the async decision extracted into a pure, injectable
 * function — deps in, no module state — so the race is directly testable
 * without a React rendering harness (see test/1471-ws-reconnect-race.test.ts;
 * same convention as `shouldOpenWs` in ws-context.tsx). It bails — before
 * calling `openSocket` OR `scheduleRetry` — the moment `isCurrent()` says
 * the connection attempt it started under is no longer the current one,
 * checked both right after a successful token exchange and in the `catch`
 * branch of a failed one.
 */
export async function attemptConnect(deps: {
  getStreamToken: () => Promise<{ stream_token: string }>
  openSocket: (streamToken: string) => void
  scheduleRetry: () => void
  isCurrent: () => boolean
}): Promise<void> {
  const { getStreamToken: fetchStreamToken, openSocket, scheduleRetry, isCurrent } = deps

  let streamToken: string
  try {
    const { stream_token } = await fetchStreamToken()
    streamToken = stream_token
  } catch {
    if (!isCurrent()) return
    scheduleRetry()
    return
  }

  if (!isCurrent()) return
  openSocket(streamToken)
}

export function useWebSocket({ onEvent, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(BASE_BACKOFF_MS)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  // Task 1471 — bumped by `disconnect()` on every teardown (disable,
  // unmount, effect re-run). A `connect()` call (and any reconnect it
  // schedules) captures the generation it started under and bails — via
  // `attemptConnect`'s `isCurrent`, and again in `ws.onclose` below — the
  // moment the generation moves on, so a stale continuation can never act
  // on behalf of a torn-down effect.
  const generationRef = useRef(0)

  const connect = useCallback(async () => {
    // Task 1471 — used to gate on `!getToken()` (the legacy `bb_session`
    // localStorage slot), which also skipped every real cookie-only user,
    // not just logged-out visitors. The caller (`ws-context.tsx`'s
    // `shouldOpenWs`) now only sets `enabled: true` once the auth context
    // has a real user, so this hook trusts `enabled` as the sole gate —
    // re-checked via `generationRef` after the async token exchange below,
    // since `enabled` itself can change mid-flight.
    const generation = generationRef.current
    const isCurrent = () => generation === generationRef.current

    // Exchange session token for a short-lived stream token so the full
    // session token never appears in the WebSocket upgrade URL (and access logs).
    await attemptConnect({
      getStreamToken,
      isCurrent,
      scheduleRetry: () => {
        // If token exchange fails, retry after backoff — same as a normal reconnect.
        const delay = backoffRef.current
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
        reconnectTimerRef.current = setTimeout(() => { void connect() }, delay)
      },
      openSocket: (streamToken) => {
        // Clean up any existing connection
        if (wsRef.current) {
          wsRef.current.close()
          wsRef.current = null
        }

        const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(streamToken)}`)
        wsRef.current = ws

        ws.onopen = () => {
          backoffRef.current = BASE_BACKOFF_MS
          window.dispatchEvent(new CustomEvent('beebeeb:ws-connected'))
        }

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data as string) as WsEvent
            onEventRef.current(parsed)
          } catch {
            // Ignore malformed messages
          }
        }

        ws.onclose = (event) => {
          if (wsRef.current === ws) wsRef.current = null
          // Don't reconnect on intentional close (code 1000) or auth failure (4001)
          if (event.code === 1000 || event.code === 4001) return
          // A stale generation's socket closing after a newer generation
          // already took over (or after teardown) must not schedule a
          // reconnect on the torn-down effect's behalf.
          if (!isCurrent()) return

          window.dispatchEvent(new CustomEvent('beebeeb:ws-disconnected'))
          const delay = backoffRef.current
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
          reconnectTimerRef.current = setTimeout(() => { void connect() }, delay)
        }

        ws.onerror = () => {
          // onclose will handle reconnection
        }
      },
    })
  }, [])

  const disconnect = useCallback(() => {
    generationRef.current++
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close(1000)
      wsRef.current = null
    }
  }, [])

  const mountedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return disconnect
    if (mountedRef.current && wsRef.current) return disconnect
    mountedRef.current = true
    void connect()
    return disconnect
  }, [enabled, connect, disconnect])

  return { disconnect }
}
