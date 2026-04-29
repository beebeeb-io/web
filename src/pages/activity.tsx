import { useEffect, useState, useCallback } from 'react'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { BBChip } from '../components/bb-chip'
import { listActivity } from '../lib/api'
import type { ActivityEvent } from '../lib/api'

// ── Event type  → icon + dot color mapping ───────────────────────

type EventMeta = { icon: IconName; dot: string }

const EVENT_MAP: Record<string, EventMeta> = {
  'file.save':    { icon: 'file',   dot: 'var(--color-green)' },
  'file.upload':  { icon: 'upload', dot: 'var(--color-green)' },
  'file.restore': { icon: 'file',   dot: 'var(--color-green)' },
  'file.delete':  { icon: 'trash',  dot: 'var(--color-ink-3)' },
  'share.create': { icon: 'share',  dot: 'var(--color-amber)' },
  'share.open':   { icon: 'share',  dot: 'var(--color-amber)' },
  'share.revoke': { icon: 'lock',   dot: 'var(--color-ink)' },
  'key.rotate':   { icon: 'key',    dot: 'var(--color-amber)' },
  'device.new':   { icon: 'shield', dot: 'var(--color-green)' },
  'member.invite':{ icon: 'users',  dot: 'var(--color-ink)' },
  'session.revoke': { icon: 'lock', dot: 'var(--color-ink)' },
}

const DEFAULT_META: EventMeta = { icon: 'clock', dot: 'var(--color-ink-3)' }

function metaFor(eventType: string): EventMeta {
  return EVENT_MAP[eventType] ?? DEFAULT_META
}

// ── Filter chips ─────────────────────────────────────────────────

type Filter = 'everything' | 'just-me' | 'shares' | 'security'

const FILTERS: { id: Filter; label: string; typePrefix?: string }[] = [
  { id: 'everything', label: 'Everything' },
  { id: 'just-me',    label: 'Just me',   typePrefix: 'file.*' },
  { id: 'shares',     label: 'Shares',    typePrefix: 'share.*' },
  { id: 'security',   label: 'Security',  typePrefix: 'session.*' },
]

// ── Day-label helpers ────────────────────────────────────────────

function dayLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = Math.round((today.getTime() - target.getTime()) / 86_400_000)

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) {
    return target.toLocaleDateString('en-US', { weekday: 'long' })
  }
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function timeLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// ── Group events by day ──────────────────────────────────────────

function groupByDay(events: ActivityEvent[]): { label: string; events: ActivityEvent[] }[] {
  const groups: Map<string, ActivityEvent[]> = new Map()
  for (const event of events) {
    const label = dayLabel(event.created_at)
    const existing = groups.get(label)
    if (existing) {
      existing.push(event)
    } else {
      groups.set(label, [event])
    }
  }
  return Array.from(groups, ([label, events]) => ({ label, events }))
}

// ── Page component ───────────────────────────────────────────────

export function Activity() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<Filter>('everything')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filterDef = FILTERS.find((f) => f.id === filter)
      const res = await listActivity(page, filterDef?.typePrefix)
      setEvents(res.events)
      setTotal(res.total)
    } catch {
      // silently fail — the user sees the empty state
    } finally {
      setLoading(false)
    }
  }, [page, filter])

  useEffect(() => {
    void load()
  }, [load])

  const days = groupByDay(events)
  const totalPages = Math.ceil(total / 50)

  return (
    <div className="min-h-screen flex items-start justify-center bg-paper p-xl pt-12">
      <div
        className="bg-paper rounded-xl border border-line overflow-hidden shadow-1"
        style={{ width: 780 }}
      >
        {/* ── Header ──────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
          <Icon name="clock" size={14} className="text-ink" />
          <div>
            <h2 className="text-sm font-semibold text-ink">Activity</h2>
            <p className="text-[11px] text-ink-3">
              Events are encrypted per-entry · only you can read them
            </p>
          </div>
          <div className="ml-auto flex gap-1.5">
            {FILTERS.map((f) => (
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

        {/* ── Timeline ────────────────────────────── */}
        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16">
            <div
              className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
              style={{
                background: 'var(--color-paper-2)',
                border: '1.5px dashed var(--color-line-2)',
              }}
            >
              <Icon name="clock" size={24} className="text-ink-3" />
            </div>
            <div className="text-[15px] font-semibold text-ink mb-1">No activity yet</div>
            <div className="text-[13px] text-ink-3">
              Events will appear here as you use Beebeeb
            </div>
          </div>
        ) : (
          days.map((day, di) => (
            <div key={day.label}>
              {/* Day header */}
              <div className="px-5 py-2.5 bg-paper-2 border-b border-line">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  {day.label}
                </span>
              </div>

              {/* Events */}
              {day.events.map((event, ei) => {
                const meta = metaFor(event.type)
                const isLast = di === days.length - 1 && ei === day.events.length - 1

                return (
                  <div
                    key={event.id}
                    className={`flex items-start gap-3.5 px-5 py-3 ${
                      isLast ? '' : 'border-b border-line'
                    }`}
                  >
                    {/* Icon circle with colored dot */}
                    <div
                      className="relative w-7 h-7 rounded-full bg-paper-2 border border-line flex items-center justify-center shrink-0"
                    >
                      <Icon name={meta.icon} size={13} className="text-ink-2" />
                      <span
                        className="absolute rounded-full"
                        style={{
                          top: -1,
                          right: -1,
                          width: 7,
                          height: 7,
                          background: meta.dot,
                          border: '1.5px solid var(--color-paper)',
                        }}
                      />
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-ink-2">
                        <span className="text-ink">
                          {event.type.replace('.', ' ')}
                        </span>
                        {event.subject && (
                          <>
                            {' '}
                            <span className="font-mono text-[12.5px] font-medium text-ink">
                              {event.subject}
                            </span>
                          </>
                        )}
                      </div>
                      {(event.details || event.where) && (
                        <div className="text-[11px] text-ink-3 mt-0.5">
                          {event.details}
                          {event.details && event.where && ' · '}
                          {event.where && (
                            <span className="text-amber-deep">{event.where}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Timestamp */}
                    <span className="font-mono text-[11px] text-ink-4 shrink-0">
                      {timeLabel(event.created_at)}
                    </span>
                  </div>
                )
              })}
            </div>
          ))
        )}

        {/* ── Pagination ──────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 py-3 border-t border-line bg-paper-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="text-xs text-ink-3 hover:text-ink disabled:opacity-40 cursor-pointer disabled:cursor-default"
            >
              Previous
            </button>
            <span className="font-mono text-[11px] text-ink-3">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="text-xs text-ink-3 hover:text-ink disabled:opacity-40 cursor-pointer disabled:cursor-default"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
