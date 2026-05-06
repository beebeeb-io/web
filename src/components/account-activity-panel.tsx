import { useState, useEffect, useCallback } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Icon, type IconName } from '@beebeeb/shared'
import { useToast } from './toast'
import {
  getAccountActivity,
  getSecurityScore,
  getAccountSessions,
  revokeAccountSession,
  revokeAllOtherSessions,
  type AccountActivity,
  type AccountActivitySummary,
  type AccountActivityEvent,
  type SecurityScore,
  type AccountSession,
} from '../lib/api'

// ── Helpers ──────────────────────────────────────────────────────────────────

const FACTOR_LABELS: Record<string, string> = {
  email_verified: 'Email verified',
  phrase_saved: 'Recovery phrase saved',
  two_factor_enabled: 'Two-factor authentication',
  phrase_recently_tested: 'Recovery phrase tested (90 days)',
  all_devices_recognized: 'All devices recognized',
}

function deviceIcon(kind: string): IconName {
  switch (kind) {
    case 'cli': return 'file-code'
    case 'desktop': return 'settings'
    case 'api': return 'link'
    case 'ios':
    case 'android': return 'shield'
    default: return 'cloud'
  }
}

function scoreColors(label: string) {
  switch (label) {
    case 'Excellent':
    case 'Strong':
      return {
        dot: 'bg-green',
        text: 'text-green',
        badge: 'bg-green/10 text-green border-green/20',
      }
    case 'Good':
      return {
        dot: 'bg-amber-deep',
        text: 'text-amber-deep',
        badge: 'bg-amber-bg text-amber-deep border-amber-deep/20',
      }
    default:
      return {
        dot: 'bg-red',
        text: 'text-red',
        badge: 'bg-red/10 text-red border-red/20',
      }
  }
}

