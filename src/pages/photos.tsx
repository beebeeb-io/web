import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { listFiles, type DriveFile } from '../lib/api'
import { useKeys } from '../lib/key-context'
import { decryptFileMetadata } from '../lib/crypto'
import { fetchAndDecryptThumbnail } from '../lib/thumbnail'
import { EmptyPhotos } from '../components/empty-states/empty-photos'
import { PhotoGroupSkeleton } from '../components/skeleton'
import { FilePreview } from '../components/preview/file-preview'
import { useFilePreview } from '../hooks/use-file-preview'
import { formatBytes } from '../lib/format'
import type { UploadItem } from '../components/upload-progress'
import { UploadCards } from '../components/upload-progress-card'
import { UploadZone } from '../components/upload-zone'
import { encryptedUpload } from '../lib/encrypted-upload'
import { useToast } from '../components/toast'

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

/** Check if a filename or MIME type represents a media file (image/video).
 *  mimeType may be null for files uploaded after the ZK audit fix — infer
 *  from extension first, fall back to mime_type when present. */
function isMediaFile(name: string, mimeType: string | null | undefined): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) return true
  if (!mimeType) return false
  return MEDIA_MIME_PREFIXES.some((p) => mimeType.startsWith(p))
}

function isVideoFile(name: string, mimeType: string | null | undefined): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (VIDEO_EXTENSIONS.has(ext)) return true
  return mimeType?.startsWith('video/') ?? false
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

const TABS = ['All'] as const

// ─── Date range options ─────────────────────────

const DATE_RANGES = ['Last 7 days', 'Last 30 days', 'Last 3 months', 'All time'] as const

// ─── Photos page ────────────────────────────────

