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

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

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
      text: 'Connection issues — retrying...',
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
      <Icon name={c.icon} size={14} />
      <span>{c.text}</span>
    </div>
  )
}
