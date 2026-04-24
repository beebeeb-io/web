import { useEffect, useRef } from 'react'
import { Icon } from './icons'
import type { IconName } from './icons'
import { BBButton } from './bb-button'

export interface FileDetailsMeta {
  id: string
  name: string
  extension: string
  mimeType: string | null
  sizeBytes: number
  sizeOnDisk?: number
  isFolder: boolean
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
  isStarred?: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
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
  isStarred = false,
}: FileDetailsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

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
          <div className="flex items-start gap-3">
            {/* File type badge */}
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
              className="text-ink-3 hover:text-ink transition-colors shrink-0 mt-0.5"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 mt-3">
            <BBButton
              variant="amber"
              size="sm"
              className="flex-1 justify-center gap-1.5"
              onClick={onShare}
            >
              <Icon name="share" size={11} /> Share
            </BBButton>
            <BBButton size="sm" variant="ghost" onClick={onDownload}>
              <Icon name="download" size={11} />
            </BBButton>
            <BBButton
              size="sm"
              variant="ghost"
              onClick={onStar}
              className={isStarred ? 'text-amber-deep' : ''}
            >
              <Icon name="star" size={11} />
            </BBButton>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Who has access */}
          {access.length > 0 && (
            <div className="px-xl py-lg border-b border-line">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2.5">
                Who has access
              </div>
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
            </div>
          )}

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
            <div className="px-xl py-lg">
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
