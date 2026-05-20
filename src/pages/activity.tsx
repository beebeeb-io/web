/**
 * Activity feed — security and authentication events only.
 * Shows sign-ins, device registrations, password changes, 2FA changes,
 * exports, session revocations, and other security-relevant events.
 * File operations (uploads, downloads, shares) are intentionally excluded.
 *
 * Historical feed loaded from /api/v1/activity; live events
 * prepended via WebSocket as they arrive.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { listActivity } from '../lib/api'
import type { ActivityEvent } from '../lib/api'
import { EmptyActivity } from '../components/empty-states/empty-activity'
import { useWsEventAll } from '../lib/ws-context'

// ── Security event types ─────────────────────────────────────────

/** All event types that belong on this page. Anything not in this set is filtered out. */
const SECURITY_EVENT_TYPES = new Set([
  'session.created',
  'session.revoke',
  'device.new',
  'password.changed',
  'totp.enabled',
  'totp.disabled',
  'recovery.used',
  'export.requested',
  'export.downloaded',
  'account.delete_requested',
  'key.rotate',
  'impersonation.start',
  'impersonation.end',
])

/** Events that should visually alarm the user — new device, new login, recovery use. */
const ALARMING_EVENT_TYPES = new Set([
  'session.created',
  'device.new',
  'recovery.used',
  'impersonation.start',
  'account.delete_requested',
])

function isSecurityEvent(eventType: string): boolean {
  return SECURITY_EVENT_TYPES.has(eventType)
}

function isAlarmingEvent(eventType: string): boolean {
  return ALARMING_EVENT_TYPES.has(eventType)
}

// ── Event type → icon + dot color ────────────────────────────────

type EventMeta = { icon: IconName; dot: string; label: string }

const EVENT_MAP: Record<string, EventMeta> = {
  'session.created':          { icon: 'shield',   dot: 'var(--color-amber)',   label: 'Sign-in' },
  'session.revoke':           { icon: 'lock',     dot: 'var(--color-ink)',     label: 'Session revoked' },
  'device.new':               { icon: 'shield',   dot: 'var(--color-amber)',   label: 'New device' },
  'password.changed':         { icon: 'key',      dot: 'var(--color-amber)',   label: 'Password changed' },
  'totp.enabled':             { icon: 'shield',   dot: 'var(--color-green)',   label: '2FA enabled' },
  'totp.disabled':            { icon: 'shield',   dot: 'var(--color-red)',     label: '2FA disabled' },
  'recovery.used':            { icon: 'key',      dot: 'var(--color-red)',     label: 'Recovery phrase used' },
  'export.requested':         { icon: 'download', dot: 'var(--color-amber)',   label: 'Data export requested' },
  'export.downloaded':        { icon: 'download', dot: 'var(--color-ink-3)',   label: 'Data export downloaded' },
  'account.delete_requested': { icon: 'trash',    dot: 'var(--color-red)',     label: 'Account deletion requested' },
  'key.rotate':               { icon: 'key',      dot: 'var(--color-amber)',   label: 'Key rotation' },
  'impersonation.start':      { icon: 'eye',      dot: 'var(--color-red)',     label: 'Admin access started' },
  'impersonation.end':        { icon: 'eye-off',  dot: 'var(--color-ink-3)',   label: 'Admin access ended' },
}

const DEFAULT_META: EventMeta = { icon: 'clock', dot: 'var(--color-ink-3)', label: 'Security event' }

function metaFor(eventType: string): EventMeta {
  return EVENT_MAP[eventType] ?? DEFAULT_META
}

// ── Natural-language action text ─────────────────────────────────

function actionText(event: ActivityEvent): string {
  switch (event.type) {
    case 'session.created':          return 'Signed in'
    case 'session.revoke':           return 'Session revoked'
    case 'device.new':               return 'New device registered'
    case 'password.changed':         return 'Password changed'
    case 'totp.enabled':             return 'Two-factor authentication enabled'
    case 'totp.disabled':            return 'Two-factor authentication disabled'
    case 'recovery.used':            return 'Recovery phrase used to access account'
    case 'export.requested':         return 'Data export requested'
    case 'export.downloaded':        return 'Data export downloaded'
    case 'account.delete_requested': return 'Account deletion requested'
    case 'key.rotate':               return 'Encryption keys rotated'
    case 'impersonation.start':      return 'Admin began viewing your account'
    case 'impersonation.end':        return 'Admin stopped viewing your account'
    default:                         return event.type.replace('.', ' ')
  }
}

