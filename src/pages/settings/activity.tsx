import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { getMyActivity, ApiError, type ActivityEvent } from '../../lib/api'

const PAGE_SIZE = 50

/** Security event types shown on this page. File operations are excluded. */
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
  // Legacy underscore-style event names from older server versions
  'session_created',
  'session_revoked',
  'device_new',
  'password_changed',
  'totp_enabled',
  'totp_disabled',
  'recovery_used',
  'export_requested',
  'export_downloaded',
  'account_delete_requested',
  'key_rotated',
])

/** Events that warrant visual warning (amber highlight). */
const ALARMING_EVENTS = new Set([
  'session.created', 'session_created',
  'device.new', 'device_new',
  'recovery.used', 'recovery_used',
  'impersonation.start',
  'account.delete_requested', 'account_delete_requested',
])

type ActionMeta = {
  label: string
  icon: IconName
  badgeClass: string
}

function actionMeta(type: string): ActionMeta {
  switch (type) {
    case 'session.created':
    case 'session_created':
      return { label: 'Sign-in', icon: 'shield', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'session.revoke':
    case 'session_revoked':
      return { label: 'Session revoked', icon: 'lock', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
    case 'device.new':
    case 'device_new':
      return { label: 'New device', icon: 'shield', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'password.changed':
    case 'password_changed':
      return { label: 'Password changed', icon: 'key', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'totp.enabled':
    case 'totp_enabled':
      return { label: '2FA enabled', icon: 'shield', badgeClass: 'bg-green/10 text-green' }
    case 'totp.disabled':
    case 'totp_disabled':
      return { label: '2FA disabled', icon: 'shield', badgeClass: 'bg-red/10 text-red' }
    case 'recovery.used':
    case 'recovery_used':
      return { label: 'Recovery used', icon: 'key', badgeClass: 'bg-red/10 text-red' }
    case 'export.requested':
    case 'export_requested':
      return { label: 'Export requested', icon: 'download', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'export.downloaded':
    case 'export_downloaded':
      return { label: 'Export downloaded', icon: 'download', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
    case 'account.delete_requested':
    case 'account_delete_requested':
      return { label: 'Delete requested', icon: 'trash', badgeClass: 'bg-red/10 text-red' }
    case 'key.rotate':
    case 'key_rotated':
      return { label: 'Key rotation', icon: 'key', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'impersonation.start':
      return { label: 'Admin access', icon: 'eye', badgeClass: 'bg-red/10 text-red' }
    case 'impersonation.end':
      return { label: 'Admin left', icon: 'eye-off', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
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
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  const load = useCallback(async (newOffset: number, append: boolean) => {
    if (newOffset === 0) setLoading(true)
    else setLoadingMore(true)

    try {
      const res = await getMyActivity({
        limit: PAGE_SIZE,
        offset: newOffset,
      })
      setOptedIn(res.opted_in)
      // Filter to security events only — file operations are excluded
      const securityEvents = res.events.filter(e => SECURITY_EVENT_TYPES.has(e.type))
      setEvents(prev => append ? [...prev, ...securityEvents] : securityEvents)
      setHasMore(res.events.length === PAGE_SIZE)
      setOffset(newOffset + res.events.length)
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
                            {ev.subject && <span className="font-mono text-[12px]">{ev.subject}</span>}
                            {ev.subject && ev.details && <span className="text-ink-4"> · </span>}
                            {ev.details && <span className="text-ink-3">{ev.details}</span>}
                            {!ev.subject && !ev.details && '—'}
                          </td>
                          <td className="px-3 py-2 text-ink-3 max-w-[180px] truncate">
                            {ev.where ? (
                              <span className="text-amber-deep">{ev.where}</span>
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
