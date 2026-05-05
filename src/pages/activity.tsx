/**
 * Activity feed — real-time view of everything happening across all your
 * devices. Historical feed loaded from /api/v1/activity; live events
 * prepended via WebSocket as they arrive.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { listActivity } from '../lib/api'
import type { ActivityEvent } from '../lib/api'
import { EmptyActivity } from '../components/empty-states/empty-activity'
import { useWsEventAll } from '../lib/ws-context'

// ── Event type → icon + dot color ────────────────────────────────

type EventMeta = { icon: IconName; dot: string }

const EVENT_MAP: Record<string, EventMeta> = {
  'file.save':        { icon: 'file',     dot: 'var(--color-green)' },
  'file.upload':      { icon: 'upload',   dot: 'var(--color-green)' },
  'file.download':    { icon: 'download', dot: 'var(--color-ink-3)' },
  'file.restore':     { icon: 'file',     dot: 'var(--color-green)' },
  'file.delete':      { icon: 'trash',    dot: 'var(--color-ink-3)' },
  'share.create':     { icon: 'share',    dot: 'var(--color-amber)' },
  'share.open':       { icon: 'eye',      dot: 'var(--color-amber)' },
  'share.revoke':     { icon: 'lock',     dot: 'var(--color-ink)' },
  'key.rotate':       { icon: 'key',      dot: 'var(--color-amber)' },
  'device.new':       { icon: 'shield',   dot: 'var(--color-green)' },
  'member.invite':    { icon: 'users',    dot: 'var(--color-ink)' },
  'session.revoke':   { icon: 'lock',     dot: 'var(--color-ink)' },
  'quota.warning':    { icon: 'cloud',    dot: 'var(--color-amber)' },
}

const DEFAULT_META: EventMeta = { icon: 'clock', dot: 'var(--color-ink-3)' }

function metaFor(eventType: string): EventMeta {
  return EVENT_MAP[eventType] ?? DEFAULT_META
}

// ── Natural-language action text ─────────────────────────────────

function actionText(event: ActivityEvent): string {
  switch (event.type) {
    case 'file.upload':   return event.subject ? `Uploaded ${event.subject}` : 'Uploaded a file'
    case 'file.download': return event.subject ? `Downloaded ${event.subject}` : 'Downloaded a file'
    case 'file.save':     return event.subject ? `Saved ${event.subject}` : 'Saved a file'
    case 'file.restore':  return event.subject ? `Restored ${event.subject}` : 'Restored a file'
    case 'file.delete':   return event.subject ? `Deleted ${event.subject}` : 'Deleted a file'
    case 'share.create':  return event.subject ? `Shared ${event.subject}` : 'Created a share link'
    case 'share.open':    return 'Share link opened'
    case 'share.revoke':  return event.subject ? `Revoked share for ${event.subject}` : 'Revoked a share link'
    case 'key.rotate':    return 'Encryption keys rotated'
    case 'device.new':    return 'Signed in from a new device'
    case 'session.revoke':return 'Session revoked'
    case 'member.invite': return event.subject ? `Invited ${event.subject}` : 'Sent a team invite'
    case 'quota.warning': return 'Storage quota warning'
    default:              return event.type.replace('.', ' ')
  }
}

// ── Device badge ─────────────────────────────────────────────────

const DEVICE_LABELS: Record<string, { label: string; icon: string }> = {
  'web':            { label: 'Web',     icon: '🌐' },
  'mobile-ios':     { label: 'iOS',     icon: '📱' },
  'mobile-android': { label: 'Android', icon: '📱' },
  'desktop':        { label: 'Desktop', icon: '💻' },
  'cli':            { label: 'CLI',     icon: '⌨️' },
}

function DeviceBadge({ device }: { device?: string | null }) {
  if (!device) return null
  const cfg = DEVICE_LABELS[device] ?? { label: device, icon: '?' }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-paper-2 border border-line text-[10px] text-ink-3 font-medium shrink-0">
      <span aria-hidden="true">{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}

// ── Filters ───────────────────────────────────────────────────────

type Filter = 'everything' | 'uploads' | 'shares' | 'security'

const FILTERS: { id: Filter; label: string; types?: string[] }[] = [
  { id: 'everything', label: 'All' },
  { id: 'uploads',    label: 'Uploads',   types: ['file.upload', 'file.save', 'file.restore', 'file.delete', 'file.download'] },
  { id: 'shares',     label: 'Shares',    types: ['share.create', 'share.open', 'share.revoke'] },
  { id: 'security',   label: 'Security',  types: ['device.new', 'session.revoke', 'key.rotate', 'quota.warning'] },
]

function matchesFilter(event: ActivityEvent, filter: Filter): boolean {
  const def = FILTERS.find(f => f.id === filter)
  if (!def?.types) return true
  return def.types.includes(event.type)
}

// ── Day / time helpers ────────────────────────────────────────────

function dayLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = Math.round((today.getTime() - target.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return target.toLocaleDateString('en-US', { weekday: 'long' })
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function timeLabel(dateStr: string): string {
  const now = Date.now()
  const diffMs = now - new Date(dateStr).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h}h ago`
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function groupByDay(events: ActivityEvent[]): { label: string; events: ActivityEvent[] }[] {
  const groups = new Map<string, ActivityEvent[]>()
  for (const event of events) {
    const label = dayLabel(event.created_at)
    const existing = groups.get(label)
    if (existing) existing.push(event)
    else groups.set(label, [event])
  }
  return Array.from(groups, ([label, events]) => ({ label, events }))
}

// ── WsEvent → ActivityEvent adapter ─────────────────────────────

function wsToActivity(wsEvent: { type: string; data: Record<string, unknown>; timestamp: string }): ActivityEvent {
  const data = wsEvent.data
  return {
    id: `live-${wsEvent.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    type: wsEvent.type,
    subject: (data.file_name ?? data.subject ?? data.name ?? null) as string | null,
    details: (data.details ?? data.ip ?? null) as string | null,
    where: (data.where ?? data.location ?? null) as string | null,
    device: (data.device ?? data.client ?? null) as string | null,
    created_at: wsEvent.timestamp,
  }
}

// ── Page ──────────────────────────────────────────────────────────

const LIVE_GLOW_DURATION = 4000 // ms the new-event highlight lasts

export function Activity() {
  const navigate = useNavigate()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<Filter>('everything')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set())
  const [isLive, setIsLive] = useState(false)
  const liveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const knownIds = useRef<Set<string>>(new Set())

  // ── Historical load ─────────────────────────────────────────────
  const load = useCallback(async (p = 1) => {
    if (p === 1) { setLoading(true); setEvents([]); knownIds.current.clear() }
    else setLoadingMore(true)
    try {
      const filterDef = FILTERS.find(f => f.id === filter)
      const typePrefix = filterDef?.types ? filterDef.types[0].replace(/\.\w+$/, '.*') : undefined
      const res = await listActivity(p, typePrefix)
      const incoming = filter === 'everything'
        ? res.events
        : res.events.filter(e => matchesFilter(e, filter))
      incoming.forEach(e => knownIds.current.add(e.id))
      setEvents(prev => p === 1 ? incoming : [...prev, ...incoming])
      setTotal(res.total)
      setPage(p)
    } catch (err) {
      console.error('[Activity] load error', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filter])

  useEffect(() => { void load(1) }, [load])

  // ── Live WebSocket events ─────────────────────────────────────
  useWsEventAll(useCallback((wsEvent) => {
    if (!matchesFilter({ type: wsEvent.type } as ActivityEvent, filter)) return

    const activity = wsToActivity(wsEvent)
    if (knownIds.current.has(activity.id)) return
    knownIds.current.add(activity.id)

    setIsLive(true)
    setEvents(prev => [activity, ...prev])

    // Glow highlight
    setLiveIds(prev => new Set([...prev, activity.id]))
    const timer = setTimeout(() => {
      setLiveIds(prev => { const next = new Set(prev); next.delete(activity.id); return next })
      liveTimers.current.delete(activity.id)
    }, LIVE_GLOW_DURATION)
    liveTimers.current.set(activity.id, timer)

    setTotal(prev => prev + 1)
  }, [filter]))

  useEffect(() => {
    const timers = liveTimers.current
    return () => { timers.forEach(t => clearTimeout(t)) }
  }, [])

  // ── Render helpers ────────────────────────────────────────────
  const filtered = events.filter(e => matchesFilter(e, filter))
  const days = groupByDay(filtered)
  const hasMore = filtered.length < total

  return (
    <div className="min-h-screen flex items-start justify-center bg-paper p-4 pt-12">
      <div className="bg-paper rounded-xl border border-line overflow-hidden shadow-1 w-full max-w-[780px]">

        {/* ── Header ──────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line flex-wrap gap-y-2">
          <Icon name="clock" size={14} className="text-ink shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Activity</h2>
            <p className="text-[11px] text-ink-3">
              Events are encrypted per-entry · only you can read them
            </p>
          </div>

          {/* Live indicator */}
          {isLive && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-green/30 bg-green/10">
              <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse shrink-0" />
              <span className="text-[10.5px] font-medium text-green">Live</span>
            </div>
          )}

          {/* Filter chips */}
          <div className="ml-auto flex gap-1.5 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => { setFilter(f.id); setPage(1) }}
                className="cursor-pointer"
              >
                <BBChip
                  variant={filter === f.id ? 'amber' : 'default'}
                  className="text-[10.5px]"
                >
                  {f.label}
                </BBChip>
              </button>
            ))}
          </div>
        </div>

        {/* ── Timeline ─────────────────────────────── */}
        {loading && filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyActivity onGoToDrive={() => navigate('/')} />
        ) : (
          <>
            {days.map((day, di) => (
              <div key={day.label}>
                {/* Day header */}
                <div className="px-5 py-2 bg-paper-2 border-b border-line sticky top-0 z-10">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                    {day.label}
                  </span>
                </div>

                {day.events.map((event, ei) => {
                  const meta = metaFor(event.type)
                  const isNew = liveIds.has(event.id)
                  const isLast = di === days.length - 1 && ei === day.events.length - 1

                  return (
                    <div
                      key={event.id}
                      className={[
                        'flex items-start gap-3.5 px-5 py-3 transition-colors',
                        isLast ? '' : 'border-b border-line',
                        isNew ? 'bg-amber-bg/50 animate-slide-in-up' : '',
                      ].join(' ')}
                    >
                      {/* Icon with colored dot */}
                      <div className="relative w-7 h-7 rounded-full bg-paper-2 border border-line flex items-center justify-center shrink-0 mt-0.5">
                        <Icon name={meta.icon} size={13} className="text-ink-2" />
                        <span
                          className="absolute rounded-full"
                          style={{
                            top: -1, right: -1,
                            width: 7, height: 7,
                            background: meta.dot,
                            border: '1.5px solid var(--color-paper)',
                          }}
                        />
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-ink leading-snug">
                          {actionText(event)}
                        </div>
                        {(event.details || event.where) && (
                          <div className="text-[11.5px] text-ink-3 mt-0.5 leading-snug">
                            {event.details}
                            {event.details && event.where && ' · '}
                            {event.where && (
                              <span className="text-amber-deep">{event.where}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right: device badge + timestamp */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="font-mono text-[11px] text-ink-4">
                          {timeLabel(event.created_at)}
                        </span>
                        <DeviceBadge device={event.device} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center py-4 border-t border-line bg-paper-2">
                <BBButton
                  size="sm"
                  variant="ghost"
                  disabled={loadingMore}
                  onClick={() => void load(page + 1)}
                >
                  {loadingMore ? (
                    <svg className="animate-spin h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : null}
                  {loadingMore ? 'Loading…' : `Load more · ${total - filtered.length} remaining`}
                </BBButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