function eventDotClass(event: AccountActivityEvent): string {
  if (event.outcome === 'failure') return 'bg-red'
  const sensitive = [
    'account.password_change',
    'account.email_change',
    'auth.sessions.revoke_all',
    'user.signup',
  ]
  if (sensitive.includes(event.type)) return 'bg-amber-deep'
  return 'bg-green'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface KpiCellProps {
  label: string
  value: string
  sub?: string
}

function KpiCell({ label, value, sub }: KpiCellProps) {
  return (
    <div className="px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">{label}</span>
      <span className="text-[15px] font-mono font-semibold text-ink leading-none">{value}</span>
      {sub && (
        <span className="text-[10.5px] text-ink-3 truncate mt-0.5">{sub}</span>
      )}
    </div>
  )
}

interface SecurityScoreCardProps {
  score: SecurityScore
  summary: AccountActivitySummary | null
}

function SecurityScoreCard({ score, summary }: SecurityScoreCardProps) {
  const colors = scoreColors(score.label)

  return (
    <div className="rounded-lg border border-line overflow-hidden">
      {/* Score header row */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-paper-2">
        {/* Five dots */}
        <div className="flex items-center gap-1.5 shrink-0">
          {Array.from({ length: score.max }).map((_, i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-full ${i < score.score ? colors.dot : 'bg-line-2'}`}
            />
          ))}
        </div>

        {/* Label badge */}
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${colors.badge}`}>
          {score.label}
        </span>

        <span className="text-[12px] text-ink-3 ml-auto font-mono">
          {score.score}/{score.max}
        </span>
      </div>

      {/* Factors checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 border-b border-line">
        {score.factors.map(factor => (
          <div key={factor.key} className="flex items-center gap-2">
            <Icon
              name={factor.satisfied ? 'check' : 'x'}
              size={11}
              className={factor.satisfied ? 'text-green shrink-0' : 'text-ink-4 shrink-0'}
            />
            <span className={`text-[12px] ${factor.satisfied ? 'text-ink-2' : 'text-ink-4'}`}>
              {FACTOR_LABELS[factor.key] ?? factor.key.replace(/_/g, ' ')}
            </span>
          </div>
        ))}
      </div>

      {/* KPI strip */}
      {summary && (
        <div className="grid grid-cols-3 divide-x divide-line bg-paper">
          <KpiCell
            label="Last sign-in"
            value={summary.last_login_at ? timeAgo(summary.last_login_at) : '—'}
            sub={summary.last_login_device ?? undefined}
          />
          <KpiCell
            label="Active sessions"
            value={String(summary.active_sessions)}
          />
          <KpiCell
            label="Shared links"
            value={String(summary.active_shares)}
          />
        </div>
      )}
    </div>
  )
}

interface SessionRowProps {
  session: AccountSession
  revoking: boolean
  onRevoke: (id: string) => void
}

function SessionRow({ session, revoking, onRevoke }: SessionRowProps) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-md border border-line hover:border-line-2 transition-colors bg-paper">
      {/* Device icon */}
      <div
        className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
          session.is_current
            ? 'bg-amber text-ink'
            : 'bg-paper-2 border border-line-2 text-ink-3'
        }`}
      >
        <Icon name={deviceIcon(session.device_kind)} size={14} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink truncate">{session.device_name}</span>
          {session.is_current && (
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber text-ink leading-none">
              This device
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-3 font-mono">
          <span>{timeAgo(session.last_active_at ?? session.created_at)}</span>
          {session.country_code && (
            <>
              <span className="text-ink-4">·</span>
              <span>{session.country_code}</span>
            </>
          )}
        </div>
      </div>

      {/* Sign out — not shown for current session */}
      {!session.is_current && (
        <BBButton
          size="sm"
          variant="ghost"
          onClick={() => onRevoke(session.id)}
          disabled={revoking}
          className="shrink-0 text-ink-3 hover:text-red"
        >
          {revoking
            ? <span className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin inline-block" />
            : 'Sign out'}
        </BBButton>
      )}
    </div>
  )
}

interface ActivityRowProps {
  event: AccountActivityEvent
  last: boolean
}

function ActivityRow({ event, last }: ActivityRowProps) {
  return (
    <div className={`flex items-start gap-3 py-2.5 ${last ? '' : 'border-b border-line'}`}>
      {/* Colored dot */}
      <div className="mt-[5px] shrink-0">
        <span className={`w-2 h-2 rounded-full block ${eventDotClass(event)}`} />
      </div>

      {/* Description + meta */}
      <div className="flex-1 min-w-0">
        <span className="text-[13px] text-ink">{event.description}</span>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-3 font-mono flex-wrap">
          <span>{timeAgo(event.created_at)}</span>
          {event.device && (
            <>
              <span className="text-ink-4">·</span>
              <span className="truncate max-w-[200px]">{event.device}</span>
            </>
          )}
          {event.country_code && (
            <>
              <span className="text-ink-4">·</span>
              <span>{event.country_code}</span>
            </>
          )}
        </div>
      </div>

      {/* Failure badge */}
      {event.outcome === 'failure' && (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red/10 text-red border border-red/20 leading-none mt-0.5">
          Failed
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AccountActivityPanel() {
  const { showToast } = useToast()
  const [activity, setActivity] = useState<AccountActivity | null>(null)
  const [score, setScore] = useState<SecurityScore | null>(null)
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [activityData, scoreData, sessionsData] = await Promise.all([
          getAccountActivity(),
          getSecurityScore(),
          getAccountSessions(),
        ])
        setActivity(activityData)
        setScore(scoreData)
        setSessions(sessionsData.sessions)
      } catch {
        // silent — sections render empty states
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const handleRevoke = useCallback(async (id: string) => {
    setRevoking(id)
    try {
      await revokeAccountSession(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      showToast({ icon: 'check', title: 'Session signed out' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to sign out session', danger: true })
    } finally {
      setRevoking(null)
    }
  }, [showToast])

  const handleRevokeAll = useCallback(async () => {
    setRevokingAll(true)
    try {
      const result = await revokeAllOtherSessions()
      setSessions(prev => prev.filter(s => s.is_current))
      const n = result.revoked
      showToast({
        icon: 'check',
        title: `Signed out of ${n} other ${n === 1 ? 'session' : 'sessions'}`,
      })
    } catch {
      showToast({ icon: 'x', title: 'Failed to sign out all sessions', danger: true })
    } finally {
      setRevokingAll(false)
    }
  }, [showToast])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-ink-3">
        <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin shrink-0" />
        <span className="text-[13px]">Loading activity…</span>
      </div>
    )
  }

  const otherSessions = sessions.filter(s => !s.is_current)

  return (
    <>
      {/* ── Security at a glance ── */}
      {score && (
        <SecurityScoreCard score={score} summary={activity?.summary ?? null} />
      )}

      {/* ── Active sessions ── */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 flex-1">
            Active sessions
          </h3>
          {otherSessions.length > 0 && (
            <BBButton
              size="sm"
              variant="ghost"
              onClick={() => void handleRevokeAll()}
              disabled={revokingAll}
              className="text-ink-3 hover:text-ink"
            >
              {revokingAll
                ? <>
                    <span className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin mr-1.5 inline-block" />
                    Signing out…
                  </>
                : 'Sign out all others'}
            </BBButton>
          )}
        </div>

        {sessions.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">No active sessions.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sessions.map(session => (
              <SessionRow
                key={session.id}
                session={session}
                revoking={revoking === session.id}
                onRevoke={(id) => void handleRevoke(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Recent activity feed ── */}
      <div className="mt-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 mb-3">
          Recent activity
        </h3>

        {!activity || activity.events.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">No recent activity.</p>
        ) : (
          <div className="rounded-md border border-line overflow-hidden">
            {activity.events.map((event, i) => (
              <div key={event.id} className="px-3.5">
                <ActivityRow
                  event={event}
                  last={i === activity.events.length - 1}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
