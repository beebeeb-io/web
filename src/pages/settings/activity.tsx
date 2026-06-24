import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { getMyActivity, ApiError, type MyActivityEvent } from '../../lib/api'

const PAGE_SIZE = 50

/** Hard cap on auto-paging passes when filtering for security events, so a
 *  user whose entire audit log is file operations can't spin forever. */
const MAX_AUTO_PAGES = 20

/** Security event types shown on this page. File operations are excluded.
 *  These MUST match the event strings the server actually writes to
 *  `audit_log` (verified against repos/server/.../routes/{auth,opaque_auth,
 *  password,account,account_activity}.rs via `log_chained`). */
const SECURITY_EVENT_TYPES = new Set([
  // Sign-in / account creation
  'user.login',
  'auth.login.success',
  'user.signup',
  'user.signup.passkey',
  'auth.opaque_silent_upgrade',
  // Sign-out
  'user.logout',
  'auth.logout',
  'user.logout_all',
  // Session revocation
  'auth.session.revoke',
  'auth.sessions.revoke_all',
  // Password change
  'user.password_change',
  'auth.password.changed',
  // Account security
  'account.email_changed',
  'account.data_export_requested',
  'account.frozen',
  'account.unfrozen',
  // Admin impersonation
  'admin.user.impersonation_start',
  'admin.user.impersonation_session_created',
])

/** Events that warrant visual warning (amber highlight). */
const ALARMING_EVENTS = new Set([
  'user.login',
  'auth.login.success',
  'user.signup',
  'user.signup.passkey',
  'account.frozen',
  'admin.user.impersonation_start',
  'admin.user.impersonation_session_created',
])

type ActionMeta = {
  label: string
  icon: IconName
  badgeClass: string
}

