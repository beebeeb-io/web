import { useEffect, useState } from 'react'
import { Icon } from './icons'

type Status = 'online' | 'offline' | 'reconnected'

export function OfflineBanner() {
  const [status, setStatus] = useState<Status>(
    navigator.onLine ? 'online' : 'offline',
  )

  useEffect(() => {
    let reconnectedTimer: ReturnType<typeof setTimeout> | null = null

    const handleOffline = () => {
      if (reconnectedTimer) {
        clearTimeout(reconnectedTimer)
        reconnectedTimer = null
      }
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

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      if (reconnectedTimer) clearTimeout(reconnectedTimer)
    }
  }, [])

  if (status === 'online') return null

  const isOffline = status === 'offline'

  return (
    <div
      role="status"
      className={`w-full px-md py-1.5 flex items-center justify-center gap-sm text-xs font-medium transition-colors duration-200 ${
        isOffline
          ? 'bg-amber-bg text-amber-deep'
          : 'bg-green/10 text-green'
      }`}
    >
      <Icon name={isOffline ? 'cloud' : 'check'} size={14} />
      <span>
        {isOffline
          ? "You're offline — changes will sync when you reconnect"
          : 'Back online'}
      </span>
    </div>
  )
}
