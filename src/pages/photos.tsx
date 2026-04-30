import { useState, useEffect, useCallback, useRef } from 'react'
import { BBButton } from '../components/bb-button'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { listFiles, type DriveFile } from '../lib/api'
import { useKeys } from '../lib/key-context'
import { decryptFilename, fromBase64 } from '../lib/crypto'
import { fetchAndDecryptThumbnail } from '../lib/thumbnail'

// ─── Constants ──────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif',
  'bmp', 'tiff', 'tif', 'avif', 'svg', 'ico',
])

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v',
])

const MEDIA_MIME_PREFIXES = ['image/', 'video/']

// ─── Photo types ────────────────────────────────

interface PhotoGroup {
  date: string
  place: string | null
  items: PhotoItem[]
}

interface PhotoItem {
  id: string
  name: string
  sizeBytes: number
  isVideo: boolean
  duration: string | null
  isShared: boolean
  isFeatured: boolean
  hasThumbnail: boolean
}

/** Check if a filename or MIME type represents a media file (image/video). */
function isMediaFile(name: string, mimeType: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) return true
  return MEDIA_MIME_PREFIXES.some((p) => mimeType.startsWith(p))
}

function isVideoFile(name: string, mimeType: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (VIDEO_EXTENSIONS.has(ext)) return true
  return mimeType.startsWith('video/')
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Group a flat list of photo items by date string. */
function groupByDate(items: PhotoItem[], files: DriveFile[]): PhotoGroup[] {
  const dateMap = new Map<string, PhotoItem[]>()

  // Build a lookup for dates by file ID
  const fileDateMap = new Map<string, string>()
  for (const f of files) {
    fileDateMap.set(f.id, f.created_at)
  }

  for (const item of items) {
    const dateStr = fileDateMap.get(item.id) ?? new Date().toISOString()
    const date = new Date(dateStr)
    const label = date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const existing = dateMap.get(label)
    if (existing) {
      existing.push(item)
    } else {
      dateMap.set(label, [item])
    }
  }

  // Sort groups newest first
  return Array.from(dateMap.entries())
    .sort((a, b) => {
      // Parse dates for sorting — use the first item's file date
      const dateA = fileDateMap.get(a[1][0].id) ?? ''
      const dateB = fileDateMap.get(b[1][0].id) ?? ''
      return new Date(dateB).getTime() - new Date(dateA).getTime()
    })
    .map(([date, items]) => ({
      date,
      place: null,
      items,
    }))
}

// ─── Deterministic warm gradient for placeholders ─

function placeholderGradient(index: number): string {
  const hues = [55, 65, 42, 75, 50, 60, 48, 70, 58, 44]
  const chromas = [0.14, 0.16, 0.18, 0.12, 0.15, 0.17, 0.13, 0.19, 0.14, 0.16]
  const lightA = [0.88, 0.84, 0.86, 0.90, 0.82, 0.87, 0.85, 0.89, 0.83, 0.86]
  const lightB = [0.72, 0.68, 0.70, 0.74, 0.66, 0.71, 0.69, 0.73, 0.67, 0.70]
  const i = index % 10
  return `linear-gradient(135deg, oklch(${lightA[i]} ${chromas[i]} ${hues[i]}), oklch(${lightB[i]} ${chromas[(i + 3) % 10]} ${hues[(i + 5) % 10]}))`
}

// ─── Tab selector ───────────────────────────────

const TABS = ['All', 'Albums', 'People', 'Places'] as const

// ─── Date range options ─────────────────────────

const DATE_RANGES = ['Last 7 days', 'Last 30 days', 'Last 3 months', 'All time'] as const

// ─── Photos page ────────────────────────────────

export function Photos() {
  const { getFileKey, isUnlocked } = useKeys()
  const [activeTab, setActiveTab] = useState(0)
  const [dateRange, setDateRange] = useState<(typeof DATE_RANGES)[number]>('All time')
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false)
  const [allFiles, setAllFiles] = useState<DriveFile[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const loadingThumbs = useRef(new Set<string>())
  const [loading, setLoading] = useState(true)

  // Fetch all files recursively (flat list)
  const fetchAllFiles = useCallback(async () => {
    setLoading(true)
    try {
      const files = await listFiles(undefined, false)
      setAllFiles(files)
    } catch {
      setAllFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAllFiles()
  }, [fetchAllFiles])

  // Decrypt file names
  useEffect(() => {
    if (!isUnlocked || allFiles.length === 0) {
      if (!isUnlocked) setDecryptedNames({})
      return
    }
    let cancelled = false
    async function decryptAll() {
      const names: Record<string, string> = {}
      for (const file of allFiles) {
        if (cancelled) return
        try {
          const parsed = JSON.parse(file.name_encrypted) as {
            nonce: string
            ciphertext: string
          }
          const fileKey = await getFileKey(file.id)
          names[file.id] = await decryptFilename(
            fileKey,
            fromBase64(parsed.nonce),
            fromBase64(parsed.ciphertext),
          )
        } catch {
          names[file.id] = file.name_encrypted
        }
      }
      if (!cancelled) setDecryptedNames(names)
    }
    decryptAll()
    return () => { cancelled = true }
  }, [allFiles, isUnlocked, getFileKey])

  const loadThumbnail = useCallback(async (fileId: string) => {
    if (thumbnails[fileId] || loadingThumbs.current.has(fileId)) return
    loadingThumbs.current.add(fileId)
    try {
      const fileKey = await getFileKey(fileId)
      const url = await fetchAndDecryptThumbnail(fileId, fileKey)
      if (url) setThumbnails((prev) => ({ ...prev, [fileId]: url }))
    } catch { /* ignore */ }
  }, [thumbnails, getFileKey])

  function displayName(file: DriveFile): string {
    return decryptedNames[file.id] ?? file.name_encrypted
  }

  // Filter to media files only
  const mediaFiles = allFiles.filter((f) => {
    if (f.is_folder) return false
    const name = displayName(f)
    return isMediaFile(name, f.mime_type)
  })

  // Apply date range filter
  const filteredFiles = mediaFiles.filter((f) => {
    if (dateRange === 'All time') return true
    const fileDate = new Date(f.created_at).getTime()
    const now = Date.now()
    if (dateRange === 'Last 7 days') return now - fileDate < 7 * 24 * 60 * 60 * 1000
    if (dateRange === 'Last 30 days') return now - fileDate < 30 * 24 * 60 * 60 * 1000
    if (dateRange === 'Last 3 months') return now - fileDate < 90 * 24 * 60 * 60 * 1000
    return true
  })

  // Build photo items from filtered files
  const photoItems: PhotoItem[] = filteredFiles.map((f) => {
    const name = displayName(f)
    return {
      id: f.id,
      name,
      sizeBytes: f.size_bytes,
      isVideo: isVideoFile(name, f.mime_type),
      duration: null,
      isShared: false,
      isFeatured: f.is_starred ?? false,
      hasThumbnail: f.has_thumbnail ?? false,
    }
  })

  // Group by date
  const groups: PhotoGroup[] = groupByDate(photoItems, filteredFiles)
  const totalItems = photoItems.length
  const totalSize = filteredFiles.reduce((sum, f) => sum + f.size_bytes, 0)

  return (
    <DriveLayout>
        {/* Header */}
        <div className="px-5 py-3 border-b border-line flex items-center gap-3">
          <Icon name="image" size={15} />
          <div>
            <div className="text-sm font-semibold text-ink">Photos</div>
            <div className="text-[11px] text-ink-3">
              <span className="font-mono tabular-nums">{totalItems.toLocaleString()}</span> item{totalItems !== 1 ? 's' : ''}
              {totalItems > 0 && (
                <>
                  {' -- '}
                  <span className="font-mono tabular-nums">{formatBytes(totalSize)}</span>
                </>
              )}
            </div>
          </div>

          {/* Tab selector */}
          <div
            className="ml-auto flex gap-1 p-[3px] rounded-md border border-line"
            style={{ background: 'var(--color-paper-2)' }}
          >
            {TABS.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className="transition-all"
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  background: i === activeTab ? 'var(--color-paper)' : 'transparent',
                  boxShadow: i === activeTab ? 'var(--shadow-1)' : 'none',
                  fontWeight: i === activeTab ? 600 : 400,
                  color: i === activeTab ? 'var(--color-ink)' : 'var(--color-ink-3)',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Date range selector */}
          <div className="relative">
            <BBButton
              size="sm"
              onClick={() => setDateDropdownOpen(!dateDropdownOpen)}
              className="gap-1.5"
            >
              <Icon name="clock" size={12} />
              {dateRange}
              <Icon name="chevron-down" size={10} />
            </BBButton>
            {dateDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 bg-paper border border-line-2 rounded-lg shadow-2 z-20 overflow-hidden min-w-[160px]">
                {DATE_RANGES.map((range) => (
                  <button
                    key={range}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-paper-2 transition-colors text-left ${
                      dateRange === range ? 'font-semibold text-ink' : 'text-ink-2'
                    }`}
                    onClick={() => {
                      setDateRange(range)
                      setDateDropdownOpen(false)
                    }}
                  >
                    {dateRange === range && <Icon name="check" size={12} />}
                    <span className={dateRange !== range ? 'pl-5' : ''}>{range}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <BBButton size="sm" className="gap-1.5">
            <Icon name="upload" size={12} /> Upload
          </BBButton>
        </div>

        {/* Photo grid */}
        <div className="flex-1 overflow-y-auto px-5 py-[18px]">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div
                className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
                style={{
                  background: 'var(--color-amber-bg)',
                  border: '1.5px dashed var(--color-line-2)',
                }}
              >
                <Icon name="image" size={24} className="text-amber-deep" />
              </div>
              <div className="text-[15px] font-semibold text-ink mb-1">No photos yet</div>
              <div className="text-[13px] text-ink-3 mb-1">
                Upload images from the Drive to see them here.
              </div>
              <div className="text-[11px] text-ink-4">
                Supports JPG, PNG, GIF, WebP, HEIC, AVIF, and more.
              </div>
            </div>
          ) : groups.map((group, gi) => (
            <div key={gi} className="mb-6">
              {/* Group header */}
              <div className="flex items-baseline mb-2.5 gap-2.5">
                <span className="text-[13px] font-semibold text-ink">{group.date}</span>
                {group.place && (
                  <span className="text-[11px] text-ink-3">-- {group.place}</span>
                )}
                <span className="font-mono text-[11px] text-ink-4 ml-auto">
                  {group.items.length} photos
                </span>
              </div>

              {/* Grid */}
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
                {group.items.map((photo, pi) => {
                  const globalIndex = gi * 100 + pi
                  const thumbUrl = thumbnails[photo.id]
                  if (!thumbUrl && photo.hasThumbnail && isUnlocked) {
                    loadThumbnail(photo.id)
                  }
                  return (
                    <div
                      key={photo.id}
                      className="relative overflow-hidden rounded-sm cursor-pointer group/cell"
                      style={{
                        aspectRatio: '1',
                        background: thumbUrl
                          ? `url(${thumbUrl}) center/cover`
                          : placeholderGradient(globalIndex),
                        opacity: photo.isFeatured ? 1 : 0.85,
                      }}
                    >
                      {!thumbUrl && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1.5">
                          <Icon name={photo.isVideo ? 'file' : 'image'} size={20} className="text-ink/30" />
                          <span
                            className="text-[8px] leading-tight text-ink/40 font-medium text-center line-clamp-2 max-w-full break-all"
                          >
                            {photo.name}
                          </span>
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-ink/0 group-hover/cell:bg-ink/10 transition-colors" />

                      {/* Starred badge (featured) */}
                      {photo.isFeatured && (
                        <div
                          className="absolute right-1 top-1 flex items-center justify-center"
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 999,
                            background: 'rgba(0,0,0,0.35)',
                          }}
                        >
                          <Icon name="star" size={9} className="text-white" />
                        </div>
                      )}

                      {/* Video duration badge */}
                      {photo.isVideo && photo.duration && (
                        <div
                          className="absolute left-1 bottom-1 flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={{
                            background: 'rgba(0,0,0,0.55)',
                            fontSize: 10,
                            color: 'white',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {photo.duration}
                        </div>
                      )}

                      {/* Shared indicator */}
                      {photo.isShared && (
                        <div
                          className="absolute left-1 top-1 flex items-center justify-center"
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 999,
                            background: 'rgba(0,0,0,0.35)',
                          }}
                        >
                          <Icon name="users" size={9} className="text-white" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Auto-backup status bar */}
        <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <Icon name="upload" size={12} className="text-ink-3" />
            Auto-backup: 3 new -- on Wi-Fi -- 68%
          </span>
          <span>--</span>
          <span className="flex items-center gap-1.5">
            <Icon name="shield" size={12} className="text-amber-deep" />
            All photos E2E encrypted -- EXIF stripped on upload
          </span>
          <span
            className="ml-auto flex items-center gap-1.5 font-mono text-[10px]"
            title="GPS & device serial stripped before encryption"
          >
            <Icon name="lock" size={10} className="text-amber-deep" />
            GPS & device serial stripped before encryption
          </span>
        </div>
    </DriveLayout>
  )
}
