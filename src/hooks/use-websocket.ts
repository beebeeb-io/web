import { useCallback, useEffect, useRef } from 'react'
import { getToken, getApiUrl, getStreamToken } from '../lib/api'

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

export function useWebSocket({ onEvent, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(BASE_BACKOFF_MS)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(async () => {
    if (!getToken()) return

    // Exchange session token for a short-lived stream token so the full
    // session token never appears in the WebSocket upgrade URL (and access logs).
    let streamToken: string
    try {
      const { stream_token } = await getStreamToken()
      streamToken = stream_token
    } catch {
      // If token exchange fails, retry after backoff — same as a normal reconnect.
      const delay = backoffRef.current
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
      reconnectTimerRef.current = setTimeout(() => { void connect() }, delay)
      return
    }

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(streamToken)}`)
    wsRef.current = ws

    ws.onopen = () => {
      backoffRef.current = BASE_BACKOFF_MS
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
      wsRef.current = null
      // Don't reconnect on intentional close (code 1000) or auth failure (4001)
      if (event.code === 1000 || event.code === 4001) return

      const delay = backoffRef.current
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
      reconnectTimerRef.current = setTimeout(() => { void connect() }, delay)
    }

    ws.onerror = () => {
      // onclose will handle reconnection
    }
  }, [])

  const disconnect = useCallback(() => {
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
