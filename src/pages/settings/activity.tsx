import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { getMyActivity, ApiError, type ActivityEvent } from '../../lib/api'

const PAGE_SIZE = 50

const FILTER_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Uploaded', value: 'file_uploaded' },
  { label: 'Deleted', value: 'file_deleted' },
  { label: 'Shared', value: 'share_created' },
  { label: 'Downloaded', value: 'file_downloaded' },
]

type ActionMeta = {
  label: string
  icon: 'upload' | 'trash' | 'link' | 'download' | 'folder' | 'clock'
  badgeClass: string
}

function actionMeta(type: string): ActionMeta {
  switch (type) {
    case 'file_uploaded':
      return { label: 'Uploaded', icon: 'upload', badgeClass: 'bg-green/10 text-green' }
    case 'file_deleted':
      return { label: 'Deleted', icon: 'trash', badgeClass: 'bg-red/10 text-red' }
    case 'share_created':
      return { label: 'Shared', icon: 'link', badgeClass: 'bg-amber-bg text-amber-deep' }
    case 'share_revoked':
      return { label: 'Unshared', icon: 'link', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
    case 'file_downloaded':
      return { label: 'Downloaded', icon: 'download', badgeClass: 'bg-paper-3 text-ink-2 border border-line' }
    case 'folder_created':
      return { label: 'Folder', icon: 'folder', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
    default:
      return { label: type.replace(/_/g, ' '), icon: 'clock', badgeClass: 'bg-paper-2 text-ink-2 border border-line' }
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
  const [typeFilter, setTypeFilter] = useState('')

  const load = useCallback(async (newFilter: string, newOffset: number, append: boolean) => {
    if (newOffset === 0) setLoading(true)
    else setLoadingMore(true)

    try {
      const res = await getMyActivity({
        limit: PAGE_SIZE,
        offset: newOffset,
        type: newFilter || undefined,
      })
      setOptedIn(res.opted_in)
      setEvents(prev => append ? [...prev, ...res.events] : res.events)
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
    load(typeFilter, 0, false)
  }, [])

  function handleFilterChange(value: string) {
    setTypeFilter(value)
    setEvents([])
    setOffset(0)
    setHasMore(false)
    load(value, 0, false)
  }

  function handleLoadMore() {
    load(typeFilter, offset, true)
  }

  return (
    <SettingsShell activeSection="activity">
      <SettingsHeader
        title="Activity"
        subtitle="A timeline of file events on your account. Encrypted file contents are never logged."
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
            <div className="mb-3 flex items-center gap-2">
              <label className="text-[12px] text-ink-3">Filter:</label>
              <select
                value={typeFilter}
                onChange={e => handleFilterChange(e.target.value)}
                className="text-[12.5px] text-ink-2 bg-paper border border-line rounded-[4px] px-2 py-1 focus:outline-none focus:border-ink-3"
              >
                {FILTER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="border border-line rounded-md overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead className="bg-paper-2 border-b border-line">
                  <tr className="text-left text-[11px] text-ink-3 uppercase tracking-wider">
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">File</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-ink-3">
                        No activity recorded yet.
                      </td>
                    </tr>
                  ) : (
                    events.map(ev => {
                      const meta = actionMeta(ev.type)
                      return (
                        <tr key={ev.id} className="border-b border-line last:border-b-0">
                          <td className="px-3 py-2 font-mono text-[11.5px] text-ink-3 whitespace-nowrap">
                            {relativeTime(ev.created_at)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-sm py-xs text-xs font-medium rounded-sm ${meta.badgeClass}`}>
                              <Icon name={meta.icon} size={10} />
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[12px] text-ink-2 max-w-[240px] truncate">
                            {ev.subject ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-ink-3 max-w-[220px] truncate">
                            {ev.details ?? ev.where ?? '—'}
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
