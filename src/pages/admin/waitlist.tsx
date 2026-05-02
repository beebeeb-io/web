import { useState, useEffect, useMemo, useCallback } from 'react'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { useToast } from '../../components/toast'
import { AdminShell } from './admin-shell'
import { getWaitlist } from '../../lib/api'
import type { WaitlistEntry } from '../../lib/api'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function AdminWaitlist() {
  const { showToast } = useToast()
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [count, setCount] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getWaitlist()
      const sorted = [...data.entries].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      setEntries(sorted)
      setCount(data.count)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load waitlist')
      setEntries([])
      setCount(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.trim().toLowerCase()
    return entries.filter(e => e.email.toLowerCase().includes(q))
  }, [entries, search])

  function handleExportCsv() {
    if (entries.length === 0) {
      showToast({ icon: 'x', title: 'Nothing to export', danger: true })
      return
    }
    const header = 'email,source,joined_at'
    const rows = entries.map(e =>
      [e.email, e.source ?? '', e.created_at].map(escapeCsv).join(','),
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `waitlist-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AdminShell activeSection="waitlist">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <Icon name="mail" size={13} className="text-ink-2" />
        <h2 className="text-sm font-semibold text-ink">Waitlist</h2>
        <BBChip variant="amber">
          {count.toLocaleString()} {count === 1 ? 'signup' : 'signups'}
        </BBChip>
        <BBButton
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={handleExportCsv}
          disabled={loading || entries.length === 0}
        >
          <Icon name="download" size={11} className="mr-1.5" />
          Export CSV
        </BBButton>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-line bg-paper-2">
        <Icon name="search" size={12} className="text-ink-3" />
        <input
          type="text"
          className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-4"
          placeholder="Filter by email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-ink-3 hover:text-ink transition-colors"
            aria-label="Clear search"
          >
            <Icon name="x" size={11} />
          </button>
        )}
        <BBChip>{filtered.length.toLocaleString()} shown</BBChip>
      </div>

      {/* Column headers */}
      <div
        className="grid px-5 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line bg-paper-2"
        style={{ gridTemplateColumns: '1fr 160px 180px' }}
      >
        <span>Email</span>
        <span>Source</span>
        <span>Joined</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : error ? (
          <div className="px-5 py-8 text-center">
            <div className="text-xs text-red mb-2">{error}</div>
            <BBButton size="sm" variant="ghost" onClick={() => void load()}>Retry</BBButton>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-3">
            {search ? `No signups matching "${search}"` : 'No signups yet'}
          </div>
        ) : (
          filtered.map((e, idx) => (
            <div
              key={`${e.email}-${e.created_at}`}
              className={`grid px-5 py-2.5 text-xs border-b border-line items-center transition-colors hover:bg-paper-2 ${
                idx % 2 === 1 ? 'bg-paper-2/50' : ''
              }`}
              style={{ gridTemplateColumns: '1fr 160px 180px' }}
            >
              <span className="font-mono text-[11px] text-ink truncate">{e.email}</span>
              <span>
                {e.source ? (
                  <BBChip>{e.source}</BBChip>
                ) : (
                  <span className="text-ink-4 font-mono text-[11px]">---</span>
                )}
              </span>
              <span className="font-mono text-[11px] text-ink-3">
                {formatDateTime(e.created_at)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3 mt-auto">
        <Icon name="shield" size={11} className="text-ink-3" />
        <span>Waitlist data is stored in Falkenstein. Hetzner.</span>
        <span className="ml-auto font-mono">
          Sorted by most recent first
        </span>
      </div>
    </AdminShell>
  )
}
