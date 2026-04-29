import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { FileIcon, getFileType } from '../components/file-icon'
import { FileDetailsPanel, type FileDetailsMeta } from '../components/file-details-panel'
import { ShareDialog } from '../components/share-dialog'
import { MoveModal } from '../components/move-modal'
import { ContextMenu } from '../components/context-menu'
import { RenameDialog } from '../components/rename-dialog'
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
  toggleStar,
  updateFile,
  type DriveFile,
} from '../lib/api'
import { encryptedUpload } from '../lib/encrypted-upload'
import { encryptedDownload } from '../lib/encrypted-download'
import { decryptFilename, encryptFilename, fromBase64, toBase64 } from '../lib/crypto'
import { useSearchIndex } from '../hooks/use-search-index'

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

// ─── Drive component ───────────────────────────────

export function Drive() {
  const { logout } = useAuth()
  const { getFileKey, isUnlocked, cryptoReady, cryptoError } = useKeys()
  const { indexFile, unindexFile } = useSearchIndex()
  const location = useLocation()
  const navigate = useNavigate()
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: 'All files' },
  ])
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [syncedAgo, setSyncedAgo] = useState(14)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [shareFileId, setShareFileId] = useState<string | null>(null)
  const [moveFileId, setMoveFileId] = useState<string | null>(null)
  const [renameFileId, setRenameFileId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean; x: number; y: number; fileId: string; fileName: string; isFolder: boolean
  }>({ open: false, x: 0, y: 0, fileId: '', fileName: '', isFolder: false })

  const viewType = location.pathname === '/starred' ? 'starred'
    : location.pathname === '/recent' ? 'recent'
    : 'files'

  const viewTitle = viewType === 'starred' ? 'Starred'
    : viewType === 'recent' ? 'Recent'
    : breadcrumbs[breadcrumbs.length - 1]?.name ?? 'All files'

  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? undefined

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const trashed = location.pathname === '/trash'
      let data = await listFiles(currentParentId ?? undefined, trashed)
      if (viewType === 'starred') {
        data = data.filter((f) => f.is_starred)
      } else if (viewType === 'recent') {
        data = [...data].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      }
      setFiles(data)
      setSyncedAgo(0)
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [currentParentId, location.pathname, viewType])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // Notifications
  const { notifications, unreadCount, addNotification, markRead, markAllRead } = useNotifications()
  const { showToast } = useToast()

  const handleWsEvent = useCallback((event: WsEvent) => {
    const id = `${event.type}-${Date.now()}`
    if (event.type === 'file.uploaded') {
      // Just refresh the file list — the uploader's own progress UI handles feedback
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


  // Browse files hook
  const { browse, HiddenInput } = useBrowseFiles(handleFilesSelected)

  function resolveUniqueName(name: string): string {
    const existing = new Set(Object.values(decryptedNames))
    if (!existing.has(name)) return name
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let n = 1
    while (existing.has(`${base}_${n}${ext}`)) n++
    return `${base}_${n}${ext}`
  }

  function handleFilesSelected(selectedFiles: File[]) {
    const resolved = selectedFiles.map((f) => {
      const uniqueName = resolveUniqueName(f.name)
      if (uniqueName !== f.name) {
        return new File([f], uniqueName, { type: f.type, lastModified: f.lastModified })
      }
      return f
    })

    const newUploads: UploadItem[] = resolved.map((f, i) => ({
      id: `upload-${Date.now()}-${i}`,
      name: f.name,
      size: f.size,
      progress: 0,
      stage: 'Queued' as const,
    }))
    setUploads((prev) => [...prev, ...newUploads])

    resolved.forEach((file, i) => {
      const uploadId = newUploads[i].id
      doEncryptedUpload(uploadId, file)
    })
  }

  async function doEncryptedUpload(uploadId: string, file: File) {
    if (!isUnlocked || !cryptoReady) {
      showToast({
        icon: 'lock',
        title: 'Vault is locked',
        description: 'Log in again to unlock encryption before uploading.',
        danger: true,
      })
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
      return
    }

    // Generate a UUID for the file (used for key derivation)
    const fileId = crypto.randomUUID()
    const fileKey = await getFileKey(fileId)

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

      // Update the encrypted search index with the new file
      const pathPrefix = breadcrumbs.slice(1).map((b) => b.name).join('/')
      indexFile(fileId, {
        name: file.name,
        path: pathPrefix ? `/${pathPrefix}` : '/',
        type: file.type || 'application/octet-stream',
        size: file.size,
        parent: currentParentId ?? null,
        starred: false,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        tags: [],
      })

      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
      showToast({ icon: 'check', title: 'Uploaded', description: file.name })
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'upload',
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Something went wrong',
        danger: true,
      })
      setUploads((prev) =>
        prev.map((u) =>
          u.id === uploadId
            ? { ...u, stage: 'Queued' as const, progress: 0 }
            : u,
        ),
      )
    }
  }

  async function handleFileDownload(file: DriveFile) {
    if (!isUnlocked || !cryptoReady || file.is_folder) return

    try {
      const fileKey = await getFileKey(file.id)
      await encryptedDownload(
        file.id,
        fileKey,
        file.name_encrypted,
        file.mime_type,
        file.chunk_count,
        file.size_bytes,
      )
    } catch (err) {
      console.error('Download failed:', err)
      showToast({
        icon: 'download',
        title: 'Download failed',
        description: err instanceof Error ? err.message : 'Could not decrypt the file.',
        danger: true,
      })
    }
  }

  // Decrypt file names asynchronously when files or unlock state change
  useEffect(() => {
    if (!isUnlocked) {
      setDecryptedNames({})
      return
    }
    let cancelled = false
    async function decryptAll() {
      const names: Record<string, string> = {}
      for (const file of files) {
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
          // Not encrypted JSON — use raw value
          names[file.id] = file.name_encrypted
        }
      }
      if (!cancelled) setDecryptedNames(names)
    }
    decryptAll()
    return () => { cancelled = true }
  }, [files, isUnlocked, getFileKey])

  /** Get the display name for a file (decrypted if available, raw otherwise). */
  function displayName(file: DriveFile): string {
    return decryptedNames[file.id] ?? file.name_encrypted
  }

  async function handleCreateFolder(name: string) {
    try {
      // Encrypt the folder name if crypto is ready
      let nameEncrypted = name
      let folderId: string | undefined
      if (isUnlocked && cryptoReady) {
        folderId = crypto.randomUUID()
        const folderKey = await getFileKey(folderId)
        const enc = await encryptFilename(folderKey, name)
        nameEncrypted = JSON.stringify({
          nonce: toBase64(enc.nonce),
          ciphertext: toBase64(enc.ciphertext),
        })
      }
      const result = await createFolder(nameEncrypted, currentParentId)

      // Update the encrypted search index with the new folder
      const pathPrefix = breadcrumbs.slice(1).map((b) => b.name).join('/')
      indexFile(result.id, {
        name,
        path: pathPrefix ? `/${pathPrefix}` : '/',
        type: 'folder',
        size: 0,
        parent: currentParentId ?? null,
        starred: false,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        tags: [],
      })

      fetchFiles()
    } catch {
      // API not available
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

  // ─── File details panel helpers ───────────────────

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null

  function buildDetailsMeta(file: DriveFile): FileDetailsMeta {
    const name = displayName(file)
    const ext = name.includes('.') ? name.split('.').pop() ?? '' : ''
    const locationPath = breadcrumbs.map((b) => b.name).join(' / ')
    return {
      id: file.id,
      name,
      extension: ext,
      mimeType: file.mime_type || null,
      sizeBytes: file.size_bytes,
      isFolder: file.is_folder,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
      location: locationPath || '/',
      cipher: isUnlocked ? 'AES-256-GCM' : undefined,
      keyId: isUnlocked ? file.id : undefined,
      region: 'eu-central (Frankfurt)',
    }
  }

  function handleFileSelect(file: DriveFile) {
    if (file.is_folder) {
      handleFolderOpen(file)
    } else {
      setSelectedFileId(file.id)
    }
  }

  async function handleToggleStar(fileId: string) {
    try {
      const result = await toggleStar(fileId)
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, is_starred: result.is_starred } : f,
        ),
      )
    } catch {
      // API not available
    }
  }

  // ─── Move handler ─────────────────────────────────

  async function handleMoveConfirm(destinationId: string | null, _mode: 'move' | 'copy') {
    if (!moveFileId) return
    try {
      await updateFile(moveFileId, { parent_id: destinationId ?? undefined })
      showToast({ icon: 'folder', title: 'File moved', description: 'Moved successfully.' })
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Move failed',
        description: err instanceof Error ? err.message : 'Could not move file.',
        danger: true,
      })
    } finally {
      setMoveFileId(null)
    }
  }

  // ─── Rename handler ─────────────────────────────────

  async function handleRenameConfirm(newName: string) {
    if (!renameFileId) return
    if (!isUnlocked || !cryptoReady) {
      showToast({
        icon: 'lock',
        title: 'Vault is locked',
        description: 'Unlock the vault before renaming files.',
        danger: true,
      })
      return
    }
    try {
      const fileKey = await getFileKey(renameFileId)
      const enc = await encryptFilename(fileKey, newName)
      const nameEncrypted = JSON.stringify({
        nonce: toBase64(enc.nonce),
        ciphertext: toBase64(enc.ciphertext),
      })
      await updateFile(renameFileId, { name_encrypted: nameEncrypted })
      showToast({ icon: 'check', title: 'Renamed', description: `Renamed to "${newName}".` })
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Rename failed',
        description: err instanceof Error ? err.message : 'Could not rename file.',
        danger: true,
      })
    } finally {
      setRenameFileId(null)
    }
  }

  // ─── Context menu actions ───────────────────────────

  function handleContextAction(action: string, fileId: string) {
    const file = files.find((f) => f.id === fileId)
    if (!file) return

    switch (action) {
      case 'open':
        handleFileSelect(file)
        break
      case 'share':
        setShareFileId(fileId)
        break
      case 'move':
        setMoveFileId(fileId)
        break
      case 'rename':
        if (!isUnlocked || !cryptoReady) {
          showToast({
            icon: 'lock',
            title: 'Vault is locked',
            description: 'Unlock the vault before renaming files.',
            danger: true,
          })
          return
        }
        setRenameFileId(fileId)
        break
      case 'star':
        handleToggleStar(fileId)
        break
      case 'download':
        handleFileDownload(file)
        break
      case 'trash':
        // Existing trash logic will be handled separately
        break
      default:
        break
    }
  }

  // ─── Derived data ───────────────────────────────────

  const moveFile = files.find((f) => f.id === moveFileId) ?? null
  const renameFile = files.find((f) => f.id === renameFileId) ?? null

  // The file currently shown in the share dialog
  const shareFile = files.find((f) => f.id === shareFileId) ?? null

  const sortedFiles = [...files].sort((a, b) => {
    // Folders first
    if (a.is_folder && !b.is_folder) return -1
    if (!a.is_folder && b.is_folder) return 1
    return displayName(a).localeCompare(displayName(b))
  })

  return (
    <DriveLayout>
      <HiddenInput />
      {/* Top bar */}
        <div className="px-5 py-2.5 border-b border-line flex items-center gap-3">
          {/* Breadcrumbs / view title */}
          <div className="flex items-center gap-1.5 text-sm">
            {viewType !== 'files' ? (
              <span className="font-semibold text-ink">{viewTitle}</span>
            ) : (
              breadcrumbs.map((crumb, i) => {
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
              })
            )}
          </div>

          {/* Search */}
          <form
            className="ml-auto flex items-center gap-2 border border-line rounded-md bg-paper px-2.5 py-1.5 w-[260px]"
            onSubmit={(e) => {
              e.preventDefault()
              const input = e.currentTarget.querySelector('input')
              if (input?.value.trim()) navigate(`/search?q=${encodeURIComponent(input.value.trim())}`)
            }}
          >
            <Icon name="search" size={13} className="text-ink-4 shrink-0" />
            <input
              placeholder="Search files and folders..."
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-ink-4 bg-paper-2 border border-line rounded">
              <span>⌘</span>K
            </kbd>
          </form>

          {/* New + Upload */}
          <div className="flex items-center gap-1.5">
            <BBButton size="sm" variant="amber" onClick={() => setFolderDialogOpen(true)} className="gap-1.5">
              <Icon name="plus" size={13} /> New
            </BBButton>
            <BBButton size="sm" onClick={browse} className="gap-1.5">
              <Icon name="upload" size={13} /> Upload
            </BBButton>
          </div>

          {/* Notifications */}
          <NotificationInbox
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
          />
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
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : sortedFiles.length === 0 ? (
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
                    className={`group hover:bg-paper-2 transition-colors cursor-pointer ${
                      selectedFileId === file.id ? 'bg-amber-bg/50' : ''
                    }`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '32px 1fr 110px 110px 100px 60px',
                      gap: 14,
                      padding: '11px 20px',
                    }}
                    onClick={() => handleFileSelect(file)}
                    onDoubleClick={() => {
                      if (!file.is_folder) handleFileDownload(file)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setCtxMenu({
                        open: true,
                        x: e.clientX,
                        y: e.clientY,
                        fileId: file.id,
                        fileName: name,
                        isFolder: file.is_folder,
                      })
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
                      <div className="text-[11px] text-ink-3 mt-0.5">{file.mime_type || 'Folder'}</div>
                    </div>
                    <span className="font-mono text-[13px] text-ink-3 tabular-nums self-center">
                      {file.is_folder ? '--' : formatBytes(file.size_bytes)}
                    </span>
                    <span className="text-[13px] text-ink-3 self-center">
                      {timeAgo(file.updated_at)}
                    </span>
                    <div className="self-center">
                      <span className="text-[13px] text-ink-3">--</span>
                    </div>
                    <div className="flex justify-end self-center">
                      <BBButton
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation()
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          setCtxMenu({
                            open: true,
                            x: rect.left,
                            y: rect.bottom + 4,
                            fileId: file.id,
                            fileName: name,
                            isFolder: file.is_folder,
                          })
                        }}
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

      <FileDetailsPanel
        open={selectedFile !== null}
        onClose={() => setSelectedFileId(null)}
        file={selectedFile ? buildDetailsMeta(selectedFile) : null}
        onDownload={() => selectedFile && handleFileDownload(selectedFile)}
        onShare={() => {
          if (selectedFile) {
            setShareFileId(selectedFile.id)
            setSelectedFileId(null)
          }
        }}
        onStar={() => selectedFile && handleToggleStar(selectedFile.id)}
        isStarred={selectedFile?.is_starred ?? false}
        onTrash={() => setSelectedFileId(null)}
      />

      {shareFile && (
        <ShareDialog
          open={shareFileId !== null}
          onClose={() => setShareFileId(null)}
          fileId={shareFile.id}
          fileName={displayName(shareFile)}
          fileSize={shareFile.size_bytes}
        />
      )}

      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        fileId={ctxMenu.fileId}
        fileName={ctxMenu.fileName}
        isFolder={ctxMenu.isFolder}
        onClose={() => setCtxMenu((prev) => ({ ...prev, open: false }))}
        onAction={handleContextAction}
      />

      {moveFile && (
        <MoveModal
          open={moveFileId !== null}
          onClose={() => setMoveFileId(null)}
          items={[{
            id: moveFile.id,
            name: displayName(moveFile),
            isFolder: moveFile.is_folder,
          }]}
          mode="move"
          onConfirm={handleMoveConfirm}
        />
      )}

      <RenameDialog
        open={renameFileId !== null}
        onClose={() => setRenameFileId(null)}
        currentName={renameFile ? displayName(renameFile) : ''}
        onRename={handleRenameConfirm}
      />
    </DriveLayout>
  )
}
