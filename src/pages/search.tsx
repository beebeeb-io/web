import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { FileIcon, getFileType } from '../components/file-icon'
import { EmptyState } from '../components/empty-states/empty-state'
import { useKeys } from '../lib/key-context'
import { formatBytes } from '../lib/format'
import {
  fetchIndex,
  searchIndex,
  createEmptyIndex,
  type SearchIndex,
  type SearchIndexEntry,
  type SearchResult,
} from '../lib/search-index'

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

// ─── Filter taxonomy ─────────────────────────────

type Kind = 'pdf' | 'image' | 'video' | 'audio' | 'doc' | 'code' | 'archive' | 'folder'
type DateRange = 'today' | 'this-week' | 'this-month' | 'this-year'

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

// ─── Search page ─────────────────────────────────

export function Search() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''
  const initialKinds = useMemo(() => parseKindsParam(searchParams.get('kind')), [searchParams])
  const initialDate = useMemo(() => parseDateParam(searchParams.get('modified')), [searchParams])

  const { isUnlocked, getMasterKey } = useKeys()

  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[]>([])
  const [kinds, setKinds] = useState<Set<Kind>>(initialKinds)
  const [dateRange, setDateRange] = useState<DateRange | null>(initialDate)
  const [recent, setRecent] = useState<string[]>(() => loadRecent())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(!!initialQuery)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [indexLoaded, setIndexLoaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Hold the decrypted index in memory
  const indexRef = useRef<SearchIndex | null>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Fetch and decrypt the search index when the vault is unlocked
  useEffect(() => {
    if (!isUnlocked) {
      indexRef.current = null
      setIndexLoaded(false)
      return
    }

    let cancelled = false
    async function loadIndex() {
      try {
        const masterKey = getMasterKey()
        const idx = await fetchIndex(masterKey)
        if (!cancelled) {
          indexRef.current = idx ?? createEmptyIndex()
          setIndexError(null)
          setIndexLoaded(true)
        }
      } catch {
        if (!cancelled) {
          indexRef.current = createEmptyIndex()
          setIndexError('Could not load search index.')
          setIndexLoaded(true)
        }
      }
    }
    loadIndex()
    return () => { cancelled = true }
  }, [isUnlocked, getMasterKey])

  // Search against the local encrypted index
  const runSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    setSearched(true)
    try {
      const idx = indexRef.current
      if (!idx) {
        setResults([])
        return
      }
      setResults(searchIndex(idx, q))
    } finally {
      setLoading(false)
    }
  }, [])

  // Re-run search once index loads (for initial query from URL)
  useEffect(() => {
    if (initialQuery && indexLoaded) {
      runSearch(initialQuery)
    }
  }, [initialQuery, indexLoaded, runSearch])

  // Sync filters → URL whenever they change. Keep `q` in sync only on submit.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (kinds.size > 0) next.set('kind', Array.from(kinds).join(','))
    else next.delete('kind')
    if (dateRange) next.set('modified', dateRange)
    else next.delete('modified')
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [kinds, dateRange, searchParams, setSearchParams])

  function commitQuery(q: string) {
    const trimmed = q.trim()
    const next = new URLSearchParams(searchParams)
    if (trimmed) next.set('q', trimmed)
    else next.delete('q')
    setSearchParams(next)
    if (trimmed) setRecent(saveRecent(trimmed))
    runSearch(q)
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

  // Apply filters
  const dateCutoff = dateRange ? dateRangeStart(dateRange) : null
  const filteredResults = results.filter((r) => {
    if (kinds.size > 0 && !kinds.has(entryKind(r.entry))) return false
    if (dateCutoff !== null) {
      const t = new Date(r.entry.modified).getTime()
      if (Number.isNaN(t) || t < dateCutoff) return false
    }
    return true
  })

  const hasActiveFilters = kinds.size > 0 || dateRange !== null

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
                  · {kinds.size + (dateRange ? 1 : 0)}
                </span>
              )}
            </button>
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
              <button
                type="button"
                onClick={() => { setKinds(new Set()); setDateRange(null) }}
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
              <div className="flex flex-wrap gap-1.5">
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
        <div className="flex-1 overflow-y-auto">
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
              heading={hasActiveFilters && results.length > 0 ? 'No matches with these filters' : 'No files match your search'}
              subtitle={
                hasActiveFilters && results.length > 0
                  ? `${results.length} match${results.length !== 1 ? 'es' : ''} for "${query}", but none pass the active filters. Try removing one.`
                  : `Nothing matched "${query}". We search file names on your device -- file contents stay encrypted on our servers. Try a different term or check your spelling.`
              }
              cta={{
                label: hasActiveFilters && results.length > 0 ? 'Clear filters' : 'Clear search',
                onClick: hasActiveFilters && results.length > 0 ? () => { setKinds(new Set()); setDateRange(null) } : handleClear,
                variant: 'default',
              }}
              secondaryCta={{
                label: 'Check trash',
                icon: 'trash',
                onClick: () => navigate('/trash'),
              }}
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
