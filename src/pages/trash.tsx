import { useState, useEffect, useCallback } from 'react'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { listFiles, restoreFile, deleteFile, type DriveFile } from '../lib/api'

// ─── Helpers ─────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function daysUntilShred(deletedAt: string): number {
  const deleted = new Date(deletedAt).getTime()
  const shredDate = deleted + 30 * 24 * 60 * 60 * 1000
  const now = Date.now()
  return Math.max(0, Math.ceil((shredDate - now) / (24 * 60 * 60 * 1000)))
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

function getIconForFile(file: DriveFile): IconName {
  if (file.is_folder) return 'folder'
  const ext = file.name_encrypted.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'svg'].includes(ext)) return 'image'
  return 'file'
}

// ─── Trash page ──────────────────────────────────

export function Trash() {
  const [files, setFiles] = useState<(DriveFile & { was_in: string })[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  // Fetch trashed files from API
  const fetchTrash = useCallback(async () => {
    try {
      const data = await listFiles(undefined, true)
      setFiles(data.map((f) => ({ ...f, was_in: '/' })))
    } catch {
      setFiles([])
    }
  }, [])

  useEffect(() => {
    fetchTrash()
  }, [fetchTrash])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleRestore = async (id: string) => {
    setLoading(true)
    try {
      await restoreFile(id)
      setFiles((prev) => prev.filter((f) => f.id !== id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch {
      // API error — leave file in list
    } finally {
      setLoading(false)
    }
  }

  const handlePermanentDelete = async (id: string) => {
    setLoading(true)
    try {
      await deleteFile(id)
      setFiles((prev) => prev.filter((f) => f.id !== id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch {
      // API error — leave file in list
    } finally {
      setLoading(false)
    }
  }

  const handleEmptyTrash = async () => {
    setLoading(true)
    try {
      await Promise.all(files.map((f) => deleteFile(f.id)))
    } catch {
      // API error
    }
    setFiles([])
    setSelected(new Set())
    setLoading(false)
  }

  const handleRestoreAll = async () => {
    setLoading(true)
    try {
      await Promise.all(files.map((f) => restoreFile(f.id)))
    } catch {
      // API error
    }
    setFiles([])
    setSelected(new Set())
    setLoading(false)
  }

  return (
    <DriveLayout>
        {/* Header */}
        <div className="px-5 py-3 border-b border-line flex items-center gap-2.5">
          <Icon name="trash" size={14} />
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink">Trash</div>
            <div className="text-[11px] text-ink-3">
              Items auto-shredded 30 days after deletion -- your vault key is destroyed last
            </div>
          </div>
          <div className="flex gap-2">
            <BBButton size="sm" onClick={handleRestoreAll} disabled={loading || files.length === 0}>
              Restore all
            </BBButton>
            <BBButton
              size="sm"
              variant="danger"
              onClick={handleEmptyTrash}
              disabled={loading || files.length === 0}
            >
              Empty trash
            </BBButton>
          </div>
        </div>

        {/* Table header */}
        <div
          className="px-5 py-2 border-b border-line bg-paper-2"
          style={{
            display: 'grid',
            gridTemplateColumns: '24px 1.4fr 1fr 110px 110px 110px 60px',
            gap: 14,
          }}
        >
          <div />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Was in</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Deleted</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Shreds in</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
          <span />
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div
                className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
                style={{
                  background: 'var(--color-paper-2)',
                  border: '1.5px dashed var(--color-line-2)',
                }}
              >
                <Icon name="trash" size={24} className="text-ink-3" />
              </div>
              <div className="text-[15px] font-semibold text-ink mb-1">Trash is empty</div>
              <div className="text-[13px] text-ink-3">
                Deleted files will appear here for 30 days
              </div>
            </div>
          ) : (
            files.map((file, i, arr) => {
              const days = daysUntilShred(file.updated_at)
              const urgent = days < 7
              const iconName = getIconForFile(file)

              return (
                <div
                  key={file.id}
                  className="group hover:bg-paper-2 transition-colors"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 1.4fr 1fr 110px 110px 110px 60px',
                    gap: 14,
                    padding: '10px 20px',
                    alignItems: 'center',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
                  }}
                >
                  <BBCheckbox
                    checked={selected.has(file.id)}
                    onChange={() => toggleSelect(file.id)}
                  />
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      name={iconName}
                      size={14}
                      className={iconName === 'folder' ? 'text-amber-deep' : 'text-ink-3'}
                    />
                    <span className="text-[13px] text-ink-2 truncate">{file.name_encrypted}</span>
                  </div>
                  <span className="font-mono text-[11px] text-ink-3">{file.was_in}</span>
                  <span className="font-mono text-[11px] text-ink-3">{timeAgo(file.updated_at)}</span>
                  <span
                    className={`font-mono text-[11px] ${
                      urgent ? 'font-semibold text-red' : 'text-ink-3'
                    }`}
                  >
                    {days} day{days !== 1 ? 's' : ''}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3">
                    {file.is_folder ? `${file.size > 0 ? formatBytes(file.size) : '--'}` : formatBytes(file.size)}
                  </span>
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => handleRestore(file.id)}
                      disabled={loading}
                      className="text-amber-deep text-[11.5px] font-medium cursor-pointer hover:underline"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Status bar */}
        <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
          <span className="font-mono">{files.length} item{files.length !== 1 ? 's' : ''} in trash</span>
          <span>--</span>
          <span className="flex items-center gap-1.5">
            <Icon name="shield" size={12} className="text-amber-deep" />
            Encrypted at rest -- AES-256-GCM
          </span>
          {selected.size > 0 && (
            <span className="ml-auto flex items-center gap-2">
              <span className="font-mono">{selected.size} selected</span>
              <BBButton
                size="sm"
                variant="danger"
                onClick={() => {
                  selected.forEach((id) => handlePermanentDelete(id))
                }}
                disabled={loading}
              >
                Delete permanently
              </BBButton>
            </span>
          )}
        </div>
    </DriveLayout>
  )
}
