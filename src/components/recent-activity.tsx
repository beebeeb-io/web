// Compact "Recent activity" widget — shows the last few events from the
// /api/v1/activity endpoint. Used in settings/account as a trust-building
// surface ("we logged this and so should you"). The full log lives at
// /activity; this is the at-a-glance digest.

import { useEffect, useState } from 'react'
// Link import removed when /activity route was hidden (spec TBD)
// import { Link } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { SkeletonLine } from '@beebeeb/shared'
import { listActivity } from '../lib/api'
import type { ActivityEvent } from '../lib/api'

interface EventMeta {
  icon: IconName
  dot: string
}

const EVENT_MAP: Record<string, EventMeta> = {
  'file.save':      { icon: 'file',   dot: 'var(--color-green)' },
  'file.upload':    { icon: 'upload', dot: 'var(--color-green)' },
  'file.restore':   { icon: 'file',   dot: 'var(--color-green)' },
  'file.delete':    { icon: 'trash',  dot: 'var(--color-ink-3)' },
  'share.create':   { icon: 'share',  dot: 'var(--color-amber)' },
  'share.open':     { icon: 'share',  dot: 'var(--color-amber)' },
  'share.revoke':   { icon: 'lock',   dot: 'var(--color-ink)' },
  'key.rotate':     { icon: 'key',    dot: 'var(--color-amber)' },
  'device.new':     { icon: 'shield', dot: 'var(--color-green)' },
  'session.revoke': { icon: 'lock',   dot: 'var(--color-ink)' },
}

const DEFAULT_META: EventMeta = { icon: 'clock', dot: 'var(--color-ink-3)' }

function metaFor(eventType: string): EventMeta {
  return EVENT_MAP[eventType] ?? DEFAULT_META
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface RecentActivityProps {
  limit?: number
}

export function RecentActivity({ limit = 5 }: RecentActivityProps) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listActivity(1)
      .then((res) => {
        if (cancelled) return
        setEvents(res.events.slice(0, limit))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Could not load activity')
      })
    return () => { cancelled = true }
  }, [limit])

  return (
    <div className="rounded-lg border border-line bg-paper">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Icon name="clock" size={12} className="text-ink-3" />
        <span className="text-[12px] font-medium text-ink-2">Recent activity</span>
        {/* "See all" link to /activity hidden until the Activity page is
            routed and shows real data — it currently resolves to NotFound.
            Hidden until Activity (spec TBD) ships.
        <Link
          to="/activity"
          className="ml-auto text-[11.5px] text-ink-3 hover:text-ink-2 transition-colors underline-offset-2 hover:underline"
        >
          See all
        </Link>
        */}
      </div>

      {events === null && !error && (
        <div className="px-4 py-3 space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-paper-3 animate-pulse" />
              <div className="flex-1"><SkeletonLine width="70%" /></div>
              <SkeletonLine width="40px" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 text-[12px] text-ink-3">
          Couldn't load activity. <span className="font-mono text-[11px]">{error}</span>
        </div>
      )}

      {events && events.length === 0 && (
        <div className="px-4 py-4 text-[12px] text-ink-3">
          No activity yet — events will land here as you and your devices use Beebeeb.
        </div>
      )}

      {events && events.length > 0 && (
        <ul className="divide-y divide-line">
          {events.map((event) => {
            const meta = metaFor(event.type)
            return (
              <li key={event.id} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: meta.dot }}
                  aria-hidden
                />
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-paper-2 text-ink-2">
                  <Icon name={meta.icon} size={11} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-ink truncate">
                    {event.subject ?? event.type}
                  </div>
                  {event.details && (
                    <div className="text-[11px] text-ink-3 truncate">{event.details}</div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[10.5px] text-ink-3">{timeAgo(event.created_at)}</div>
                  {event.where && (
                    <div className="font-mono text-[10px] text-ink-4">{event.where}</div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
