import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { FileIcon, getFileType } from '../components/file-icon'
import { EmptyState } from '../components/empty-states/empty-state'
import { useKeys } from '../lib/key-context'
import { useSync } from '../lib/sync-context'
import { useWsEvent } from '../lib/ws-context'
import { useSearchIndex, type SearchIndexEntry } from '../hooks/use-search-index'
import { decryptFileMetadata } from '../lib/crypto'
import { formatBytes } from '../lib/format'

/** A scored search hit — `entry` is built from the live sync tree (B4). */
interface SearchResult {
  id: string
  entry: SearchIndexEntry
  score: number
}

// ─── Helpers ─────────────────────────────────────


function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

// ─── Sort ────────────────────────────────────────

type SortOrder = 'relevance' | 'newest' | 'oldest' | 'largest'

const SORT_OPTIONS: { id: SortOrder; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'newest',    label: 'Newest' },
  { id: 'oldest',    label: 'Oldest' },
  { id: 'largest',   label: 'Largest' },
]

function parseSortParam(raw: string | null): SortOrder {
  const valid = new Set<SortOrder>(SORT_OPTIONS.map((s) => s.id))
  return raw && (valid as Set<string>).has(raw) ? (raw as SortOrder) : 'relevance'
}

// ─── Filter taxonomy ─────────────────────────────

type Kind = 'pdf' | 'image' | 'video' | 'audio' | 'doc' | 'code' | 'archive' | 'folder'
type DateRange = 'today' | 'this-week' | 'this-month' | 'this-year'
type SizeRange = 'small' | 'medium' | 'large'

const KIND_FILTERS: { id: Kind; label: string; icon: IconName }[] = [
  { id: 'pdf',     label: 'PDF',      icon: 'file-text' },
  { id: 'image',   label: 'Images',   icon: 'image' },
  { id: 'video',   label: 'Videos',   icon: 'file-video' },
  { id: 'audio',   label: 'Audio',    icon: 'file-audio' },
  { id: 'doc',     label: 'Docs',     icon: 'file-text' },
  { id: 'code',    label: 'Code',     icon: 'file-code' },
  { id: 'archive', label: 'Archives', icon: 'file-archive' },
  { id: 'folder',  label: 'Folders',  icon: 'folder' },
]

const DATE_FILTERS: { id: DateRange; label: string }[] = [
  { id: 'today',      label: 'Today' },
  { id: 'this-week',  label: 'This week' },
  { id: 'this-month', label: 'This month' },
  { id: 'this-year',  label: 'This year' },
]

const SIZE_FILTERS: { id: SizeRange; label: string; minBytes?: number; maxBytes?: number }[] = [
  { id: 'small',  label: '< 1 MB',     maxBytes: 1_048_576 },
  { id: 'medium', label: '1 – 100 MB', minBytes: 1_048_576,   maxBytes: 104_857_600 },
  { id: 'large',  label: '> 100 MB',   minBytes: 104_857_600 },
]

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tif', 'tiff'])
// HEIC/HEIF route through download-fallback in the previewer; still indexed as images.
const IMAGE_EXTS_ALL = new Set([...IMAGE_EXTS, 'heic', 'heif'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'])
const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'])
const CODE_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'rs', 'go', 'py', 'rb', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'hpp',
  'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'sql', 'json', 'yaml', 'yml', 'toml', 'lua', 'r',
])
const DOC_EXTS = new Set(['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'mdx', 'csv', 'tsv', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp'])

function entryKind(entry: SearchIndexEntry): Kind {
  if (entry.type === 'folder') return 'folder'
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTS_ALL.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (ARCHIVE_EXTS.has(ext)) return 'archive'
  if (CODE_EXTS.has(ext)) return 'code'
  if (DOC_EXTS.has(ext)) return 'doc'
  return 'doc'
}

