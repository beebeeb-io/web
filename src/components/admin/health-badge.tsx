import { useState, useEffect } from 'react'
import { getHealth } from '../../lib/api'

type HealthState = 'healthy' | 'degraded' | 'down' | 'loading'

export function HealthBadge() {
  const [state, setState] = useState<HealthState>('loading')

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const h = await getHealth()
        if (cancelled) return
        if (h.status === 'ok' || h.status === 'healthy') {
          const stale = h.background_workers?.any_stale
          setState(stale ? 'degraded' : 'healthy')
        } else {
          setState('degraded')
        }
      } catch {
        if (!cancelled) setState('down')
      }
    }
    check()
    const interval = setInterval(check, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (state === 'loading') return null

  const color =
    state === 'healthy'
      ? 'var(--color-green)'
      : state === 'degraded'
        ? 'var(--color-amber-deep)'
        : 'var(--color-red)'

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${state !== 'healthy' ? 'animate-pulse' : ''}`}
      style={{ background: color }}
      title={state === 'healthy' ? 'All systems operational' : state === 'degraded' ? 'Degraded performance' : 'System down'}
    />
  )
}
