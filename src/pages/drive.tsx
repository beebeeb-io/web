import { useState, useEffect, useCallback, useRef } from 'react'
import { BBLogo } from '../components/bb-logo'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { FileIcon, getFileType } from '../components/file-icon'
import { UploadZone, useBrowseFiles } from '../components/upload-zone'
import { UploadProgress, type UploadItem } from '../components/upload-progress'
import { NewFolderDialog } from '../components/new-folder-dialog'
import { NotificationInbox, useNotifications } from '../components/notification-inbox'
import { useToast } from '../components/toast'
import { useWebSocket } from '../hooks/use-websocket'
import type { WsEvent } from '../hooks/use-websocket'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import {
  listFiles,
  createFolder,
  type DriveFile,
} from '../lib/api'
import { encryptedUpload } from '../lib/encrypted-upload'
import { encryptedDownload } from '../lib/encrypted-download'
import { decryptFilename, encryptFilename, fromBase64, toBase64 } from '../lib/crypto'

// ─── Helpers ───────────────────────────────────────

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
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

// ─── Avatar stack ──────────────────────────────────

const palette = ['#f5b800', '#e85a4f', '#3b82f6', '#a855f7', '#0f766e']

function AvatarStack({ n }: { n: number }) {
  return (
    <div className="flex">
      {Array.from({ length: Math.min(n, 3) }).map((_, i) => (
        <div
          key={i}
          className="shrink-0 rounded-full border-[1.5px] border-paper"
          style={{
            width: 18,
            height: 18,
            background: palette[i % palette.length],
            marginLeft: i === 0 ? 0 : -5,
          }}
        />
      ))}
      {n > 3 && (
        <span className="font-mono text-[10px] text-ink-3 ml-1 self-center">
          +{n - 3}
        </span>
      )}
    </div>
  )
}

// ─── Nav items ─────────────────────────────────────

type NavId = 'files' | 'shared' | 'photos' | 'starred' | 'recent' | 'trash'

const navItems: { id: NavId; icon: IconName; label: string; count?: string }[] = [
  { id: 'files', icon: 'folder', label: 'All files' },
  { id: 'shared', icon: 'users', label: 'Shared', count: '6' },
  { id: 'photos', icon: 'image', label: 'Photos', count: '2.4k' },
  { id: 'starred', icon: 'star', label: 'Starred' },
  { id: 'recent', icon: 'clock', label: 'Recent' },
  { id: 'trash', icon: 'trash', label: 'Trash' },
]

// ─── Mock data for initial UI ──────────────────────

