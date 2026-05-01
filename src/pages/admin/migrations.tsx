import { useState, useEffect, useCallback, useRef } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'
import { listMigrations } from '../../lib/api'
import type { MigrationSummary, MigrationEntry } from '../../lib/api'

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusColor(status: string): { fg: string; bg: string } {
  switch (status) {
    case 'pending':
      return { fg: 'var(--color-ink)', bg: 'var(--color-paper-2)' }
    case 'copying':
    case 'verifying':
      return { fg: 'var(--color-amber-deep)', bg: 'var(--color-amber-bg)' }
    case 'done':
      return { fg: 'oklch(0.45 0.12 155)', bg: 'oklch(0.94 0.06 155)' }
    case 'failed':
      return { fg: 'var(--color-red)', bg: 'oklch(0.97 0.03 25)' }
    default:
      return { fg: 'var(--color-ink-3)', bg: 'var(--color-paper-2)' }
  }
}

const POLL_INTERVAL = 15_000

export function AdminMigrations() {
  const [summary, setSummary] = useState<MigrationSummary | null>(null)
  const [recent, setRecent] = useState<MigrationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await listMigrations()
      setSummary(data.summary)
      setRecent(data.recent)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load migrations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    intervalRef.current = setInterval(() => void load(), POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load])

  return (
    <AdminShell activeSection="migrations">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="arrow-up" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Data migrations</h2>
        {summary && <BBChip>{summary.total} total</BBChip>}
        {lastRefresh && (
          <span className="ml-auto font-mono text-[10px] text-ink-3">
            Last update{' '}
            {lastRefresh.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}
        <BBButton
          size="sm"
          variant="ghost"
          onClick={() => void load()}
          className={lastRefresh ? '' : 'ml-auto'}
        >
          Refresh
        </BBButton>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <div className="text-xs text-red mb-2">{error}</div>
            <BBButton size="sm" variant="ghost" onClick={() => void load()}>
              Retry
            </BBButton>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            {summary && (
              <div className="grid grid-cols-5 gap-3">
                {(['pending', 'copying', 'verifying', 'done', 'failed'] as const).map(status => {
                  const count = summary[status]
                  const colors = statusColor(status)
                  return (
                    <div
                      key={status}
                      className="rounded-lg border border-line bg-paper p-3 text-center"
                    >
                      <div
                        className="font-mono text-lg font-bold leading-tight"
                        style={{ color: count > 0 ? colors.fg : 'var(--color-ink-4)' }}
                      >
                        {count}
                      </div>
                      <div className="text-[10px] text-ink-3 capitalize mt-0.5">{status}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Recent migrations table */}
            <div className="rounded-xl border border-line-2 bg-paper overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
                <Icon name="clock" size={13} className="text-ink-2" />
                <span className="text-[13px] font-semibold">Recent migrations</span>
                <BBChip>{recent.length} shown</BBChip>
              </div>

              {recent.length === 0 ? (
                <div className="py-8 text-center text-xs text-ink-3">
                  No migrations recorded yet
                </div>
              ) : (
                <>
                  {/* Table header */}
                  <div
                    className="grid px-4 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line bg-paper-2"
                    style={{ gridTemplateColumns: '120px 1fr 1fr 80px 70px 1fr 130px' }}
                  >
                    <span>File</span>
                    <span>From pool</span>
                    <span>To pool</span>
                    <span>Status</span>
                    <span>Chunks</span>
                    <span>Error</span>
                    <span>Created</span>
                  </div>

                  {/* Table rows */}
                  {recent.map(m => {
                    const colors = statusColor(m.status)
                    return (
                      <div
                        key={m.id}
                        className="grid px-4 py-2.5 text-xs border-b border-line items-center last:border-b-0"
                        style={{ gridTemplateColumns: '120px 1fr 1fr 80px 70px 1fr 130px' }}
                      >
                        <span className="font-mono text-[10px] text-ink-2 truncate" title={m.file_id}>
                          {m.file_id.slice(0, 8)}...
                        </span>
                        <span className="font-mono text-[11px] truncate">{m.from_pool ?? '-'}</span>
                        <span className="font-mono text-[11px] truncate">{m.to_pool ?? '-'}</span>
                        <span>
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: colors.bg, color: colors.fg }}
                          >
                            {m.status}
                          </span>
                        </span>
                        <span className="font-mono text-[11px] text-ink-2">{m.chunks_copied}</span>
                        <span className="text-[10px] text-red truncate" title={m.error ?? undefined}>
                          {m.error ?? '-'}
                        </span>
                        <span className="font-mono text-[10px] text-ink-3">
                          {formatDate(m.created_at)}
                        </span>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="clock" size={11} className="text-ink-3" />
        <span>Auto-refresh every 15 seconds</span>
        <span className="ml-auto font-mono text-[10px]">Trigger migrations from Storage pools or Users</span>
      </div>
    </AdminShell>
  )
}
