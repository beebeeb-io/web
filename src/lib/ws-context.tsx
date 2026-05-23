import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
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

const CHANNEL_NAME = 'beebeeb-ws'

/** Coordination messages exchanged between tabs on the BroadcastChannel. */
type ChannelMessage =
  | { type: 'who-is-leader' }
  | { type: 'i-am-leader' }
  | { type: 'leader-leaving' }
  | { type: 'event'; event: WsEvent }

/** Time we wait for an existing leader to respond before claiming leadership. */
const ELECTION_WAIT_MS = 100
/** How often the leader broadcasts an `i-am-leader` heartbeat. */
const LEADER_HEARTBEAT_MS = 5_000
/**
 * How long a follower will wait for a heartbeat before suspecting the leader
 * is dead. Generous so a briefly-frozen leader tab (background throttle, JS
 * hitch, devtools breakpoint) doesn't cause a flapping election storm.
 * Must be > 2 × LEADER_HEARTBEAT_MS so we tolerate one missed beat.
 */
const LEADER_STALE_MS = 12_000
/** Minimum random delay before a follower attempts to claim after the leader leaves. */
const CLAIM_MIN_DELAY_MS = 50
/** Maximum random delay before a follower attempts to claim after the leader leaves. */
const CLAIM_MAX_DELAY_MS = 200

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined'

/**
 * Provides a single WebSocket connection for the authenticated session.
 *
 * Across multiple same-origin tabs, exactly one tab is elected leader and
 * owns the WebSocket. Other tabs listen on a BroadcastChannel and receive
 * relayed events. Consumers use the same `useWsEvent` / `useWsEventAll`
 * hooks regardless of leader/follower role.
 *
 * If BroadcastChannel is unavailable (Safari < 15.4), every tab opens its
 * own WebSocket — the legacy behaviour — so functionality degrades to the
 * pre-dedup baseline rather than breaking.
 */
