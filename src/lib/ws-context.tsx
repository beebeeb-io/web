import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react'
import type { ReactNode } from 'react'
import { useWebSocket } from '../hooks/use-websocket'
import type { WsEvent } from '../hooks/use-websocket'

type WsListener = (event: WsEvent) => void

interface WsContextValue {
  /** Subscribe to all WebSocket events. Returns an unsubscribe function. */
  subscribe: (listener: WsListener) => () => void
}

const WsContext = createContext<WsContextValue | null>(null)

/**
 * Provides a single WebSocket connection for the authenticated session.
 * Any component can subscribe to real-time events via `useWsEvent`.
 */
export function WsProvider({ children }: { children: ReactNode }) {
  const listenersRef = useRef<Set<WsListener>>(new Set())

  const subscribe = useCallback((listener: WsListener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  const handleEvent = useCallback((event: WsEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event)
      } catch (err) {
        console.error('[WsProvider] Listener error:', err)
      }
    }
  }, [])

  useWebSocket({ onEvent: handleEvent, enabled: true })

  return (
    <WsContext.Provider value={{ subscribe }}>
      {children}
    </WsContext.Provider>
  )
}

/**
 * Subscribe to WebSocket events matching specific types.
 * The callback is called whenever an event with a matching type arrives.
 *
 * @param types - Event types to listen for, e.g. ['file.created', 'file.deleted']
 * @param callback - Handler called with the matching event
 */
export function useWsEvent(types: string[], callback: (event: WsEvent) => void) {
  const ctx = useContext(WsContext)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const typesKey = types.join(',')

  useEffect(() => {
    if (!ctx) return

    const typeSet = new Set(typesKey.split(','))
    const listener: WsListener = (event) => {
      if (typeSet.has(event.type)) {
        callbackRef.current(event)
      }
    }

    return ctx.subscribe(listener)
  }, [ctx, typesKey])
}

/**
 * Subscribe to ALL WebSocket events.
 */
export function useWsEventAll(callback: (event: WsEvent) => void) {
  const ctx = useContext(WsContext)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!ctx) return
    const listener: WsListener = (event) => {
      callbackRef.current(event)
    }
    return ctx.subscribe(listener)
  }, [ctx])
}