export function Photos() {
  const navigate = useNavigate()
  const { getFileKey, isUnlocked, cryptoReady } = useKeys()
  const { showToast } = useToast()
  const { previewFile, openPreview, closePreview } = useFilePreview()
  const [activeTab, setActiveTab] = useState(0)
  const [dateRange, setDateRange] = useState<(typeof DATE_RANGES)[number]>('All time')
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false)
  const [allFiles, setAllFiles] = useState<DriveFile[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  /** Decrypted MIME types — populated from the encrypted metadata for new uploads
   *  (where the server stores null). Falls back to f.mime_type for legacy files. */
  const [decryptedMimeTypes, setDecryptedMimeTypes] = useState<Record<string, string>>({})
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const loadingThumbs = useRef(new Set<string>())
  // Stable mirror of the latest thumbnails map so loadThumbnail can dedupe
  // without becoming a new function identity on every render.
  const thumbnailsRef = useRef(thumbnails)
  // Indirection that lets the IntersectionObserver call the latest
  // loadThumbnail without us re-creating the observer when getFileKey
  // identity changes.
  const loadThumbnailRef = useRef<((fileId: string) => void) | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const uploadAbortRef = useRef<Map<string, AbortController>>(new Map())
  const uploadFilesRef = useRef<Map<string, File>>(new Map())
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Fetch all files recursively (flat list)
  const fetchAllFiles = useCallback(async () => {
    setLoading(true)
    try {
      const walk = async (parentId?: string): Promise<DriveFile[]> => {
        const children = await listFiles(parentId, false, { limit: 500 })
        const nested = await Promise.all(
          children
            .filter((file) => file.is_folder)
            .map((folder) => walk(folder.id)),
        )
        return [...children, ...nested.flat()]
      }
      const files = await walk()
      setAllFiles(files)
    } catch (err) {
      console.error('[Photos] Failed to load files:', err)
      setAllFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAllFiles()
  }, [fetchAllFiles])

  // Decrypt file names + MIME types from the encrypted metadata blob.
  // New uploads: metadata = JSON { name, mime_type } (zero-knowledge).
  // Legacy uploads: metadata decrypts to a bare filename string.
  // decryptFileMetadata() handles both formats transparently.
  useEffect(() => {
    if (!isUnlocked || allFiles.length === 0) {
      if (!isUnlocked) {
        setDecryptedNames({})
        setDecryptedMimeTypes({})
      }
      return
    }
    let cancelled = false
    async function decryptAll() {
      const names: Record<string, string> = {}
      const mimes: Record<string, string> = {}
      for (const file of allFiles) {
        if (cancelled) return
        try {
          const fileKey = await getFileKey(file.id)
          const { name, mimeType } = await decryptFileMetadata(fileKey, file.name_encrypted)
          names[file.id] = name
          if (mimeType) mimes[file.id] = mimeType
        } catch {
          names[file.id] = 'Encrypted file'
        }
      }
      if (!cancelled) {
        setDecryptedNames(names)
        setDecryptedMimeTypes(mimes)
      }
    }
    decryptAll()
    return () => { cancelled = true }
  }, [allFiles, isUnlocked, getFileKey])

  // Keep thumbnailsRef in sync so loadThumbnail's dedupe check sees the
  // latest map without depending on `thumbnails` (which would invalidate
  // the IntersectionObserver every time a new thumb arrived).
  useEffect(() => { thumbnailsRef.current = thumbnails }, [thumbnails])

  const loadThumbnail = useCallback(async (fileId: string) => {
    if (thumbnailsRef.current[fileId] || loadingThumbs.current.has(fileId)) return
    loadingThumbs.current.add(fileId)
    try {
      const fileKey = await getFileKey(fileId)
      const url = await fetchAndDecryptThumbnail(fileId, fileKey)
      if (url) setThumbnails((prev) => ({ ...prev, [fileId]: url }))
    } catch { /* ignore */ }
  }, [getFileKey])

  useEffect(() => {
    loadThumbnailRef.current = loadThumbnail
  }, [loadThumbnail])

  // ─── Lazy-load thumbnails via IntersectionObserver ──────────────────
  // Mirrors FileList's pattern: each photo cell registers its DOM node
  // through `setPhotoCellRef`. The observer fires loadThumbnail only once
  // per cell when it scrolls into view (rootMargin pre-warms the next
  // screenful so users don't see placeholder flashes on fast scrolls).
  const observerRef = useRef<IntersectionObserver | null>(null)
  const photoNodeRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    if (!isUnlocked) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const fileId = (entry.target as HTMLElement).dataset.photoId
            if (fileId) loadThumbnailRef.current?.(fileId)
          }
        }
      },
      { threshold: 0.1, rootMargin: '200px' },
    )
    observerRef.current = observer
    for (const el of photoNodeRefs.current.values()) {
      observer.observe(el)
    }
    return () => observer.disconnect()
  }, [isUnlocked])

  const setPhotoCellRef = useCallback((fileId: string, el: HTMLElement | null) => {
    if (el) {
      photoNodeRefs.current.set(fileId, el)
      observerRef.current?.observe(el)
    } else {
      const existing = photoNodeRefs.current.get(fileId)
      if (existing) observerRef.current?.unobserve(existing)
      photoNodeRefs.current.delete(fileId)
    }
  }, [])

  // ─── Upload handlers ─────────────────────────────

  function handleFilesSelected(files: File[]) {
    const newUploads: UploadItem[] = files.map((f, i) => ({
      id: `upload-${Date.now()}-${i}`,
      name: f.name,
      size: f.size,
      progress: 0,
      stage: 'Queued' as const,
    }))
    setUploads((prev) => [...prev, ...newUploads])
    files.forEach((file, i) => {
      const uploadId = newUploads[i].id
      uploadFilesRef.current.set(uploadId, file)
      doEncryptedUpload(uploadId, file)
    })
  }

  async function doEncryptedUpload(uploadId: string, file: File) {
    if (!isUnlocked || !cryptoReady) {
      showToast({ icon: 'lock', title: 'Vault is locked', description: 'Log in again to unlock encryption before uploading.', danger: true })
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
      uploadFilesRef.current.delete(uploadId)
      return
    }
    const fileId = crypto.randomUUID()
    const fileKey = await getFileKey(fileId)
    const abortController = new AbortController()
    uploadAbortRef.current.set(uploadId, abortController)
    try {
      await encryptedUpload(file, fileId, fileKey, undefined, (p) => {
        setUploads((prev) => prev.map((u) => u.id === uploadId ? { ...u, stage: p.stage, progress: p.progress } : u))
      }, undefined, undefined, abortController.signal)
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
      uploadAbortRef.current.delete(uploadId)
      uploadFilesRef.current.delete(uploadId)
      // Photos page only renders media (images/videos). When the user uploads
      // anything else from here, it still gets stored — but it lands in All
      // Files (root) and never appears in this grid. Signal that explicitly
      // instead of showing the generic "Uploaded" toast and leaving the user
      // wondering why the file vanished.
      if (isMediaFile(file.name, file.type)) {
        showToast({ icon: 'check', title: 'Uploaded', description: file.name })
      } else {
        showToast({
          icon: 'info',
          title: 'File saved to All Files',
          description: `${file.name} is not a photo or video — it was uploaded to All Files.`,
        })
      }
      fetchAllFiles()
    } catch (err) {
      uploadAbortRef.current.delete(uploadId)
      if (err instanceof DOMException && err.name === 'AbortError') {
        setUploads((prev) => prev.filter((u) => u.id !== uploadId))
        uploadFilesRef.current.delete(uploadId)
        return
      }
      const errorMessage = err instanceof Error ? err.message : 'Upload failed'
      showToast({ icon: 'upload', title: 'Upload failed', description: errorMessage, danger: true })
      setUploads((prev) => prev.map((u) => u.id === uploadId ? { ...u, stage: 'Error' as const, progress: 0, errorMessage } : u))
    }
  }

  function handleCancelUpload(uploadId: string) {
    uploadAbortRef.current.get(uploadId)?.abort()
    uploadAbortRef.current.delete(uploadId)
    setUploads((prev) => prev.filter((u) => u.id !== uploadId))
    uploadFilesRef.current.delete(uploadId)
  }

  function handleRetryUpload(uploadId: string) {
    const file = uploadFilesRef.current.get(uploadId)
    if (!file) { setUploads((prev) => prev.filter((u) => u.id !== uploadId)); return }
    setUploads((prev) => prev.map((u) => u.id === uploadId ? { ...u, stage: 'Queued' as const, progress: 0 } : u))
    doEncryptedUpload(uploadId, file)
  }

  function displayName(file: DriveFile): string {
    const dec = decryptedNames[file.id]
    if (dec) return dec
    // name_encrypted is JSON ciphertext for ZK-uploaded files — return
    // a placeholder that won't mislead extension-based type detection.
    const raw = file.name_encrypted
    if (!raw || raw.startsWith('{')) return 'Encrypted file'
    return raw
  }

  // Filter to media files only.
  // Prefer decrypted MIME type (from encrypted metadata) over f.mime_type
  // (which is null for ZK-uploaded files where the server doesn't know the type).
  const mediaFiles = allFiles.filter((f) => {
    if (f.is_folder) return false
    const name = displayName(f)
    const mime = decryptedMimeTypes[f.id] ?? f.mime_type
    return isMediaFile(name, mime)
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
      isVideo: isVideoFile(name, decryptedMimeTypes[f.id] ?? f.mime_type),
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

          <BBButton size="sm" variant="amber" className="gap-1.5" onClick={() => photoInputRef.current?.click()}>
            <Icon name="upload" size={12} /> Upload
          </BBButton>
          <input
            ref={photoInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) handleFilesSelected(files)
              e.target.value = ''
            }}
          />
        </div>

        {/* Photo grid */}
        <UploadZone onFiles={handleFilesSelected}>
        <div className="flex-1 overflow-y-auto px-5 py-[18px]">
          <UploadCards uploads={uploads} onCancel={handleCancelUpload} onRetry={handleRetryUpload} />
          {loading ? (
            <div>
              <PhotoGroupSkeleton />
              <PhotoGroupSkeleton />
            </div>
          ) : groups.length === 0 ? (
            <EmptyPhotos
              onUpload={() => photoInputRef.current?.click()}
              onGoToDrive={() => navigate('/')}
            />
          ) : groups.map((group, gi) => (
            <div key={gi} className="mb-6">
              {/* Group header */}
              <div className="flex items-baseline mb-2.5 gap-2.5">
                <span className="text-[13px] font-semibold text-ink">{group.date}</span>
                {group.place && (
                  <span className="text-[11px] text-ink-3">-- {group.place}</span>
                )}
                <span className="font-mono text-[11px] text-ink-4 ml-auto">
                  {group.items.length} item{group.items.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Grid */}
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
                {group.items.map((photo, pi) => {
                  const globalIndex = gi * 100 + pi
                  const thumbUrl = thumbnails[photo.id]
                  // Thumbnail decryption is kicked off by the
                  // IntersectionObserver wired up above — never call
                  // loadThumbnail() during render. Cells without a thumbnail
                  // image (icon-only files) skip observer registration.
                  const file = filteredFiles.find((f) => f.id === photo.id)
                  const observe = photo.hasThumbnail && isUnlocked
                  return (
                    <button
                      type="button"
                      key={photo.id}
                      ref={observe
                        ? (el) => setPhotoCellRef(photo.id, el as HTMLElement | null)
                        : undefined}
                      data-photo-id={observe ? photo.id : undefined}
                      onClick={() => file && openPreview(file)}
                      aria-label={`Open ${photo.name}`}
                      className="relative overflow-hidden rounded-sm cursor-pointer group/cell focus:outline-none focus:ring-2 focus:ring-amber"
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
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        </UploadZone>

        {/* Status bar */}
        <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <Icon name="shield" size={12} className="text-amber-deep" />
            All photos E2E encrypted · EXIF stripped on upload
          </span>
          <span
            className="ml-auto flex items-center gap-1.5 font-mono text-[10px]"
            title="GPS & device serial stripped before encryption"
          >
            <Icon name="lock" size={10} className="text-amber-deep" />
            GPS & device serial stripped before encryption
          </span>
        </div>

        {previewFile && (
          <FilePreview
            file={previewFile}
            decryptedName={decryptedNames[previewFile.id]}
            onClose={closePreview}
          />
        )}
    </DriveLayout>
  )
}