export function WsProvider({ children }: { children: ReactNode }) {
  const listenersRef = useRef<Set<WsListener>>(new Set())

  // When BroadcastChannel is unavailable, every tab acts as its own leader
  // (legacy single-tab behaviour). Otherwise, we start as a follower and
  // try to become leader after the initial election window.
  const [isLeader, setIsLeader] = useState<boolean>(!hasBroadcastChannel)

  const channelRef = useRef<BroadcastChannel | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const electionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const claimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest leader-state snapshot for use inside channel handlers without
  // re-binding the listener on every state change.
  const isLeaderRef = useRef(isLeader)
  isLeaderRef.current = isLeader

  const subscribe = useCallback((listener: WsListener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  /** Dispatch an event to every local subscriber. */
  const dispatchLocal = useCallback((event: WsEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event)
      } catch (err) {
        console.error('[WsProvider] Listener error:', err)
      }
    }
  }, [])

  const post = useCallback((msg: ChannelMessage) => {
    const channel = channelRef.current
    if (!channel) return
    try {
      channel.postMessage(msg)
    } catch (err) {
      // postMessage can throw if the channel is closing — non-fatal.
      console.warn('[WsProvider] BroadcastChannel postMessage failed:', err)
    }
  }, [])

  const clearStaleTimer = useCallback(() => {
    if (staleTimerRef.current !== null) {
      clearTimeout(staleTimerRef.current)
      staleTimerRef.current = null
    }
  }, [])

  const clearClaimTimer = useCallback(() => {
    if (claimTimerRef.current !== null) {
      clearTimeout(claimTimerRef.current)
      claimTimerRef.current = null
    }
  }, [])

  /**
   * Schedule a fresh election: if no `i-am-leader` is heard within
   * LEADER_STALE_MS, this tab claims leadership. Called whenever we observe
   * activity from the current leader (heartbeat or relayed event), so the
   * timer is constantly reset while a leader is alive.
   */
  const armStaleTimer = useCallback(() => {
    clearStaleTimer()
    staleTimerRef.current = setTimeout(() => {
      // No heartbeat in LEADER_STALE_MS — assume leader is gone, claim it.
      if (!isLeaderRef.current) {
        setIsLeader(true)
      }
    }, LEADER_STALE_MS)
  }, [clearStaleTimer])

  // --- Channel setup & message handling ---
  useEffect(() => {
    if (!hasBroadcastChannel) {
      // No coordination possible; this tab is already its own leader.
      return
    }

    const channel = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel

    channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
      const msg = e.data
      if (!msg || typeof msg !== 'object') return

      switch (msg.type) {
        case 'who-is-leader': {
          // Only the leader answers. This both informs the asker AND
          // doubles as a heartbeat for any other followers listening.
          if (isLeaderRef.current) {
            post({ type: 'i-am-leader' })
          }
          break
        }
        case 'i-am-leader': {
          // A leader exists (possibly us responding to ourselves —
          // BroadcastChannel doesn't deliver our own posts, so this is
          // always another tab). If we thought we were leader too, the
          // newest claim wins: defer to whoever spoke last to avoid two
          // tabs both holding WS connections.
          if (isLeaderRef.current) {
            // Two leaders detected. Step down — the other tab is also
            // claiming and would respond to who-is-leader. Picking
            // "newest wins" (we step down) means a freshly-arrived tab
            // displaces an older one, but only in the rare double-leader
            // race window.
            setIsLeader(false)
          }
          // Clear any pending initial-election timer; a leader exists.
          if (electionTimerRef.current !== null) {
            clearTimeout(electionTimerRef.current)
            electionTimerRef.current = null
          }
          // Clear any pending claim attempt; a leader exists.
          clearClaimTimer()
          // Reset the stale-leader watchdog.
          armStaleTimer()
          break
        }
        case 'leader-leaving': {
          // Race to claim. Random jitter prevents thundering-herd where
          // every follower posts `i-am-leader` simultaneously.
          if (isLeaderRef.current) break
          clearClaimTimer()
          clearStaleTimer()
          const delay =
            CLAIM_MIN_DELAY_MS +
            Math.random() * (CLAIM_MAX_DELAY_MS - CLAIM_MIN_DELAY_MS)
          claimTimerRef.current = setTimeout(() => {
            // If another follower already claimed during the delay, their
            // `i-am-leader` would have re-armed the stale timer and
            // cleared this one. We claim now.
            if (!isLeaderRef.current) {
              setIsLeader(true)
            }
          }, delay)
          break
        }
        case 'event': {
          // Followers receive WS events via the channel and dispatch them
          // through the same listener chain a leader would use.
          if (!isLeaderRef.current) {
            // Receiving a relayed event also proves the leader is alive.
            armStaleTimer()
            dispatchLocal(msg.event)
          }
          break
        }
      }
    }

    // Begin election: ask who's leader, then claim if no one answers.
    post({ type: 'who-is-leader' })
    electionTimerRef.current = setTimeout(() => {
      electionTimerRef.current = null
      if (!isLeaderRef.current) {
        setIsLeader(true)
      }
    }, ELECTION_WAIT_MS)

    // While we're a follower waiting, also arm the stale watchdog so a
    // silent leader (e.g. one that announced once and then froze) gets
    // replaced eventually.
    armStaleTimer()

    const handleUnload = () => {
      if (isLeaderRef.current) {
        try {
          channel.postMessage({ type: 'leader-leaving' } satisfies ChannelMessage)
        } catch {
          // Best-effort during teardown.
        }
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)

    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
      if (electionTimerRef.current !== null) {
        clearTimeout(electionTimerRef.current)
        electionTimerRef.current = null
      }
      clearStaleTimer()
      clearClaimTimer()
      if (isLeaderRef.current) {
        // Notify followers so one of them can take over immediately.
        try {
          channel.postMessage({ type: 'leader-leaving' } satisfies ChannelMessage)
        } catch {
          // Best-effort.
        }
      }
      channel.close()
      channelRef.current = null
    }
  }, [armStaleTimer, clearClaimTimer, clearStaleTimer, dispatchLocal, post])

  // --- Leader heartbeat ---
  useEffect(() => {
    if (!hasBroadcastChannel) return
    if (!isLeader) return

    // Announce immediately on becoming leader so any followers stop their
    // claim timers and reset their stale watchdogs.
    post({ type: 'i-am-leader' })

    heartbeatTimerRef.current = setInterval(() => {
      post({ type: 'i-am-leader' })
    }, LEADER_HEARTBEAT_MS)

    return () => {
      if (heartbeatTimerRef.current !== null) {
        clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
    }
  }, [isLeader, post])

  // --- WS event handler ---
  // Leader: dispatch locally AND relay to followers.
  // Follower: never invoked (WS is disabled), but harmless to define.
  const handleEvent = useCallback(
    (event: WsEvent) => {
      dispatchLocal(event)
      if (hasBroadcastChannel && isLeaderRef.current) {
        // Relay to other tabs. Bundling `i-am-leader` semantics here is
        // free: any event arriving proves we're still alive.
        post({ type: 'event', event })
      }
    },
    [dispatchLocal, post]
  )

  // Only the leader opens the WS. Followers stay quiet.
  useWebSocket({ onEvent: handleEvent, enabled: isLeader })

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
