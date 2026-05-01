import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { FileIcon, getFileType } from '../components/file-icon'
import { EmptyState } from '../components/empty-states/empty-state'
import { useKeys } from '../lib/key-context'
import {
  fetchIndex,
  searchIndex,
  createEmptyIndex,
  type SearchIndex,
  type SearchResult,
} from '../lib/search-index'

// ─── Helpers ─────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

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

// ─── Filter types ────────────────────────────────

type FileTypeFilter = 'all' | 'documents' | 'images' | 'folders'

const FILE_TYPE_FILTERS: { id: FileTypeFilter; label: string; icon: IconName }[] = [
  { id: 'all', label: 'All types', icon: 'file' },
  { id: 'documents', label: 'Documents', icon: 'file' },
  { id: 'images', label: 'Images', icon: 'image' },
  { id: 'folders', label: 'Folders', icon: 'folder' },
]

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'svg']

// ─── Search page ─────────────────────────────────

export function Search() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''

  const { isUnlocked, getMasterKey } = useKeys()

  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<SearchResult[]>([])
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>('all')
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchParams(query ? { q: query } : {})
    runSearch(query)
  }

  const handleClear = () => {
    setQuery('')
    setResults([])
    setSearched(false)
    setSearchParams({})
    inputRef.current?.focus()
  }

  // Apply type filter
  const filteredResults = results.filter((r) => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'folders') return r.entry.type === 'folder'
    if (typeFilter === 'images') {
      const ext = r.entry.name.split('.').pop()?.toLowerCase() ?? ''
      return IMAGE_EXTENSIONS.includes(ext)
    }
    // documents = not folder and not image
    if (typeFilter === 'documents') {
      const ext = r.entry.name.split('.').pop()?.toLowerCase() ?? ''
      return r.entry.type !== 'folder' && !IMAGE_EXTENSIONS.includes(ext)
    }
    return true
  })

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
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
            <BBButton size="md" variant="amber" type="submit">
              Search
            </BBButton>
          </form>

          {/* Type filters */}
          {searched && (
            <div className="flex gap-1.5 mt-3">
              {FILE_TYPE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setTypeFilter(f.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors cursor-pointer ${
                    typeFilter === f.id
                      ? 'bg-amber-bg text-amber-deep font-medium border border-amber-deep'
                      : 'text-ink-3 hover:bg-paper-2 border border-transparent'
                  }`}
                >
                  <Icon name={f.icon} size={11} />
                  {f.label}
                </button>
              ))}
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
              heading="No files match your search"
              subtitle={`Nothing matched "${query}". We search file names on your device -- file contents stay encrypted on our servers. Try a different term or check your spelling.`}
              cta={{
                label: 'Clear search',
                onClick: handleClear,
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
                  <span className="font-mono">{filteredResults.length}</span> result{filteredResults.length !== 1 ? 's' : ''} for "{query}"
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