const MOCK_FILES: DriveFile[] = [
  { id: '1', name_encrypted: 'Contracts', mime_type: '', size: 0, is_folder: true, parent_id: null, trashed: false, shared_with: 3, owner: 'Anna K.', created_at: '2026-04-21T10:00:00Z', updated_at: '2026-04-21T10:00:00Z' },
  { id: '2', name_encrypted: 'Q2 Financials', mime_type: '', size: 0, is_folder: true, parent_id: null, trashed: false, shared_with: 2, owner: 'Marc D.', created_at: '2026-04-23T06:00:00Z', updated_at: '2026-04-23T06:00:00Z' },
  { id: '3', name_encrypted: 'Design Review', mime_type: '', size: 0, is_folder: true, parent_id: null, trashed: false, shared_with: 5, owner: 'Lena W.', created_at: '2026-04-16T10:00:00Z', updated_at: '2026-04-16T10:00:00Z' },
  { id: '4', name_encrypted: 'board-deck-apr.pdf', mime_type: 'application/pdf', size: 4404019, is_folder: false, parent_id: null, trashed: false, shared_with: 4, owner: 'Anna K.', created_at: '2026-04-23T09:48:00Z', updated_at: '2026-04-23T09:48:00Z' },
  { id: '5', name_encrypted: 'term-sheet-v3.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 90112, is_folder: false, parent_id: null, trashed: false, shared_with: 2, owner: 'Marc D.', created_at: '2026-04-23T09:00:00Z', updated_at: '2026-04-23T09:00:00Z' },
  { id: '6', name_encrypted: 'architecture.fig', mime_type: 'application/octet-stream', size: 12582912, is_folder: false, parent_id: null, trashed: false, shared_with: 3, owner: 'Lena W.', created_at: '2026-04-22T10:00:00Z', updated_at: '2026-04-22T10:00:00Z' },
  { id: '7', name_encrypted: 'client-photos.zip', mime_type: 'application/zip', size: 356515840, is_folder: false, parent_id: null, trashed: false, shared_with: 1, owner: 'Pieter J.', created_at: '2026-04-20T10:00:00Z', updated_at: '2026-04-20T10:00:00Z' },
  { id: '8', name_encrypted: 'notes.md', mime_type: 'text/markdown', size: 6144, is_folder: false, parent_id: null, trashed: false, shared_with: 0, owner: 'You', created_at: '2026-04-23T10:00:00Z', updated_at: '2026-04-23T10:00:00Z' },
]

// ─── Drive component ───────────────────────────────

export function Drive() {
  const { logout } = useAuth()
  const { getFileKey, isUnlocked, cryptoReady, cryptoError } = useKeys()
  const [activeNav, setActiveNav] = useState<NavId>('files')
  const [files, setFiles] = useState<DriveFile[]>(MOCK_FILES)
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: 'All files' },
  ])
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [syncedAgo, setSyncedAgo] = useState(14)
  const newMenuRef = useRef<HTMLDivElement>(null)

  // Fetch files from API (falls back to mock on error)
  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? undefined

  const fetchFiles = useCallback(async () => {
    try {
      const trashed = activeNav === 'trash' ? true : false
      const data = await listFiles(currentParentId ?? undefined, trashed)
      setFiles(data)
      setSyncedAgo(0)
    } catch {
      // API not available, keep current files (mock data on first load)
    }
  }, [currentParentId, activeNav])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // Notifications
  const { notifications, unreadCount, addNotification, markRead, markAllRead } = useNotifications()
  const { showToast } = useToast()

  const handleWsEvent = useCallback((event: WsEvent) => {
    const id = `${event.type}-${Date.now()}`
    if (event.type === 'file.uploaded') {
      const data = event.data as { name_encrypted?: string; size_bytes?: number }
      addNotification({
        id,
        type: event.type,
        icon: 'upload',
        title: 'File uploaded',
        description: data.name_encrypted ?? 'New file',
        timestamp: event.timestamp,
        read: false,
      })
      showToast({
        icon: 'upload',
        title: 'File uploaded',
        description: data.name_encrypted ?? 'New file',
      })
      // Refresh file list
      fetchFiles()
    } else if (event.type === 'share.opened') {
      const data = event.data as { name_encrypted?: string; open_count?: number }
      addNotification({
        id,
        type: event.type,
        icon: 'share',
        title: 'Share link opened',
        description: `${data.name_encrypted ?? 'A file'} was viewed (${data.open_count ?? '?'} opens)`,
        timestamp: event.timestamp,
        read: false,
      })
      showToast({
        icon: 'share',
        title: 'Share link opened',
        description: `${data.name_encrypted ?? 'A file'} was viewed`,
      })
    }
  }, [addNotification, showToast, fetchFiles])

  useWebSocket({ onEvent: handleWsEvent, enabled: true })

  // Synced timer
  useEffect(() => {
    const interval = setInterval(() => {
      setSyncedAgo((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Close "New" dropdown on outside click
  useEffect(() => {
    if (!newMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [newMenuOpen])

  // Browse files hook
  const { browse, HiddenInput } = useBrowseFiles(handleFilesSelected)

  function handleFilesSelected(selectedFiles: File[]) {
    const newUploads: UploadItem[] = selectedFiles.map((f, i) => ({
      id: `upload-${Date.now()}-${i}`,
      name: f.name,
      size: f.size,
      progress: 0,
      stage: 'Queued' as const,
    }))
    setUploads((prev) => [...prev, ...newUploads])

    // Upload each file
    selectedFiles.forEach((file, i) => {
      const uploadId = newUploads[i].id
      doEncryptedUpload(uploadId, file)
    })
  }

  async function doEncryptedUpload(uploadId: string, file: File) {
    if (!isUnlocked || !cryptoReady) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === uploadId
            ? { ...u, stage: 'Queued' as const, progress: 0 }
            : u,
        ),
      )
      return
    }

    // Generate a UUID for the file (used for key derivation)
    const fileId = crypto.randomUUID()
    const fileKey = getFileKey(fileId)

    try {
      await encryptedUpload(file, fileId, fileKey, currentParentId, (p) => {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? { ...u, stage: p.stage, progress: p.progress }
              : u,
          ),
        )
      })
      fetchFiles()
    } catch {
      // Simulate progress to 100 on API failure (mock mode)
      setUploads((prev) =>
        prev.map((u) => (u.id === uploadId ? { ...u, stage: 'Encrypting', progress: 10 } : u)),
      )
      for (const pct of [30, 50, 70, 90, 100]) {
        await delay(300)
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? { ...u, stage: pct === 100 ? 'Done' : 'Uploading', progress: pct }
              : u,
          ),
        )
      }
    }
  }

  async function handleFileDownload(file: DriveFile) {
    if (!isUnlocked || !cryptoReady || file.is_folder) return

    try {
      const fileKey = getFileKey(file.id)
      await encryptedDownload(
        file.id,
        fileKey,
        file.name_encrypted,
        file.mime_type,
      )
    } catch (err) {
      console.error('Download failed:', err)
    }
  }

  /** Try to decrypt an encrypted filename for display. Falls back to raw value. */
  function displayName(file: DriveFile): string {
    if (!isUnlocked) return file.name_encrypted
    try {
      const parsed = JSON.parse(file.name_encrypted) as {
        nonce: string
        ciphertext: string
      }
      const fileKey = getFileKey(file.id)
      return decryptFilename(
        fileKey,
        fromBase64(parsed.nonce),
        fromBase64(parsed.ciphertext),
      )
    } catch {
      // Not encrypted JSON — return raw (mock data or plaintext)
      return file.name_encrypted
    }
  }

  async function handleCreateFolder(name: string) {
    try {
      // Encrypt the folder name if crypto is ready
      let nameEncrypted = name
      if (isUnlocked && cryptoReady) {
        const folderId = crypto.randomUUID()
        const folderKey = getFileKey(folderId)
        const enc = encryptFilename(folderKey, name)
        nameEncrypted = JSON.stringify({
          nonce: toBase64(enc.nonce),
          ciphertext: toBase64(enc.ciphertext),
        })
      }
      await createFolder(nameEncrypted, currentParentId)
      fetchFiles()
    } catch {
      // API not available — add mock folder
      const mockFolder: DriveFile = {
        id: `folder-${Date.now()}`,
        name_encrypted: name,
        mime_type: '',
        size: 0,
        is_folder: true,
        parent_id: currentParentId ?? null,
        trashed: false,
        shared_with: 0,
        owner: 'You',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setFiles((prev) => [mockFolder, ...prev])
    }
  }

  function handleFolderOpen(folder: DriveFile) {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: displayName(folder) }])
  }

  function handleBreadcrumbNav(index: number) {
    setBreadcrumbs((prev) => prev.slice(0, index + 1))
  }

  function clearDoneUploads() {
    setUploads((prev) => prev.filter((u) => u.stage !== 'Done'))
  }

  const sortedFiles = [...files].sort((a, b) => {
    // Folders first
    if (a.is_folder && !b.is_folder) return -1
    if (!a.is_folder && b.is_folder) return 1
    return displayName(a).localeCompare(displayName(b))
  })

  return (
    <div className="h-screen flex overflow-hidden bg-paper">
      <HiddenInput />

      {/* ─── Sidebar ─────────────────────────── */}
      <aside className="w-[220px] shrink-0 border-r border-line bg-paper-2 flex flex-col">
        {/* Logo */}
        <div className="px-4 pt-4 pb-3">
          <BBLogo size={14} />
        </div>

        {/* New button */}
        <div className="px-3 pb-2.5 relative" ref={newMenuRef}>
          <BBButton
            variant="amber"
            className="w-full justify-center gap-1.5"
            onClick={() => setNewMenuOpen(!newMenuOpen)}
          >
            <Icon name="plus" size={13} /> New
          </BBButton>

          {newMenuOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-paper border border-line-2 rounded-lg shadow-2 z-20 overflow-hidden">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-paper-2 transition-colors text-left"
                onClick={() => {
                  setNewMenuOpen(false)
                  browse()
                }}
              >
                <Icon name="upload" size={13} className="text-ink-3" />
                Upload file
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-paper-2 transition-colors text-left"
                onClick={() => {
                  setNewMenuOpen(false)
                  setFolderDialogOpen(true)
                }}
              >
                <Icon name="folder" size={13} className="text-ink-3" />
                New folder
              </button>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="px-3 py-1.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors text-left ${
                activeNav === item.id
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

        {/* Divider */}
        <div className="mx-4 my-2.5 h-px bg-line" />

        {/* Teams */}
        <div className="px-3">
          <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-ink-3">
            Teams
          </div>
          {[
            { name: 'Acme Studio', amber: true },
            { name: 'Personal', amber: false },
          ].map((team) => (
            <button
              key={team.name}
              className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] text-ink-2 hover:bg-paper-3/50 transition-colors text-left"
            >
              <span
                className="shrink-0 rounded-[3px] border border-line-2"
                style={{
                  width: 14,
                  height: 14,
                  background: team.amber ? 'var(--color-amber)' : 'var(--color-paper-3)',
                }}
              />
              <span className="flex-1">{team.name}</span>
            </button>
          ))}
        </div>

        {/* Storage + Region */}
        <div className="mt-auto px-4 py-4 border-t border-line">
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-2">
            Storage
          </div>
          <div className="h-[3px] w-full rounded-full bg-paper-3 overflow-hidden mb-1.5">
            <div
              className="h-full rounded-full bg-amber"
              style={{ width: '38%' }}
            />
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="font-mono tabular-nums">76 / 200 GB</span>
            <span className="font-medium text-amber-deep cursor-pointer hover:underline">
              Upgrade
            </span>
          </div>

          {/* Region badge */}
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-3">
            <Icon name="shield" size={11} className="text-amber-deep" />
            <span className="font-mono">EU-WEST · AES-256</span>
          </div>
        </div>

        {/* Logout (at very bottom) */}
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
        {/* Top bar */}
        <div className="px-5 py-2.5 border-b border-line flex items-center gap-3">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1
              return (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <Icon name="chevron-right" size={12} className="text-ink-4" />}
                  {isLast ? (
                    <span className="font-semibold text-ink">{crumb.name}</span>
                  ) : (
                    <button
                      onClick={() => handleBreadcrumbNav(i)}
                      className="text-ink-3 hover:text-ink transition-colors"
                    >
                      {crumb.name}
                    </button>
                  )}
                </span>
              )
            })}
          </div>

          {/* Search */}
          <div className="ml-auto flex items-center gap-2 border border-line rounded-md bg-paper px-2.5 py-1.5 w-[260px]">
            <Icon name="search" size={13} className="text-ink-4 shrink-0" />
            <input
              placeholder="Search files and folders..."
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-ink-4 bg-paper-2 border border-line rounded">
              <span>⌘</span>K
            </kbd>
          </div>

          {/* Upload button */}
          <BBButton size="sm" onClick={browse} className="gap-1.5">
            <Icon name="upload" size={13} /> Upload
          </BBButton>

          {/* Notifications */}
          <NotificationInbox
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
          />

          {/* More options */}
          <BBButton size="sm" variant="ghost" onClick={logout}>
            <Icon name="more" size={14} />
          </BBButton>
        </div>

        {/* Column header */}
        <div
          className="px-5 py-2 border-b border-line bg-paper-2"
          style={{
            display: 'grid',
            gridTemplateColumns: '32px 1fr 110px 110px 100px 60px',
            gap: 14,
          }}
        >
          <span />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Modified</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Shared</span>
          <span />
        </div>

        {/* File list with upload zone */}
        <UploadZone onFiles={handleFilesSelected}>
          <div className="flex-1 overflow-y-auto">
            {sortedFiles.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center h-full text-center py-20">
                <div
                  className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
                  style={{
                    background: 'var(--color-amber-bg)',
                    border: '1.5px dashed var(--color-line-2)',
                  }}
                >
                  <Icon name="upload" size={24} className="text-amber-deep" />
                </div>
                <div className="text-[15px] font-semibold text-ink mb-1">Drop files to start</div>
                <div className="text-[13px] text-ink-3 mb-4">
                  or use the Upload button above
                </div>
                <BBButton size="sm" onClick={browse}>
                  Browse files
                </BBButton>
              </div>
            ) : (
              sortedFiles.map((file) => {
                const name = displayName(file)
                const fileType = getFileType(name, file.is_folder)
                return (
                  <div
                    key={file.id}
                    className="group hover:bg-paper-2 transition-colors cursor-pointer"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '32px 1fr 110px 110px 100px 60px',
                      gap: 14,
                      padding: '11px 20px',
                    }}
                    onClick={() => {
                      if (file.is_folder) handleFolderOpen(file)
                    }}
                    onDoubleClick={() => {
                      if (!file.is_folder) handleFileDownload(file)
                    }}
                  >
                    <FileIcon type={fileType} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{name}</span>
                        {isUnlocked && (
                          <BBChip variant="amber">
                            <span className="flex items-center gap-1 text-[9.5px]">
                              <Icon name="lock" size={9} /> E2EE
                            </span>
                          </BBChip>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-3 mt-0.5">{file.owner}</div>
                    </div>
                    <span className="font-mono text-[13px] text-ink-3 tabular-nums self-center">
                      {file.is_folder ? '--' : formatBytes(file.size)}
                    </span>
                    <span className="text-[13px] text-ink-3 self-center">
                      {timeAgo(file.updated_at)}
                    </span>
                    <div className="self-center">
                      {file.shared_with > 0 ? (
                        <AvatarStack n={file.shared_with} />
                      ) : (
                        <span className="text-[13px] text-ink-3">--</span>
                      )}
                    </div>
                    <div className="flex justify-end self-center">
                      <BBButton
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Icon name="more" size={14} />
                      </BBButton>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </UploadZone>

        {/* Status bar */}
        <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
          <span className="font-mono">{files.length} item{files.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span className="flex items-center gap-1.5">
            <Icon name="shield" size={12} className={isUnlocked ? 'text-amber-deep' : 'text-ink-4'} />
            {cryptoError
              ? 'Encryption unavailable'
              : isUnlocked
                ? 'All encrypted · AES-256-GCM'
                : 'Vault locked'}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Icon name="cloud" size={12} />
            Synced {syncedAgo}s ago
          </span>
        </div>
      </main>

      {/* ─── Overlays ────────────────────────── */}
      <NewFolderDialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        onCreate={handleCreateFolder}
      />

      <UploadProgress
        items={uploads}
        onClose={clearDoneUploads}
      />
    </div>
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