function dateRangeStart(range: DateRange): number {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (range) {
    case 'today':      return d.getTime()
    case 'this-week':  d.setDate(d.getDate() - 7); return d.getTime()
    case 'this-month': d.setMonth(d.getMonth() - 1); return d.getTime()
    case 'this-year':  d.setFullYear(d.getFullYear() - 1); return d.getTime()
  }
}

// ─── Recent searches ─────────────────────────────

const RECENT_KEY = 'bb_recent_searches'
const RECENT_LIMIT = 5

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

function saveRecent(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return loadRecent()
  const current = loadRecent()
  const without = current.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())
  const next = [trimmed, ...without].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* quota / disabled — fine */ }
  return next
}

function clearRecent(): string[] {
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch { /* ignore */ }
  return []
}

// ─── URL param helpers ───────────────────────────

function parseKindsParam(raw: string | null): Set<Kind> {
  if (!raw) return new Set()
  const valid = new Set<Kind>(KIND_FILTERS.map((k) => k.id))
  return new Set(raw.split(',').filter((k): k is Kind => (valid as Set<string>).has(k)))
}

function parseDateParam(raw: string | null): DateRange | null {
  if (!raw) return null
  const valid = new Set<DateRange>(DATE_FILTERS.map((f) => f.id))
  return (valid as Set<string>).has(raw) ? (raw as DateRange) : null
}

function parseSizeParam(raw: string | null): SizeRange | null {
  if (!raw) return null
  const valid = new Set<SizeRange>(SIZE_FILTERS.map((f) => f.id))
  return (valid as Set<string>).has(raw) ? (raw as SizeRange) : null
}

// ─── Search page ─────────────────────────────────

