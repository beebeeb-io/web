import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBLogo } from '../components/bb-logo'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { useAuth } from '../lib/auth-context'
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

// ─── Mock data ───────────────────────────────────

const MOCK_TRASH: (DriveFile & { was_in: string })[] = [
  { id: 't1', name_encrypted: 'test-shot-001.jpg', mime_type: 'image/jpeg', size: 4404019, is_folder: false, parent_id: null, trashed: true, shared_with: 0, owner: 'You', created_at: '2026-04-23T08:00:00Z', updated_at: '2026-04-23T08:00:00Z', was_in: 'field-recordings/' },
  { id: 't2', name_encrypted: 'draft-v1-OLD.md', mime_type: 'text/markdown', size: 14336, is_folder: false, parent_id: null, trashed: true, shared_with: 0, owner: 'You', created_at: '2026-04-22T10:00:00Z', updated_at: '2026-04-22T10:00:00Z', was_in: 'drafts/' },
  { id: 't3', name_encrypted: 'test-exports/', mime_type: '', size: 125829120, is_folder: true, parent_id: null, trashed: true, shared_with: 0, owner: 'You', created_at: '2026-04-20T10:00:00Z', updated_at: '2026-04-20T10:00:00Z', was_in: '/' },
  { id: 't4', name_encrypted: 'screenshot-2025-09-14-09.png', mime_type: 'image/png', size: 2202009, is_folder: false, parent_id: null, trashed: true, shared_with: 0, owner: 'You', created_at: '2026-04-15T10:00:00Z', updated_at: '2026-04-15T10:00:00Z', was_in: 'inbox/' },
  { id: 't5', name_encrypted: 'notes-scratch.txt', mime_type: 'text/plain', size: 6144, is_folder: false, parent_id: null, trashed: true, shared_with: 0, owner: 'You', created_at: '2026-04-09T10:00:00Z', updated_at: '2026-04-09T10:00:00Z', was_in: 'inbox/' },
  { id: 't6', name_encrypted: 'duplicate-IMG_0047.heic', mime_type: 'image/heic', size: 3984588, is_folder: false, parent_id: null, trashed: true, shared_with: 0, owner: 'You', created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z', was_in: 'photos/' },
]

// ─── Nav items (same as Drive sidebar) ───────────

type NavId = 'files' | 'shared' | 'photos' | 'starred' | 'recent' | 'trash'

const navItems: { id: NavId; icon: IconName; label: string; count?: string }[] = [
  { id: 'files', icon: 'folder', label: 'All files' },
  { id: 'shared', icon: 'users', label: 'Shared', count: '6' },
  { id: 'photos', icon: 'image', label: 'Photos', count: '2.4k' },
  { id: 'starred', icon: 'star', label: 'Starred' },
  { id: 'recent', icon: 'clock', label: 'Recent' },
  { id: 'trash', icon: 'trash', label: 'Trash' },
]

// ─── Trash page ──────────────────────────────────

export function Trash() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [files, setFiles] = useState<(DriveFile & { was_in: string })[]>(MOCK_TRASH)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  // Fetch trashed files from API
  const fetchTrash = useCallback(async () => {
    try {
      const data = await listFiles(undefined, true)
      setFiles(data.map((f) => ({ ...f, was_in: '/' })))
    } catch {
      // API not available, keep mock data
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
      // Mock: just remove from list
      setFiles((prev) => prev.filter((f) => f.id !== id))
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
      setFiles((prev) => prev.filter((f) => f.id !== id))
    } finally {
      setLoading(false)
    }
  }

  const handleEmptyTrash = async () => {
    setLoading(true)
    try {
      await Promise.all(files.map((f) => deleteFile(f.id)))
    } catch {
      // Mock mode
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
      // Mock mode
    }
    setFiles([])
    setSelected(new Set())
    setLoading(false)
  }

  const handleNavClick = (id: NavId) => {
    if (id === 'trash') return
    if (id === 'files') navigate('/')
    // Other nav targets could be routed here
  }

  return (
    <div className="h-screen flex overflow-hidden bg-paper">
      {/* ─── Sidebar ─────────────────────────── */}
      <aside className="w-[220px] shrink-0 border-r border-line bg-paper-2 flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <BBLogo size={14} />
        </div>

        <nav className="px-3 py-1.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors text-left ${
                item.id === 'trash'
                  ? 'bg-paper-3 font-semibold text-ink'
                  : 'text-ink-2 hover:bg-paper-3/50'
              }`}
            >
              <Icon name={item.icon} size={13} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.count && (
                <span className="font-mono text-[10px] text-ink-4">{item.count}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="mx-4 my-2.5 h-px bg-line" />

        {/* Storage */}
        <div className="mt-auto px-4 py-4 border-t border-line">
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-2">
            Storage
          </div>
          <div className="h-[3px] w-full rounded-full bg-paper-3 overflow-hidden mb-1.5">
            <div className="h-full rounded-full bg-amber" style={{ width: '38%' }} />
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="font-mono tabular-nums">76 / 200 GB</span>
            <span className="font-medium text-amber-deep cursor-pointer hover:underline">Upgrade</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-3">
            <Icon name="shield" size={11} className="text-amber-deep" />
            <span className="font-mono">EU-WEST -- AES-256</span>
          </div>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] text-ink-3 hover:bg-paper-3/50 transition-colors text-left"
          >
            <Icon name="x" size={13} className="shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      {/* ─── Main area ───────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
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
      </main>
    </div>
  )
}
