import { useEffect, useState } from 'react'
import { Icon } from '@beebeeb/shared'
import { registerConnectionStatusHandler } from '../lib/api'

// 'flaky' = browser thinks we're online but the API has been failing.
// Distinct from 'offline' so the user knows it's a server/transit issue,
// not their own connection.
type Status = 'online' | 'offline' | 'flaky' | 'reconnected'

export function OfflineBanner() {
  const [status, setStatus] = useState<Status>(
    navigator.onLine ? 'online' : 'offline',
  )

  useEffect(() => {
    let reconnectedTimer: ReturnType<typeof setTimeout> | null = null
    const clearReconnectedTimer = () => {
      if (reconnectedTimer) {
        clearTimeout(reconnectedTimer)
        reconnectedTimer = null
      }
    }

    const handleOffline = () => {
      clearReconnectedTimer()
      setStatus('offline')
    }

    const handleOnline = () => {
      setStatus('reconnected')
      reconnectedTimer = setTimeout(() => {
        setStatus('online')
        reconnectedTimer = null
      }, 3000)
    }

    const handleWsDisconnected = () => {
      setStatus((prev) => (prev === 'offline' ? prev : 'flaky'))
    }

    const handleWsConnected = () => {
      setStatus((prev) => {
        if (prev !== 'flaky') return prev
        clearReconnectedTimer()
        reconnectedTimer = setTimeout(() => {
          setStatus('online')
          reconnectedTimer = null
        }, 3000)
        return 'reconnected'
      })
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    window.addEventListener('beebeeb:ws-disconnected', handleWsDisconnected)
    window.addEventListener('beebeeb:ws-connected', handleWsConnected)

    registerConnectionStatusHandler((s) => {
      setStatus((prev) => {
        // Browser-level offline always wins; don't downgrade it to 'flaky'.
        if (prev === 'offline') return prev
        if (s === 'flaky') return 'flaky'
        // s === 'ok': only show the green flash if we were previously flaky.
        if (prev === 'flaky') {
          clearReconnectedTimer()
          reconnectedTimer = setTimeout(() => {
            setStatus('online')
            reconnectedTimer = null
          }, 3000)
          return 'reconnected'
        }
        return prev
      })
    })

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('beebeeb:ws-disconnected', handleWsDisconnected)
      window.removeEventListener('beebeeb:ws-connected', handleWsConnected)
      clearReconnectedTimer()
    }
  }, [])

  if (status === 'online') return null

  const config: Record<Exclude<Status, 'online'>, {
    className: string
    icon: 'cloud' | 'check'
    text: string
  }> = {
    offline: {
      className: 'bg-amber-bg text-amber-deep',
      icon: 'cloud',
      text: "You're offline — changes will sync when you reconnect",
    },
    flaky: {
      className: 'bg-amber-bg text-amber-deep',
      icon: 'cloud',
      text: 'Reconnecting to Beebeeb...',
    },
    reconnected: {
      className: 'bg-green/10 text-green',
      icon: 'check',
      text: 'Back online',
    },
  }

  const c = config[status]

  return (
    <div
      role="status"
      className={`w-full px-md py-1.5 flex items-center justify-center gap-sm text-xs font-medium transition-colors duration-200 ${c.className}`}
    >
      {status === 'flaky' ? (
        <svg className="animate-spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      ) : (
        <Icon name={c.icon} size={14} />
      )}
      <span>{c.text}</span>
    </div>
  )
}