export function Search() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''
  const initialKinds = useMemo(() => parseKindsParam(searchParams.get('kind')), [searchParams])
  const initialDate = useMemo(() => parseDateParam(searchParams.get('modified')), [searchParams])
  const initialSize = useMemo(() => parseSizeParam(searchParams.get('size')), [searchParams])
  const initialSort = useMemo(() => parseSortParam(searchParams.get('sort')), [searchParams])

  const { isUnlocked, getFileKey } = useKeys()
  const sync = useSync()
  // The shared core-backed index (B4). `query` returns file_ids; the surface
  // resolves each into a renderable SearchResult from the live sync tree.
  // `unindexFiles` prunes the shared index when a delete arrives here.
  // `version` bumps on any index mutation/rebuild so the active query re-runs.
  const { query: queryIndex, unindexFiles, version: indexVersion } = useSearchIndex()

  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[]>([])
  const [kinds, setKinds] = useState<Set<Kind>>(initialKinds)
  const [dateRange, setDateRange] = useState<DateRange | null>(initialDate)
  const [sizeRange, setSizeRange] = useState<SizeRange | null>(initialSize)
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialSort)
  const [recent, setRecent] = useState<string[]>(() => loadRecent())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(!!initialQuery)
  const [indexError, setIndexError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Per-page resolved-name cache (file_id → plaintext). Decrypting a name is a
  // worker round-trip, so cache it; cleared when the index changes (rename).
  const nameCacheRef = useRef<Map<string, string>>(new Map())
  const resolveName = useCallback(
    async (nodeId: string): Promise<string | null> => {
      const cached = nameCacheRef.current.get(nodeId)
      if (cached) return cached
      const node = sync.getNode(nodeId)
      if (!node) return null
      try {
        const key = await getFileKey(node.id)
        const { name } = await decryptFileMetadata(key, node.name_encrypted)
        if (name && name !== 'Encrypted file') {
          nameCacheRef.current.set(nodeId, name)
          return name
        }
      } catch { /* undecryptable now — skip this hit */ }
      return null
    },
    [sync, getFileKey],
  )

  // Build a node's folder path (root → parent) from the live tree.
  const buildPath = useCallback(
    async (nodeId: string): Promise<string> => {
      const parts: string[] = []
      let currentId = sync.getNode(nodeId)?.parent_id ?? null
      for (let depth = 0; depth < 50 && currentId; depth++) {
        const parent = sync.getNode(currentId)
        if (!parent) break
        const pname = await resolveName(parent.id)
        if (pname) parts.unshift(pname)
        currentId = parent.parent_id
      }
      return parts.join('/')
    },
    [sync, resolveName],
  )

  // Resolve a core query for `q` into renderable SearchResults. Metadata (kind,
  // size, modified, parent, starred, path) comes from the live sync tree; the
  // core index supplies the name matches (and their order = relevance).
  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([])
        setSearched(false)
        return
      }
      setLoading(true)
      setSearched(true)
      try {
        const ids = await queryIndex(q)
        const out: SearchResult[] = []
        let rank = ids.length
        for (const id of ids) {
          const node = sync.getNode(id)
          if (!node || node.is_trashed) {
            rank--
            continue
          }
          const name = await resolveName(id)
          if (!name) {
            rank--
            continue
          }
          const entry: SearchIndexEntry = {
            name,
            path: await buildPath(id),
            type: node.is_folder ? 'folder' : (node.mime_type || 'application/octet-stream'),
            size: node.size_bytes,
            parent: node.parent_id,
            starred: node.is_starred,
            created: node.created_at,
            modified: node.updated_at,
            tags: [],
          }
          // Score = core result order (higher = earlier match); preserves the
          // relevance ordering the core scorer produced.
          out.push({ id, entry, score: rank-- })
        }
        setResults(out)
      } catch {
        setResults([])
        setIndexError('Could not load search index.')
      } finally {
        setLoading(false)
      }
    },
    [queryIndex, sync, resolveName, buildPath],
  )

  // Latest input value, read inside effects without making it a dependency.
  const queryRef = useRef(query)
  useEffect(() => { queryRef.current = query }, [query])

  // Re-run the active query whenever the shared index changes (a rebuild/backfill
  // landing, a cross-client rename) — replaces the old `beebeeb:search-index-
  // updated` listener (the context bumps `version` on the same events). Also
  // clears the name cache so a rename reflects.
  useEffect(() => {
    nameCacheRef.current.clear()
    if (isUnlocked && queryRef.current.trim()) {
      void runSearch(queryRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexVersion, isUnlocked])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Run the initial query (from the URL) once unlocked.
  useEffect(() => {
    if (initialQuery && isUnlocked) {
      void runSearch(initialQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, isUnlocked])

  // ─── Remote-deletion reconciliation (works even when sync is down) ───
  //
  // The `sync.ready` guard in `filteredResults` is the live-engine backstop: it
  // drops hits absent from the authoritative tree. But when the SSE sync engine
  // fails to start (an anticipated degraded state — sync.ready stays false), that
  // guard is skipped, and this page has NO other refetch path. A file deleted on
  // another client still lives in the SHARED encrypted index, so it would linger
  // as a stale hit indefinitely. This WS-driven prune fixes that independent of
  // sync.ready: belt-and-suspenders alongside the sync-tree guard.
  //
  // Coalesce a bulk delete's per-file event burst into one trailing pass. We
  // collect ids in a ref and flush on a single debounced timer.
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set())
  const pruneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cleanup: cancel any in-flight debounce so the timer can't fire after unmount.
  useEffect(() => () => {
    if (pruneTimerRef.current !== null) clearTimeout(pruneTimerRef.current)
  }, [])
  useWsEvent(
    ['file.deleted', 'file.trashed'],
    useCallback((event) => {
      // WS delete/trash events carry `{ id }` (see drive.tsx handler).
      const id = (event.data as { id?: string }).id
      if (!id) return
      pendingDeleteIdsRef.current.add(id)
      if (pruneTimerRef.current !== null) clearTimeout(pruneTimerRef.current)
      pruneTimerRef.current = setTimeout(() => {
        pruneTimerRef.current = null
        const ids = pendingDeleteIdsRef.current
        if (ids.size === 0) return
        pendingDeleteIdsRef.current = new Set()
        // (a) Correct the SHARED core index via the hook (removes the shard
        //     entries + re-publishes the dirty buckets).
        void unindexFiles([...ids])
        // (b) Make the visible list reflect the prune by dropping the ids
        //     directly. A functional, membership-based filter is idempotent and
        //     re-running it can't resurface a hit — so this cannot loop. The
        //     core index itself is corrected by (a); a later re-search reflects it.
        setResults((prev) => {
          if (prev.length === 0) return prev
          const filtered = prev.filter((r) => !ids.has(r.id))
          return filtered.length === prev.length ? prev : filtered
        })
      }, 350)
    }, [unindexFiles]),
  )

  // Sync filters → URL whenever they change. Keep `q` in sync only on submit.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (kinds.size > 0) next.set('kind', Array.from(kinds).join(','))
    else next.delete('kind')
    if (dateRange) next.set('modified', dateRange)
    else next.delete('modified')
    if (sizeRange) next.set('size', sizeRange)
    else next.delete('size')
    if (sortOrder !== 'relevance') next.set('sort', sortOrder)
    else next.delete('sort')
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [kinds, dateRange, sizeRange, sortOrder, searchParams, setSearchParams])

  function commitQuery(q: string) {
    const trimmed = q.trim()
    const next = new URLSearchParams(searchParams)
    if (trimmed) next.set('q', trimmed)
    else next.delete('q')
    setSearchParams(next)
    if (trimmed) setRecent(saveRecent(trimmed))
    void runSearch(q)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    commitQuery(query)
  }

  const handleClear = () => {
    setQuery('')
    setResults([])
    setSearched(false)
    setKinds(new Set())
    setDateRange(null)
    setSizeRange(null)
    setSortOrder('relevance')
    setSearchParams({})
    inputRef.current?.focus()
  }

  function toggleKind(k: Kind) {
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function pickDate(d: DateRange | null) {
    setDateRange((cur) => (cur === d ? null : d))
  }

  function pickSize(s: SizeRange | null) {
    setSizeRange((cur) => (cur === s ? null : s))
  }

  // Apply filters + sort
  const filteredResults = useMemo(() => {
    const dateCutoff = dateRange ? dateRangeStart(dateRange) : null
    const activeSizeFilter = sizeRange ? SIZE_FILTERS.find((f) => f.id === sizeRange) : null

    const filtered = results.filter((r) => {
      // Authoritative-tree guard for cross-client staleness: the encrypted
      // index is shared across the user's clients, so a file deleted on another
      // client can still have an index entry here (its WS-driven unindex only
      // runs on the deleting client). When the sync engine is live, drop any
      // hit whose id is absent from the authoritative tree. Guarded on
      // sync.ready so a not-yet-loaded engine never hides legitimate results.
      if (sync.ready && !sync.getNode(r.id)) return false
      if (kinds.size > 0 && !kinds.has(entryKind(r.entry))) return false
      if (dateCutoff !== null) {
        const t = new Date(r.entry.modified).getTime()
        if (Number.isNaN(t) || t < dateCutoff) return false
      }
      if (activeSizeFilter && r.entry.type !== 'folder') {
        const sz = r.entry.size
        if (activeSizeFilter.minBytes !== undefined && sz < activeSizeFilter.minBytes) return false
        if (activeSizeFilter.maxBytes !== undefined && sz >= activeSizeFilter.maxBytes) return false
      }
      return true
    })

    // Apply sort (relevance = original score order from searchIndex)
    if (sortOrder === 'newest') {
      return [...filtered].sort((a, b) => new Date(b.entry.modified).getTime() - new Date(a.entry.modified).getTime())
    } else if (sortOrder === 'oldest') {
      return [...filtered].sort((a, b) => new Date(a.entry.modified).getTime() - new Date(b.entry.modified).getTime())
    } else if (sortOrder === 'largest') {
      return [...filtered].sort((a, b) => b.entry.size - a.entry.size)
    }
    return filtered
  // sync.getNode is read via the live engine; sync.treeVersion bumps on every
  // tree mutation so a deletion landing while results are shown re-derives this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, kinds, dateRange, sizeRange, sortOrder, sync.ready, sync.treeVersion])

  const hasActiveFilters = kinds.size > 0 || dateRange !== null || sizeRange !== null || sortOrder !== 'relevance'

  return (
    <DriveLayout>
        {/* Search header */}
        <div className="px-5 py-4 border-b border-line">
          <form onSubmit={handleSubmit} className="flex items-center gap-3 max-w-[42rem]">
            <div className="flex-1 flex items-center gap-2.5 border rounded-lg bg-paper px-3.5 py-2.5 border-line focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep">
              <Icon name="search" size={14} className="text-ink-3 shrink-0" />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your vault..."
                className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-ink-4 hover:text-ink-2 transition-colors"
                  aria-label="Clear search"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12.5px] border transition-colors cursor-pointer ${
                filtersOpen || hasActiveFilters
                  ? 'bg-amber-bg text-amber-deep border-amber-deep'
                  : 'bg-paper text-ink-2 border-line hover:bg-paper-2'
              }`}
            >
              <Icon name="settings" size={12} />
              Filters
              {hasActiveFilters && (
                <span className="font-mono text-[10px] tabular-nums">
                  · {kinds.size + (dateRange ? 1 : 0) + (sizeRange ? 1 : 0) + (sortOrder !== 'relevance' ? 1 : 0)}
                </span>
              )}
            </button>
            {/* Sort dropdown */}
            <div className="relative flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <Icon name="menu" size={12} className="text-ink-3 shrink-0" />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="appearance-none bg-transparent text-[12.5px] text-ink-2 outline-none cursor-pointer pr-3"
                aria-label="Sort results"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={10} className="text-ink-3 shrink-0 pointer-events-none absolute right-0" />
            </div>
            <BBButton size="md" variant="amber" type="submit">
              Search
            </BBButton>
          </form>

          {/* Active filter chips (always visible when set) */}
          {hasActiveFilters && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {Array.from(kinds).map((k) => {
                const meta = KIND_FILTERS.find((f) => f.id === k)
                if (!meta) return null
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleKind(k)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] bg-amber-bg text-amber-deep border border-amber-deep/40 hover:border-amber-deep transition-colors cursor-pointer"
                  >
                    <Icon name={meta.icon} size={10} />
                    kind:{meta.id}
                    <Icon name="x" size={9} className="ml-0.5" />
                  </button>
                )
              })}
              {dateRange && (
                <button
                  type="button"
                  onClick={() => setDateRange(null)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] bg-amber-bg text-amber-deep border border-amber-deep/40 hover:border-amber-deep transition-colors cursor-pointer"
                >
                  <Icon name="clock" size={10} />
                  modified:{dateRange}
                  <Icon name="x" size={9} className="ml-0.5" />
                </button>
              )}
              {sizeRange && (() => {
                const meta = SIZE_FILTERS.find((f) => f.id === sizeRange)
                if (!meta) return null
                return (
                  <button
                    type="button"
                    onClick={() => setSizeRange(null)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] bg-amber-bg text-amber-deep border border-amber-deep/40 hover:border-amber-deep transition-colors cursor-pointer"
                  >
                    <Icon name="cloud" size={10} />
                    size:{meta.label}
                    <Icon name="x" size={9} className="ml-0.5" />
                  </button>
                )
              })()}
              {sortOrder !== 'relevance' && (
                <button
                  type="button"
                  onClick={() => setSortOrder('relevance')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] bg-amber-bg text-amber-deep border border-amber-deep/40 hover:border-amber-deep transition-colors cursor-pointer"
                >
                  <Icon name="menu" size={10} />
                  sort:{sortOrder}
                  <Icon name="x" size={9} className="ml-0.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => { setKinds(new Set()); setDateRange(null); setSizeRange(null); setSortOrder('relevance') }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-ink-3 hover:text-ink-2 hover:bg-paper-2 transition-colors cursor-pointer"
              >
                Clear filters
              </button>
            </div>
          )}

          {/* Filter palette (collapsible) */}
          {filtersOpen && (
            <div className="mt-3 rounded-md border border-line bg-paper-2 p-3 max-w-[42rem]">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-1.5">Kind</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {KIND_FILTERS.map((f) => {
                  const active = kinds.has(f.id)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleKind(f.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors cursor-pointer border ${
                        active
                          ? 'bg-amber-bg text-amber-deep border-amber-deep'
                          : 'bg-paper text-ink-3 border-line hover:bg-paper-2 hover:text-ink-2'
                      }`}
                    >
                      <Icon name={f.icon} size={11} />
                      {f.label}
                    </button>
                  )
                })}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-1.5">Modified</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {DATE_FILTERS.map((f) => {
                  const active = dateRange === f.id
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => pickDate(f.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors cursor-pointer border ${
                        active
                          ? 'bg-amber-bg text-amber-deep border-amber-deep'
                          : 'bg-paper text-ink-3 border-line hover:bg-paper-2 hover:text-ink-2'
                      }`}
                    >
                      <Icon name="clock" size={11} />
                      {f.label}
                    </button>
                  )
                })}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-1.5">Size</div>
              <div className="flex flex-wrap gap-1.5">
                {SIZE_FILTERS.map((f) => {
                  const active = sizeRange === f.id
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => pickSize(f.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors cursor-pointer border ${
                        active
                          ? 'bg-amber-bg text-amber-deep border-amber-deep'
                          : 'bg-paper text-ink-3 border-line hover:bg-paper-2 hover:text-ink-2'
                      }`}
                    >
                      <Icon name="cloud" size={11} />
                      {f.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Recent searches — only when input is empty and we haven't searched */}
          {!searched && !query && recent.length > 0 && (
            <div className="mt-3 max-w-[42rem]">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Recent</span>
                <button
                  type="button"
                  onClick={() => setRecent(clearRecent())}
                  className="ml-auto text-[10.5px] text-ink-4 hover:text-ink-3 transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => { setQuery(q); commitQuery(q) }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] bg-paper border border-line text-ink-2 hover:bg-paper-2 hover:border-line-2 transition-colors cursor-pointer"
                  >
                    <Icon name="search" size={10} className="text-ink-4" />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Index error banner */}
        {indexError && (
          <div className="px-5 py-2 bg-amber-bg border-b border-amber-deep/30 text-[12px] text-ink-2 flex items-center gap-2">
            <Icon name="shield" size={12} className="text-amber-deep" />
            {indexError} Results may be incomplete.
          </div>
        )}

        {/* Vault locked banner */}
        {!isUnlocked && (
          <div className="px-5 py-2 bg-paper-2 border-b border-line text-[12px] text-ink-3 flex items-center gap-2">
            <Icon name="lock" size={12} className="text-ink-4" />
            Vault is locked. Log in to search your encrypted files.
          </div>
        )}

        {/* Results area */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!searched ? (
            /* Empty state: no search yet */
            <EmptyState
              icon="search"
              heading="Start typing to search your encrypted vault"
              subtitle="File names are searched client-side against your encrypted index. Content never leaves your device unencrypted."
              cta={{
                label: 'Go to drive',
                icon: 'folder',
                onClick: () => navigate('/'),
                variant: 'default',
              }}
              hint="Tip: press Cmd+K from anywhere to open search."
            />
          ) : loading ? (
            <div className="px-5 py-12 text-center text-sm text-ink-3">Searching...</div>
          ) : filteredResults.length === 0 ? (
            /* Empty results */
            <EmptyState
              icon="search"
              heading={
                hasActiveFilters && results.length > 0
                  ? 'No matches with these filters'
                  : `No files found for “${query}”`
              }
              subtitle={
                hasActiveFilters && results.length > 0
                  ? `${results.length} match${results.length !== 1 ? 'es' : ''} for “${query}”, but none pass the active filters. Try removing one.`
                  : `We search filenames on your device — file contents stay encrypted on our servers.`
              }
              cta={{
                label: hasActiveFilters && results.length > 0 ? 'Clear filters' : 'Clear search',
                icon: 'x',
                onClick: hasActiveFilters && results.length > 0 ? () => { setKinds(new Set()); setDateRange(null); setSizeRange(null) } : handleClear,
                variant: 'default',
              }}
              secondaryCta={{
                label: 'Check trash',
                icon: 'trash',
                onClick: () => navigate('/trash'),
              }}
              hint={
                hasActiveFilters && results.length > 0
                  ? undefined
                  : 'Tip: Try searching for a file type like “pdf”, “jpg”, or a date like “May”'
              }
            />
          ) : (
            <>
              {/* Results header */}
              <div className="px-5 py-2 border-b border-line bg-paper-2 flex items-center gap-3">
                <span className="text-[11px] text-ink-3">
                  <span className="font-mono">{filteredResults.length}</span> result{filteredResults.length !== 1 ? 's' : ''}
                  {hasActiveFilters && results.length !== filteredResults.length && (
                    <span className="text-ink-4"> · <span className="font-mono">{results.length - filteredResults.length}</span> filtered out</span>
                  )} for "{query}"
                </span>
                <span className="flex items-center gap-1.5 ml-auto text-[10px] text-ink-4">
                  <Icon name="shield" size={10} className="text-amber-deep" />
                  Index decrypted locally
                </span>
              </div>

              {/* Table header */}
              <div
                className="px-5 py-2 border-b border-line bg-paper-2"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 100px 100px 100px',
                  gap: 14,
                }}
              >
                <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Modified</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Path</span>
              </div>

              {/* File rows */}
              {filteredResults.map((result, i, arr) => {
                const { id, entry } = result
                const fileType = getFileType(entry.name, entry.type === 'folder')
                return (
                  <div
                    key={id}
                    className="group hover:bg-paper-2 transition-colors cursor-pointer"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.4fr 100px 100px 100px',
                      gap: 14,
                      padding: '10px 20px',
                      alignItems: 'center',
                      borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
                    }}
                    onClick={() => {
                      // Folders: navigate into the folder
                      // Files: navigate to the parent folder so the file is visible
                      const targetFolderId = entry.type === 'folder' ? id : entry.parent
                      const targetFolderName = entry.type === 'folder' ? entry.name : (entry.path || 'All files')
                      navigate('/', {
                        state: {
                          openFolderId: targetFolderId,
                          openFolderName: targetFolderName,
                          // For file results: auto-select the file in the drive view
                          openFileId: entry.type === 'folder' ? undefined : id,
                        },
                      })
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileIcon type={fileType} size={24} />
                      <span className="text-[13px] text-ink truncate">{entry.name}</span>
                      {entry.starred && (
                        <Icon name="star" size={10} className="text-amber-deep shrink-0" />
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-ink-3">{timeAgo(entry.modified)}</span>
                    <span className="font-mono text-[11px] text-ink-3">
                      {entry.type === 'folder' ? '--' : formatBytes(entry.size)}
                    </span>
                    <span className="text-[11px] text-ink-3 truncate">{entry.path || '/'}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Status bar */}
        <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <Icon name="shield" size={12} className="text-amber-deep" />
            Encrypted at rest -- AES-256-GCM
          </span>
          <span className="ml-auto font-mono text-[10px] text-ink-4">
            Search is client-side only -- index decrypted in memory
          </span>
        </div>
    </DriveLayout>
  )
}
