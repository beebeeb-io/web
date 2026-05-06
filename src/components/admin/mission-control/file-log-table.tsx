/**
 * Structured file log for post-migration review.
 *
 * Sortable, filterable, searchable table — all client-side over the snapshot
 * `files` array. Mirrors the visual conventions of `pages/admin/users.tsx`:
 * grid-based rows, mono small caps for column headers, BBChip for status,
 * BBButton for retry, paper-2 zebra striping on hover.
 */

import { useMemo, useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { formatBytes } from '../../../lib/format'
import type { MigrationFileEntry, MigrationFileStatus } from './types'

interface FileLogTableProps {
  files: MigrationFileEntry[]
  onRetry: (fileId: string) => void
}

type SortKey = 'status' | 'file_id' | 'size_bytes' | 'duration' | 'speed'
type SortDir = 'asc' | 'desc'
type StatusFilter = 'all' | MigrationFileStatus

const PAGE_SIZE = 50

// Ordering used when sorting by status — groups failed/copying near the top
// where an operator typically wants to look first.
const STATUS_RANK: Record<MigrationFileStatus, number> = {
  failed: 0,
  copying: 1,
  verifying: 2,
  pending: 3,
  done: 4,
  cancelled: 5,
}

const STATUS_DOT: Record<MigrationFileStatus, string> = {
  done: 'var(--color-green)',
  failed: 'var(--color-red)',
  copying: 'var(--color-amber-deep)',
  verifying: 'var(--color-amber-deep)',
  pending: 'var(--color-ink-4)',
  cancelled: 'var(--color-ink-3)',
}

const STATUS_LABEL: Record<MigrationFileStatus, string> = {
  done: 'Done',
  failed: 'Failed',
  copying: 'Copying',
  verifying: 'Verifying',
  pending: 'Pending',
  cancelled: 'Cancelled',
}

function durationMs(f: MigrationFileEntry): number | null {
  if (!f.started_at) return null
  const start = new Date(f.started_at).getTime()
  const end = f.completed_at ? new Date(f.completed_at).getTime() : Date.now()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.max(0, end - start)
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.floor(s % 60)
  return `${m}m${String(rem).padStart(2, '0')}s`
}

function bytesPerSec(f: MigrationFileEntry): number | null {
  const ms = durationMs(f)
  if (!ms || ms === 0) return null
  if (f.bytes_copied <= 0) return null
  return Math.round((f.bytes_copied / ms) * 1000)
}

function formatSpeed(f: MigrationFileEntry): string {
  const v = bytesPerSec(f)
  if (v === null) return '—'
  return `${formatBytes(v)}/s`
}

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
  { value: 'copying', label: 'Copying' },
  { value: 'pending', label: 'Pending' },
]

