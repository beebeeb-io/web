import { useEffect, useRef, useState, useCallback } from 'react'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import type { FileVersion } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { formatBytes } from '../lib/format'
import { listVersions } from '../lib/api'
import { useKeys } from '../lib/key-context'
import { fetchAndDecryptThumbnail } from '../lib/thumbnail'
import { isPreviewable } from '../lib/preview'

// ─── Versions tab (inline, inside the detail panel) ─────────────────────────

function timeAgoPanel(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function VersionsTab({
  fileId,
  onOpenFullHistory,
}: {
  fileId: string
  onOpenFullHistory?: () => void
}) {
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [currentVersion, setCurrentVersion] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!fileId) return
    setLoading(true)
    setError(false)
    listVersions(fileId)
      .then((data) => {
        setVersions(data.versions)
        setCurrentVersion(data.current_version)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [fileId])

  if (loading) {
    return (
      <div className="px-xl py-10 text-center text-[12px] text-ink-3">
        Loading versions...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Icon name="clock" size={20} className="text-ink-3" />
        <p className="text-[13px] text-ink-2 font-medium">Version history</p>
        <p className="text-[12px] text-ink-3">Coming in a future update</p>
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center px-xl">
        <Icon name="clock" size={20} className="text-ink-3" />
        <p className="text-[13px] text-ink-2 font-medium">No previous versions</p>
        <p className="text-[12px] text-ink-3">
          Versions are created when you re-upload a file with the same name.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Version list */}
      <div className="py-1 relative">
        {/* Timeline connector */}
        <div
          className="absolute bg-line-2"
          style={{ left: 36, top: 14, bottom: 14, width: 1 }}
        />

        {versions.map((v) => {
          const isCurrent = v.version_number === currentVersion
          return (
            <div
              key={v.id}
              className="relative flex items-start gap-3 px-xl py-2.5"
            >
              {/* Timeline dot */}
              <div
                className="rounded-full border-2 shrink-0 z-[1]"
                style={{
                  width: 10,
                  height: 10,
                  marginTop: 4,
                  background: isCurrent ? 'var(--color-amber)' : 'var(--color-paper)',
                  borderColor: isCurrent ? 'var(--color-amber-deep)' : 'var(--color-line-2)',
                }}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[11.5px] font-semibold text-ink">
                    v{v.version_number}
                  </span>
                  {isCurrent && (
                    <span className="px-1.5 py-px rounded text-[9.5px] font-semibold bg-amber/20 text-amber-deep">
                      Current
                    </span>
                  )}
                  <span className="text-[10.5px] text-ink-3 font-mono ml-auto">
                    {formatBytes(v.size_bytes)}
                  </span>
                </div>
                <div className="text-[10.5px] text-ink-4 mt-0.5">
                  {timeAgoPanel(v.created_at)}
                  {' · '}
                  {new Date(v.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Link to full version history overlay */}
      {onOpenFullHistory && (
        <div className="px-xl pb-lg pt-1 border-t border-line mt-1">
          <BBButton
            size="sm"
            variant="ghost"
            className="w-full justify-center gap-1.5"
            onClick={onOpenFullHistory}
          >
            <Icon name="clock" size={11} /> Full version history
          </BBButton>
        </div>
      )}
    </div>
  )
}

// ─── Local file notes (client-only, per-device) ──────────────────────────────

function noteKey(fileId: string): string {
  return `beebeeb.note.${fileId}`
}

function loadNote(fileId: string): string {
  try {
    return localStorage.getItem(noteKey(fileId)) ?? ''
  } catch {
    return ''
  }
}

function saveNote(fileId: string, text: string): void {
  try {
    if (text) {
      localStorage.setItem(noteKey(fileId), text)
    } else {
      localStorage.removeItem(noteKey(fileId))
    }
  } catch {
    // localStorage unavailable — silently ignore
  }
}

// ─── Notes section component ────────────────────────────────────────────────

function FileNotesSection({ fileId }: { fileId: string }) {
  const [open, setOpen] = useState(true)
  const [text, setText] = useState(() => loadNote(fileId))
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reload note when the selected file changes
  useEffect(() => {
    setText(loadNote(fileId))
    setSaved(false)
  }, [fileId])

  const handleBlur = useCallback(() => {
    saveNote(fileId, text)
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 1000)
  }, [fileId, text])

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  return (
    <div className="border-b border-line">
      {/* Section header — collapsible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-xl pt-lg pb-2.5 flex items-center gap-1.5 text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 flex-1">
          Notes
        </span>
        <span className="text-[9px] text-ink-4 font-normal normal-case tracking-normal mr-1">
          Not encrypted · this device only
        </span>
        <span
          className="text-ink-4 transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          <Icon name="chevron-down" size={10} />
        </span>
      </button>

      {open && (
        <div className="px-xl pb-lg">
          <div className="relative">
            <textarea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={handleBlur}
              placeholder="Add a note visible only on this device..."
              className="w-full resize-none rounded-md border border-line bg-paper-2 px-2.5 py-2 text-[11.5px] text-ink placeholder:text-ink-4 outline-none focus:border-amber focus:ring-2 focus:ring-amber/20 transition-colors"
              style={{ fontFamily: 'inherit', lineHeight: 1.5 }}
            />
            {/* Saved confirmation */}
            <span
              className="absolute bottom-2 right-2 text-[10px] text-ink-4 font-mono transition-opacity duration-300"
              style={{ opacity: saved ? 1 : 0 }}
            >
              Saved
            </span>
          </div>
          <div className="mt-1.5 text-[10px] text-ink-4 flex items-center gap-1">
            <Icon name="lock" size={9} />
            Stored locally — not synced or encrypted server-side
          </div>
        </div>
      )}
    </div>
  )
}

export interface FileDetailsMeta {
  id: string
  name: string
  extension: string
  mimeType: string | null
  sizeBytes: number
  sizeOnDisk?: number
  isFolder: boolean
  hasThumbnail?: boolean
  createdAt: string
  updatedAt: string
  location: string
  cipher?: string
  keyId?: string
  region?: string
}

export interface FileAccessEntry {
  name: string
  role: string
  initials: string
}

export interface FileActivityEntry {
  label: string
  when: string
  icon: IconName
}

interface FileDetailsPanelProps {
  open: boolean
  onClose: () => void
  file: FileDetailsMeta | null
  access?: FileAccessEntry[]
  activity?: FileActivityEntry[]
  onDownload?: () => void
  onShare?: () => void
  onMove?: () => void
  onStar?: () => void
  onTrash?: () => void
  onVersionHistory?: () => void
  onPreview?: () => void
  isStarred?: boolean
}

function typeLabel(ext: string, mime: string | null): string {
  const map: Record<string, string> = {
    pdf: 'PDF document',
    md: 'Markdown',
    txt: 'Plain text',
    zip: 'ZIP archive',
    m4a: 'Audio (M4A)',
    mp3: 'Audio (MP3)',
    mp4: 'Video (MP4)',
    mov: 'Video (MOV)',
    png: 'Image (PNG)',
    jpg: 'Image (JPEG)',
    jpeg: 'Image (JPEG)',
    svg: 'Image (SVG)',
    docx: 'Word document',
    xlsx: 'Spreadsheet',
  }
  return map[ext.toLowerCase()] ?? mime ?? 'File'
}

function extColor(ext: string): string {
  const colors: Record<string, string> = {
    pdf: '#e85a4f',
    md: '#6b7280',
    zip: '#f59e0b',
    m4a: '#8b5cf6',
    mp3: '#8b5cf6',
    mp4: '#3b82f6',
    mov: '#3b82f6',
    png: '#10b981',
    jpg: '#10b981',
    jpeg: '#10b981',
  }
  return colors[ext.toLowerCase()] ?? 'var(--color-ink-3)'
}

const accessColors = [
  'oklch(0.7 0.1 55)',
  'oklch(0.7 0.1 220)',
  'oklch(0.7 0.1 155)',
  'oklch(0.7 0.1 320)',
  'oklch(0.7 0.1 90)',
]

export function FileDetailsPanel({
  open,
  onClose,
  file,
  access = [],
  activity = [],
  onDownload,
  onShare,
  onMove,
  onStar,
  onTrash,
  onVersionHistory,
  onPreview,
  isStarred = false,
}: FileDetailsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<'info' | 'versions'>('info')
  const { getFileKey, isUnlocked } = useKeys()

  // ─── Thumbnail loading ────────────────────────────
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [thumbnailLoading, setThumbnailLoading] = useState(false)

  // Reset tab to info when the selected file changes
  useEffect(() => {
    setActiveTab('info')
    setThumbnailUrl(null)
  }, [file?.id])

  // Load thumbnail when file has one and vault is unlocked
  useEffect(() => {
    if (!file || !file.hasThumbnail || file.isFolder || !isUnlocked || !open) return
    let cancelled = false
    setThumbnailLoading(true)
    getFileKey(file.id)
      .then((fileKey) => fetchAndDecryptThumbnail(file.id, fileKey))
      .then((url) => {
        if (!cancelled) {
          setThumbnailUrl(url)
          setThumbnailLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setThumbnailLoading(false)
      })
    return () => { cancelled = true }
  }, [file?.id, file?.hasThumbnail, isUnlocked, open, getFileKey])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open || !file) return null

  const ext = file.extension.toUpperCase()
  const color = extColor(file.extension)

  const details: [string, string][] = [
    ['Type', typeLabel(file.extension, file.mimeType)],
    ['Location', file.location],
    ['Created', new Date(file.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
    ['Modified', new Date(file.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
    ['Size on disk', file.sizeOnDisk
      ? `${formatBytes(file.sizeBytes)} (ciphertext ${formatBytes(file.sizeOnDisk)})`
      : formatBytes(file.sizeBytes)],
  ]
  if (file.cipher) details.push(['Cipher', file.cipher])
  if (file.region) details.push(['Region', file.region])

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/10" />

      {/* Panel */}
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[420px] h-full bg-paper border-l border-line-2 shadow-3 flex flex-col animate-slide-in-right overflow-hidden"
      >
        {/* Header: file icon + name + close */}
        <div className="px-xl py-lg border-b border-line">
          {/* Thumbnail hero — full-width when available */}
          {!file.isFolder && file.hasThumbnail && (
            <div className="w-full rounded-md overflow-hidden mb-3 bg-paper-3 border border-line" style={{ aspectRatio: '16/9' }}>
              {thumbnailLoading ? (
                <div className="w-full h-full animate-pulse bg-paper-3" />
              ) : thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="w-full h-full object-contain"
                />
              ) : (
                /* Fallback: file type badge at larger size */
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ color }}
                >
                  <div
                    className="rounded-md border flex items-center justify-center"
                    style={{
                      width: 56,
                      height: 68,
                      background: `color-mix(in oklch, ${color} 8%, var(--color-paper))`,
                      borderColor: `color-mix(in oklch, ${color} 25%, var(--color-line))`,
                      color,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                    }}
                  >
                    {ext.slice(0, 4)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-3">
            {/* File type badge — only shown when no thumbnail hero above */}
            {(file.isFolder || !file.hasThumbnail) && (
              <div
                className="w-[44px] h-[52px] rounded-md border flex items-center justify-center shrink-0"
                style={{
                  background: `color-mix(in oklch, ${color} 8%, var(--color-paper))`,
                  borderColor: `color-mix(in oklch, ${color} 25%, var(--color-line))`,
                  color,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                {ext.slice(0, 4)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink leading-tight break-words">
                {file.name}
              </div>
              <div className="text-[11px] text-ink-3 font-mono mt-1">
                {formatBytes(file.sizeBytes)}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-ink-3 hover:text-ink transition-colors shrink-0 mt-0.5"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 mt-3">
            {/* Preview button — only for non-folder files */}
            {!file.isFolder && (
              isPreviewable(file.mimeType) ? (
                <BBButton
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={onPreview}
                  aria-label="Preview"
                >
                  <Icon name="file" size={11} /> Preview
                </BBButton>
              ) : (
                <BBButton
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 opacity-40 cursor-not-allowed"
                  disabled
                  aria-label="Preview not available for this file type"
                  title="Preview not available for this file type"
                >
                  <Icon name="file" size={11} /> Preview
                </BBButton>
              )
            )}
            <BBButton
              variant="amber"
              size="sm"
              className="flex-1 justify-center gap-1.5"
              onClick={onShare}
            >
              <Icon name="share" size={11} /> Share
            </BBButton>
            <BBButton size="sm" variant="ghost" onClick={onDownload} aria-label="Download">
              <Icon name="download" size={11} />
            </BBButton>
            <BBButton
              size="sm"
              variant="ghost"
              onClick={onStar}
              aria-label={isStarred ? 'Remove star' : 'Star'}
              className={isStarred ? 'text-amber-deep' : ''}
            >
              <Icon name="star" size={11} />
            </BBButton>
          </div>
        </div>

        {/* Tab bar — only shown for files (not folders) */}
        {!file.isFolder && (
          <div className="flex border-b border-line px-xl">
            {(['info', 'versions'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  'py-2.5 mr-4 text-[11.5px] font-medium border-b-2 -mb-px transition-colors',
                  activeTab === tab
                    ? 'border-amber-deep text-ink'
                    : 'border-transparent text-ink-3 hover:text-ink',
                ].join(' ')}
              >
                {tab === 'info' ? 'Info' : 'Versions'}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'versions' && !file.isFolder ? (
            /* ── Versions tab ─────────────────────────────────────────────── */
            <VersionsTab
              fileId={file.id}
              onOpenFullHistory={onVersionHistory}
            />
          ) : (
            /* ── Info tab (default) ───────────────────────────────────────── */
            <>
              {/* Who has access */}
              <div className="px-xl py-lg border-b border-line">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">
                  Who has access
                </div>
                {access.length > 0 ? (
                  <>
                    <div className="flex flex-col gap-2">
                      {access.map((p, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white text-[9.5px] font-semibold"
                            style={{ background: accessColors[i % accessColors.length] }}
                          >
                            {p.initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11.5px] font-medium text-ink truncate">{p.name}</div>
                            <div className="text-[10px] text-ink-3">{p.role}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <BBButton
                      size="sm"
                      variant="ghost"
                      className="w-full justify-center mt-2.5 gap-1.5"
                      onClick={onShare}
                    >
                      <Icon name="plus" size={11} /> Add people
                    </BBButton>
                  </>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-paper-2 border border-line flex items-center justify-center shrink-0">
                      <Icon name="lock" size={10} className="text-ink-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11.5px] font-medium text-ink">Only you</div>
                      <div className="text-[10px] text-ink-3">Private — not shared</div>
                    </div>
                    <BBButton
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={onShare}
                    >
                      <Icon name="share" size={10} /> Share
                    </BBButton>
                  </div>
                )}
              </div>

              {/* Details grid */}
              <div className="px-xl py-lg border-b border-line">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">
                  Details
                </div>
                <div className="flex flex-col gap-[7px]">
                  {details.map(([k, v]) => (
                    <div key={k} className="flex text-[11.5px] gap-3">
                      <span className="text-ink-3 w-[84px] shrink-0">{k}</span>
                      <span className="text-ink-2 flex-1 break-words">{v}</span>
                    </div>
                  ))}
                  {file.keyId && (
                    <div className="flex text-[11.5px] gap-3">
                      <span className="text-ink-3 w-[84px] shrink-0">Key ID</span>
                      <span className="text-ink-2 flex-1 font-mono text-[10.5px]">
                        {file.keyId.slice(0, 16)}...
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Crypto section */}
              {file.cipher && (
                <div className="px-xl py-lg border-b border-line">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">
                    Encryption
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap px-2.5 py-2 bg-paper-2 border border-line rounded-md font-mono text-[10.5px] text-ink-3">
                    <span className="text-ink-4">upload</span>
                    <Icon name="chevron-right" size={9} className="text-ink-4" />
                    <span>{file.cipher}</span>
                    <Icon name="chevron-right" size={9} className="text-ink-4" />
                    <span className="text-amber-deep font-medium">sealed</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ink-3">
                    <Icon name="shield" size={11} className="text-amber-deep" />
                    MAC verified — ciphertext integrity confirmed
                  </div>
                </div>
              )}

              {/* Recent activity */}
              {activity.length > 0 && (
                <div className="px-xl py-lg border-b border-line">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">
                    Recent activity
                  </div>
                  {activity.map((a, i, arr) => (
                    <div
                      key={i}
                      className="flex gap-2.5 relative"
                      style={{ paddingBottom: i < arr.length - 1 ? 14 : 0 }}
                    >
                      <div className="w-[22px] h-[22px] rounded-full shrink-0 bg-paper-2 border border-line flex items-center justify-center z-[1]">
                        <Icon name={a.icon} size={10} className="text-ink-3" />
                      </div>
                      {i < arr.length - 1 && (
                        <div
                          className="absolute bg-line"
                          style={{ left: 10.5, top: 22, bottom: -2, width: 1 }}
                        />
                      )}
                      <div>
                        <div className="text-[11.5px] text-ink">{a.label}</div>
                        <div className="text-[10px] text-ink-3 mt-px">{a.when}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes — client-only, stored in localStorage per device */}
              <FileNotesSection fileId={file.id} />
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-xl py-md border-t border-line flex gap-2">
          <BBButton size="sm" variant="ghost" className="gap-1.5" onClick={onMove}>
            <Icon name="folder" size={11} /> Move
          </BBButton>
          <BBButton size="sm" variant="ghost" className="gap-1.5 ml-auto text-red" onClick={onTrash}>
            <Icon name="trash" size={11} /> Trash
          </BBButton>
        </div>
      </div>
    </div>
  )
}