// ── Device badge (no emojis) ─────────────────────────────────────

const DEVICE_LABELS: Record<string, { label: string; icon: IconName }> = {
  'web':            { label: 'Web',     icon: 'cloud' },
  'mobile-ios':     { label: 'iOS',     icon: 'camera' },
  'mobile-android': { label: 'Android', icon: 'camera' },
  'desktop':        { label: 'Desktop', icon: 'folder' },
  'cli':            { label: 'CLI',     icon: 'file-code' },
}

function DeviceBadge({ device }: { device?: string | null }) {
  if (!device) return null
  const cfg = DEVICE_LABELS[device] ?? { label: device, icon: 'clock' as IconName }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-paper-2 border border-line text-[10px] text-ink-3 font-medium shrink-0">
      <Icon name={cfg.icon} size={9} className="text-ink-4" />
      {cfg.label}
    </span>
  )
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
      // Request security-prefixed events from the server; client-side filter
      // ensures only security types appear even if the server returns extras.
      const res = await listActivity(p, 'session.*')
      const incoming = res.events.filter(e => isSecurityEvent(e.type))
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
  }, [])

  useEffect(() => { void load(1) }, [load])

  // ── Live WebSocket events ─────────────────────────────────────
  useWsEventAll(useCallback((wsEvent) => {
    if (!isSecurityEvent(wsEvent.type)) return

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
  }, []))

  useEffect(() => {
    const timers = liveTimers.current
    return () => { timers.forEach(t => clearTimeout(t)) }
  }, [])

  // ── Render helpers ────────────────────────────────────────────
  const days = groupByDay(events)
  const hasMore = events.length < total

  return (
    <div className="min-h-screen flex items-start justify-center bg-paper p-4 pt-12">
      <div className="bg-paper rounded-xl border border-line overflow-hidden shadow-1 w-full max-w-[780px]">

        {/* ── Header ──────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line flex-wrap gap-y-2">
          <Icon name="shield" size={14} className="text-ink shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Security activity</h2>
            <p className="text-[11px] text-ink-3">
              Sign-ins, device registrations, and security changes — encrypted per-entry
            </p>
          </div>

          {/* Live indicator */}
          {isLive && (
            <div className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-green/30 bg-green/10">
              <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse shrink-0" />
              <span className="text-[10.5px] font-medium text-green">Live</span>
            </div>
          )}
        </div>

        {/* ── Timeline ─────────────────────────────── */}
        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : events.length === 0 ? (
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
                  const alarming = isAlarmingEvent(event.type)

                  return (
                    <div
                      key={event.id}
                      className={[
                        'flex items-start gap-3.5 px-5 py-3 transition-colors',
                        isLast ? '' : 'border-b border-line',
                        isNew ? 'bg-amber-bg/50 animate-slide-in-up' : '',
                        alarming && !isNew ? 'bg-amber-bg/20' : '',
                      ].join(' ')}
                    >
                      {/* Icon with colored dot */}
                      <div className={[
                        'relative w-7 h-7 rounded-full border flex items-center justify-center shrink-0 mt-0.5',
                        alarming ? 'bg-amber-bg border-amber/30' : 'bg-paper-2 border-line',
                      ].join(' ')}>
                        <Icon name={meta.icon} size={13} className={alarming ? 'text-amber-deep' : 'text-ink-2'} />
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
                        <div className="flex items-center gap-2">
                          <span className={[
                            'text-[13px] leading-snug',
                            alarming ? 'text-ink font-medium' : 'text-ink',
                          ].join(' ')}>
                            {actionText(event)}
                          </span>
                          <span className="text-[10px] font-mono text-ink-4 shrink-0">
                            {meta.label}
                          </span>
                        </div>
                        {(event.details || event.where || event.subject) && (
                          <div className="text-[11.5px] text-ink-3 mt-0.5 leading-snug">
                            {event.subject && (
                              <span className="font-mono text-ink-2">{event.subject}</span>
                            )}
                            {event.subject && (event.details || event.where) && ' · '}
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
                  {loadingMore ? 'Loading…' : `Load more · ${total - events.length} remaining`}
                </BBButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