function actionMeta(type: string): ActionMeta {
  switch (type) {
    case 'user.login':
    case 'auth.login.success':
    case 'auth.opaque_silent_upgrade':
      return { label: 'Sign-in', icon: 'shield', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'user.signup':
    case 'user.signup.passkey':
      return { label: 'Account created', icon: 'shield', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'user.logout':
    case 'auth.logout':
      return { label: 'Sign-out', icon: 'lock', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
    case 'user.logout_all':
      return { label: 'Signed out everywhere', icon: 'lock', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
    case 'auth.session.revoke':
      return { label: 'Session revoked', icon: 'lock', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
    case 'auth.sessions.revoke_all':
      return { label: 'All sessions revoked', icon: 'lock', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
    case 'user.password_change':
    case 'auth.password.changed':
      return { label: 'Password changed', icon: 'key', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'account.email_changed':
      return { label: 'Email changed', icon: 'shield', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'account.data_export_requested':
      return { label: 'Export requested', icon: 'download', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'account.frozen':
      return { label: 'Account frozen', icon: 'lock', badgeClass: 'bg-red/10 text-red' }
    case 'account.unfrozen':
      return { label: 'Account unfrozen', icon: 'shield', badgeClass: 'bg-green/10 text-green' }
    case 'admin.user.impersonation_start':
    case 'admin.user.impersonation_session_created':
      return { label: 'Admin access', icon: 'eye', badgeClass: 'bg-red/10 text-red' }
    default:
      return { label: type.replace(/[._]/g, ' '), icon: 'clock', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function SettingsActivity() {
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notDeployed, setNotDeployed] = useState(false)
  const [optedIn, setOptedIn] = useState(false)
  const [events, setEvents] = useState<MyActivityEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  // The server endpoint cannot filter by our (multi-type) security set —
  // `?type=` is exact-match only — so we page the raw audit log and filter
  // client-side. Because a page of file-only events filters to nothing, we
  // auto-page until we collect at least one security event or the server is
  // exhausted (a short page < PAGE_SIZE). `hasMore` reflects whether the RAW
  // server log has more rows, not the filtered subset, so "Load more" can
  // never persist past true exhaustion.
  const load = useCallback(async (startOffset: number, append: boolean) => {
    if (startOffset === 0) setLoading(true)
    else setLoadingMore(true)

    let currentOffset = startOffset
    const collected: MyActivityEvent[] = []
    let serverHasMore = false

    try {
      for (let pass = 0; pass < MAX_AUTO_PAGES; pass++) {
        const res = await getMyActivity({ limit: PAGE_SIZE, offset: currentOffset })
        setOptedIn(res.opted_in)

        const securityEvents = res.events.filter(e => SECURITY_EVENT_TYPES.has(e.type))
        collected.push(...securityEvents)
        currentOffset += res.events.length

        // A short page means the server has no more rows.
        serverHasMore = res.events.length === PAGE_SIZE
        // Stop once we have something to show, or the log is exhausted.
        if (collected.length > 0 || !serverHasMore) break
      }

      setEvents(prev => (append ? [...prev, ...collected] : collected))
      setHasMore(serverHasMore)
      setOffset(currentOffset)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotDeployed(true)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    load(0, false)
  }, [])

  function handleLoadMore() {
    load(offset, true)
  }

  return (
    <SettingsShell activeSection="activity">
      <SettingsHeader
        title="Security activity"
        subtitle="Sign-ins, device registrations, and security changes on your account."
      />

      <div className="px-7 py-6">
        {loading ? (
          <div className="h-8 flex items-center">
            <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin" />
          </div>
        ) : notDeployed ? (
          <div className="flex items-start gap-2.5 p-4 rounded-md bg-paper-2 border border-line max-w-[600px]">
            <Icon name="clock" size={14} className="text-ink-3 shrink-0 mt-0.5" />
            <p className="text-[13px] text-ink-2 leading-relaxed">
              Activity history requires the latest server update. Your activity will appear here once the feature is available.
            </p>
          </div>
        ) : !optedIn ? (
          <div className="flex items-start gap-2.5 p-4 rounded-md bg-paper-2 border border-line max-w-[600px]">
            <Icon name="eye-off" size={14} className="text-ink-3 shrink-0 mt-0.5" />
            <div className="text-[13px] text-ink-2 leading-relaxed">
              <p>Activity tracking is not enabled.</p>
              <p className="mt-1">
                Enable it in{' '}
                <Link to="/settings/profile" className="text-amber-deep hover:underline">
                  Settings &gt; Privacy
                </Link>{' '}
                to see your file activity history.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-[860px]">
            <div className="border border-line rounded-md overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="bg-paper-2 border-b border-line">
                  <tr className="text-left text-[11px] text-ink-3 uppercase tracking-wider">
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                    <th className="px-3 py-2 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-ink-3">
                        No security events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    events.map(ev => {
                      const meta = actionMeta(ev.type)
                      const alarming = ALARMING_EVENTS.has(ev.type)
                      return (
                        <tr key={ev.id} className={[
                          'border-b border-line last:border-b-0',
                          alarming ? 'bg-amber-bg/20' : '',
                        ].join(' ')}>
                          <td className="px-3 py-2 font-mono text-[11.5px] text-ink-3 whitespace-nowrap">
                            {relativeTime(ev.created_at)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-sm py-xs text-xs font-medium rounded-sm ${meta.badgeClass}`}>
                              <Icon name={meta.icon} size={10} />
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-ink-2 max-w-[260px] truncate">
                            {ev.description && <span className="text-ink-3">{ev.description}</span>}
                            {ev.description && ev.device && <span className="text-ink-4"> · </span>}
                            {ev.device && <span className="font-mono text-[12px]">{ev.device}</span>}
                            {!ev.description && !ev.device && '—'}
                          </td>
                          <td className="px-3 py-2 text-ink-3 max-w-[180px] truncate">
                            {ev.country_code ? (
                              <span className="text-amber-deep font-mono">{ev.country_code}</span>
                            ) : '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="mt-3 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="text-[12.5px] text-ink-2 border border-line rounded-md px-4 py-1.5 hover:bg-paper-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </SettingsShell>
  )
}