export function FileLogTable({ files, onRetry }: FileLogTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [retrying, setRetrying] = useState<string | null>(null)

  // Pre-compute counts per status for the tab badges (whole dataset, not the
  // currently-filtered slice — the badge is meant to advertise totals).
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: files.length,
      pending: 0,
      copying: 0,
      verifying: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    }
    for (const f of files) c[f.status] += 1
    return c
  }, [files])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return files.filter((f) => {
      if (statusFilter !== 'all' && f.status !== statusFilter) return false
      if (q && !f.file_id.toLowerCase().includes(q)) return false
      return true
    })
  }, [files, statusFilter, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'status':
          cmp = STATUS_RANK[a.status] - STATUS_RANK[b.status]
          if (cmp === 0) cmp = a.file_id.localeCompare(b.file_id)
          break
        case 'file_id':
          cmp = a.file_id.localeCompare(b.file_id)
          break
        case 'size_bytes':
          cmp = a.size_bytes - b.size_bytes
          break
        case 'duration': {
          const da = durationMs(a) ?? -1
          const db = durationMs(b) ?? -1
          cmp = da - db
          break
        }
        case 'speed': {
          const sa = bytesPerSec(a) ?? -1
          const sb = bytesPerSec(b) ?? -1
          cmp = sa - sb
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageSlice = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'size_bytes' || key === 'duration' || key === 'speed' ? 'desc' : 'asc')
    }
  }

  function handleStatusChange(next: StatusFilter) {
    setStatusFilter(next)
    setPage(0)
  }

  function handleSearchChange(v: string) {
    setSearch(v)
    setPage(0)
  }

  async function handleRetry(fileId: string) {
    setRetrying(fileId)
    try {
      await onRetry(fileId)
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className="rounded-lg border border-line bg-paper overflow-hidden">
      {/* Filter + search bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-paper-2">
        <div className="flex items-center gap-0">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.value
            const count = counts[tab.value]
            return (
              <button
                key={tab.value}
                onClick={() => handleStatusChange(tab.value)}
                className={`px-2.5 py-1 text-[11px] border-b-2 transition-colors ${
                  active
                    ? 'border-amber font-semibold text-ink'
                    : 'border-transparent text-ink-3 hover:text-ink-2'
                }`}
              >
                {tab.label}{' '}
                <span className="font-mono text-[10px] text-ink-4">{count}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 ml-auto bg-paper border border-line-2 rounded-md px-2 py-1 min-w-[220px]">
          <Icon name="search" size={11} className="text-ink-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by file ID…"
            className="flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-4 font-mono"
          />
          {search && (
            <button
              onClick={() => handleSearchChange('')}
              className="text-ink-3 hover:text-ink transition-colors"
              aria-label="Clear search"
            >
              <Icon name="x" size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div
        className="grid px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line bg-paper-2"
        style={{ gridTemplateColumns: '110px 1fr 90px 90px 100px 1.4fr 80px' }}
      >
        <SortHeader label="Status" active={sortKey === 'status'} dir={sortDir} onClick={() => handleSort('status')} />
        <SortHeader label="File ID" active={sortKey === 'file_id'} dir={sortDir} onClick={() => handleSort('file_id')} />
        <SortHeader label="Size" align="right" active={sortKey === 'size_bytes'} dir={sortDir} onClick={() => handleSort('size_bytes')} />
        <SortHeader label="Duration" align="right" active={sortKey === 'duration'} dir={sortDir} onClick={() => handleSort('duration')} />
        <SortHeader label="Speed" align="right" active={sortKey === 'speed'} dir={sortDir} onClick={() => handleSort('speed')} />
        <span>Error</span>
        <span />
      </div>

      {/* Rows */}
      <div className="divide-y divide-line">
        {pageSlice.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-3">
            {search
              ? `No files matching "${search}"`
              : statusFilter === 'all'
              ? 'No files in this run yet.'
              : `No files in status "${STATUS_LABEL[statusFilter as MigrationFileStatus] ?? statusFilter}".`}
          </div>
        ) : (
          pageSlice.map((f) => {
            const dur = formatDuration(durationMs(f))
            const speed = formatSpeed(f)
            return (
              <div
                key={f.file_id}
                className="grid px-3 py-2.5 text-xs items-center hover:bg-paper-2 transition-colors"
                style={{ gridTemplateColumns: '110px 1fr 90px 90px 100px 1.4fr 80px' }}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: STATUS_DOT[f.status] }}
                  />
                  <span className="text-[11px] text-ink-2">
                    {STATUS_LABEL[f.status]}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-ink truncate min-w-0" title={f.file_id}>
                  {f.file_id}
                </span>
                <span className="font-mono text-[11px] text-ink-2 text-right tabular-nums">
                  {formatBytes(f.size_bytes)}
                </span>
                <span className="font-mono text-[11px] text-ink-2 text-right tabular-nums">
                  {dur}
                </span>
                <span className="font-mono text-[11px] text-ink-2 text-right tabular-nums">
                  {speed}
                </span>
                <span
                  className={`font-mono text-[11px] truncate min-w-0 ${
                    f.error ? 'text-red' : 'text-ink-4'
                  }`}
                  title={f.error ?? undefined}
                >
                  {f.error ?? '—'}
                </span>
                <span className="flex justify-end">
                  {f.status === 'failed' ? (
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRetry(f.file_id)}
                      disabled={retrying === f.file_id}
                    >
                      {retrying === f.file_id ? 'Retrying…' : 'Retry'}
                    </BBButton>
                  ) : null}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Pagination footer */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-line bg-paper-2 text-[11px] text-ink-3">
        <span className="font-mono">
          {sorted.length.toLocaleString()} {sorted.length === 1 ? 'file' : 'files'}
        </span>
        {totalPages > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <BBButton
              size="sm"
              variant="ghost"
              disabled={safePage === 0}
              onClick={() => setPage(Math.max(0, safePage - 1))}
            >
              Previous
            </BBButton>
            <span className="font-mono text-[11px]">
              {safePage + 1} / {totalPages}
            </span>
            <BBButton
              size="sm"
              variant="ghost"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </BBButton>
          </div>
        )}
      </div>
    </div>
  )
}

interface SortHeaderProps {
  label: string
  active: boolean
  dir: SortDir
  align?: 'left' | 'right'
  onClick: () => void
}

function SortHeader({ label, active, dir, align = 'left', onClick }: SortHeaderProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 ${
        align === 'right' ? 'justify-end' : 'justify-start'
      } text-[10px] font-mono uppercase tracking-wide transition-colors ${
        active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
      }`}
    >
      {label}
      <span
        aria-hidden
        className={`text-[8px] ${active ? 'opacity-100' : 'opacity-30'}`}
      >
        {active && dir === 'desc' ? '▼' : '▲'}
      </span>
    </button>
  )
}
