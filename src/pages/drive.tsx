import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { Breadcrumb } from '../components/breadcrumb'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBChip } from '../components/bb-chip'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { FileIcon, getFileType } from '../components/file-icon'
import { FileDetailsPanel, type FileDetailsMeta } from '../components/file-details-panel'
import { ShareDialog } from '../components/share-dialog'
import { MoveModal } from '../components/move-modal'
import { ContextMenu } from '../components/context-menu'
import { RenameDialog } from '../components/rename-dialog'
import { UploadZone, useBrowseFiles, useBrowseFolders, type FolderFile } from '../components/upload-zone'
import { UploadProgress, type UploadItem } from '../components/upload-progress'
import { NewFolderDialog } from '../components/new-folder-dialog'
import { VersionHistory } from '../components/version-history'
import { NotificationInbox, useNotifications } from '../components/notification-inbox'
import { ShortcutsCheatsheet } from '../components/shortcuts-cheatsheet'
import { WelcomeTour } from '../components/welcome-tour'
import { getPreference, setPreference } from '../lib/api'
import { useToast } from '../components/toast'
import { useWsEvent } from '../lib/ws-context'
import { useKeys } from '../lib/key-context'
import { modKey, useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts'
import {
  listFiles,
  createFolder,
  toggleStar,
  updateFile,
  deleteFile,
  getIncomingInvites,
  getPendingApprovals,
  listMyShares,
  getStorageUsage,
  type DriveFile,
  type StorageUsage,
} from '../lib/api'
import { getRemainingBytes } from '../components/quota-warning'
import { encryptedUpload } from '../lib/encrypted-upload'
import { encryptedDownload } from '../lib/encrypted-download'
import {
  computeFingerprint,
  getActiveUploads,
  findByFingerprint,
  removeUploadState,
  type UploadState,
} from '../lib/upload-resume'
import { decryptFilename, encryptFilename, fromBase64, toBase64 } from '../lib/crypto'
import { useSearchIndex } from '../hooks/use-search-index'
import { FileRowSkeleton } from '../components/skeleton'
import { EmptyDrive } from '../components/empty-states/empty-drive'

// ─── Sort options ───────────────────────────────────
// Folders are always grouped before files; the chosen key only orders
// within each group. localStorage key: 'bb_drive_sort'.

type SortKey =
  | 'name-asc' | 'name-desc'
  | 'modified-desc' | 'modified-asc'
  | 'size-desc' | 'size-asc'
  | 'type-asc'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name-asc',     label: 'Name (A → Z)' },
  { key: 'name-desc',    label: 'Name (Z → A)' },
  { key: 'modified-desc', label: 'Modified (newest)' },
  { key: 'modified-asc',  label: 'Modified (oldest)' },
  { key: 'size-desc',    label: 'Size (largest)' },
  { key: 'size-asc',     label: 'Size (smallest)' },
  { key: 'type-asc',     label: 'Type' },
]

function sortLabel(key: SortKey): string {
  return SORT_OPTIONS.find((o) => o.key === key)?.label ?? 'Sort'
}

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

// ─── Drive component ───────────────────────────────

export function Drive() {
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
  const uploadAbortRef = useRef<Map<string, AbortController>>(new Map())
  const [syncedAgo, setSyncedAgo] = useState(14)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [shareFileId, setShareFileId] = useState<string | null>(null)
  const [moveFileId, setMoveFileId] = useState<string | null>(null)
  const [renameFileId, setRenameFileId] = useState<string | null>(null)
  const [versionFileId, setVersionFileId] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [tourCompleted, setTourCompleted] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      const raw = localStorage.getItem('bb_drive_sort')
      if (raw) {
        const parsed = JSON.parse(raw) as { key?: string }
        if (parsed.key && SORT_OPTIONS.some((o) => o.key === parsed.key)) {
          return parsed.key as SortKey
        }
      }
    } catch { /* fall through to default */ }
    return 'name-asc'
  })
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean; x: number; y: number; fileId: string; fileName: string; isFolder: boolean
  }>({ open: false, x: 0, y: 0, fileId: '', fileName: '', isFolder: false })
  const [pausedUploads, setPausedUploads] = useState<UploadState[]>([])

  // ─── Pending shares state ────────────────────────────
  const [incomingInviteCount, setIncomingInviteCount] = useState(0)
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0)
  const [pendingSharesDismissed, setPendingSharesDismissed] = useState(false)

  // ─── Multi-select state ──────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastClickedIdRef = useRef<string | null>(null)
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)

  // ─── Drag-and-drop state ────────────────────────────
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)

  // ─── Micro-interaction state ───────────────────────
  const [recentlyUploaded, setRecentlyUploaded] = useState<Set<string>>(new Set())
  const [trashingIds, setTrashingIds] = useState<Set<string>>(new Set())
  const [starPulseId, setStarPulseId] = useState<string | null>(null)

  // ─── Storage quota state ─────────────────────────
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)

  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? undefined

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const trashed = location.pathname === '/trash'
      const data = await listFiles(currentParentId ?? undefined, trashed)
      setFiles(data)
      setSyncedAgo(0)
    } catch (err) {
      console.error('[Drive] Failed to load files:', err)
      showToast({ icon: 'x', title: 'Failed to load files', danger: true })
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [currentParentId, location.pathname])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // Deep-link into a folder when navigating from search results
  useEffect(() => {
    const state = location.state as { openFolderId?: string | null; openFolderName?: string } | null
    if (state?.openFolderId) {
      setBreadcrumbs([
        { id: null, name: 'All files' },
        { id: state.openFolderId, name: state.openFolderName ?? 'Folder' },
      ])
      // Clear location state so refreshing doesn't re-navigate
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, navigate, location.pathname])

  useEffect(() => {
    getPreference<{ seen?: boolean; completed?: string[] }>('welcome_tour')
      .then((pref) => {
        if (pref?.completed?.length) setTourCompleted(new Set(pref.completed))
        if (!pref?.seen) setTourOpen(true)
      })
      .catch(() => {})
  }, [])

  // Check IndexedDB for paused uploads on mount
  useEffect(() => {
    getActiveUploads()
      .then((active) => {
        // Filter out stale entries older than 7 days
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
        const recent = active.filter((u) => u.createdAt > cutoff)
        setPausedUploads(recent)
        // Clean up stale entries
        for (const old of active) {
          if (old.createdAt <= cutoff) {
            removeUploadState(old.fileId)
          }
        }
      })
      .catch(() => {
        // IndexedDB unavailable — ignore
      })
  }, [])

  // Fetch storage usage for quota checks
  const refreshUsage = useCallback(() => {
    getStorageUsage().then(setStorageUsage).catch(() => {})
  }, [])

  useEffect(() => {
    refreshUsage()
  }, [refreshUsage])

  // Check for pending share invites on mount
  useEffect(() => {
    Promise.all([
      getIncomingInvites().catch(() => []),
      getPendingApprovals().catch(() => []),
    ]).then(([incoming, approvals]) => {
      setIncomingInviteCount(incoming.length)
      setPendingApprovalCount(approvals.length)
    })
  }, [])

  // Notifications
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
  const { showToast } = useToast()

  // ─── Real-time WebSocket event handling ──────────

  // File list changes: refresh on create, upload, delete, trash, restore, move, rename
  useWsEvent(
    ['file.created', 'file.uploaded', 'file.deleted', 'file.trashed', 'file.restored', 'file.moved', 'file.renamed', 'version.restored'],
    useCallback(() => {
      fetchFiles()
    }, [fetchFiles]),
  )

  // Star toggled on another device or by a collaborator — update in-place
  useWsEvent(
    ['file.starred'],
    useCallback((event) => {
      const data = event.data as { file_id?: string; is_starred?: boolean }
      if (data.file_id != null && data.is_starred != null) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === data.file_id ? { ...f, is_starred: data.is_starred as boolean } : f,
          ),
        )
      }
    }, []),
  )

  // Share link opened — show toast
  useWsEvent(
    ['share.opened'],
    useCallback((event) => {
      const data = event.data as { open_count?: number }
      showToast({
        icon: 'share',
        title: 'Share link opened',
        description: `A file was viewed (${data.open_count ?? '?'} opens)`,
      })
    }, [showToast]),
  )

  // Synced timer
  useEffect(() => {
    const interval = setInterval(() => {
      setSyncedAgo((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])


  // Browse files hook
  const { browse, HiddenInput } = useBrowseFiles(handleFilesSelected)
  const { browseFolder, HiddenFolderInput } = useBrowseFolders(handleFolderFilesSelected)

  // Resume upload handler
  async function handleResumeFile(selectedFiles: File[]) {
    if (!isUnlocked || !cryptoReady) {
      showToast({
        icon: 'lock',
        title: 'Vault is locked',
        description: 'Log in again to unlock encryption before resuming.',
        danger: true,
      })
      return
    }
    if (selectedFiles.length === 0) return

    for (const file of selectedFiles) {
      const fingerprint = await computeFingerprint(file)
      const match = await findByFingerprint(fingerprint)

      if (!match) {
        showToast({
          icon: 'upload',
          title: 'No matching upload found',
          description: `"${file.name}" does not match any paused upload.`,
          danger: true,
        })
        continue
      }

      const uploadId = `resume-${Date.now()}-${match.fileId.slice(0, 8)}`
      setUploads((prev) => [
        ...prev,
        {
          id: uploadId,
          name: file.name,
          size: file.size,
          progress: 0,
          stage: 'Uploading' as const,
        },
      ])

      // Remove from paused list immediately
      setPausedUploads((prev) => prev.filter((u) => u.fileId !== match.fileId))

      const fileKey = await getFileKey(match.fileId)
      try {
        await encryptedUpload(
          file,
          match.fileId,
          fileKey,
          match.parentId ?? undefined,
          (p) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId
                  ? { ...u, stage: p.stage, progress: p.progress }
                  : u,
              ),
            )
          },
          match.fileId, // resumeFileId
        )
        setUploads((prev) => prev.filter((u) => u.id !== uploadId))
        showToast({ icon: 'check', title: 'Upload resumed', description: file.name })
        fetchFiles()
      } catch (err) {
        showToast({
          icon: 'upload',
          title: 'Resume failed',
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
  }

  const { browse: browseResume, HiddenInput: HiddenResumeInput } = useBrowseFiles(handleResumeFile)

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
    // ─── Quota check ──────────────────────────────
    const remaining = getRemainingBytes(storageUsage?.used_bytes, storageUsage?.plan_limit_bytes)
    if (remaining !== null) {
      const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0)
      if (totalSize > remaining) {
        showToast({
          icon: 'shield',
          title: 'Not enough storage',
          description: `This upload needs ${formatBytes(totalSize)} but you only have ${formatBytes(remaining)} remaining.`,
          href: '/billing',
          danger: true,
        })
        return
      }
    }

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

    const abortController = new AbortController()
    uploadAbortRef.current.set(uploadId, abortController)

    try {
      let uploadStartedAt: number | undefined
      await encryptedUpload(file, fileId, fileKey, currentParentId, (p) => {
        if (p.stage === 'Uploading' && !uploadStartedAt) {
          uploadStartedAt = Date.now()
        }
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? {
                  ...u,
                  stage: p.stage,
                  progress: p.progress,
                  bytesUploaded: p.bytesUploaded,
                  startedAt: uploadStartedAt,
                }
              : u,
          ),
        )
      }, undefined, undefined, abortController.signal)

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
      uploadAbortRef.current.delete(uploadId)
      // Remove from paused list if this was a resume
      setPausedUploads((prev) => prev.filter((u) => u.fileId !== fileId))
      showToast({ icon: 'check', title: 'Uploaded', description: file.name })
      // Refresh storage usage so quota warning updates
      refreshUsage()
      // Mark as recently uploaded for glow animation
      setRecentlyUploaded((prev) => new Set(prev).add(fileId))
      setTimeout(() => {
        setRecentlyUploaded((prev) => {
          const next = new Set(prev)
          next.delete(fileId)
          return next
        })
      }, 1200)
      fetchFiles()
    } catch (err) {
      uploadAbortRef.current.delete(uploadId)
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Cancelled by user — silently remove from list
        setUploads((prev) => prev.filter((u) => u.id !== uploadId))
        return
      }
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

  async function handleFolderFilesSelected(folderFiles: FolderFile[]) {
    if (!isUnlocked || !cryptoReady) {
      showToast({
        icon: 'lock',
        title: 'Vault is locked',
        description: 'Log in again to unlock encryption before uploading.',
        danger: true,
      })
      return
    }

    if (folderFiles.length === 0) return

    // ─── Quota check ──────────────────────────────
    const remaining = getRemainingBytes(storageUsage?.used_bytes, storageUsage?.plan_limit_bytes)
    if (remaining !== null) {
      const totalSize = folderFiles.reduce((sum, ff) => sum + ff.file.size, 0)
      if (totalSize > remaining) {
        showToast({
          icon: 'shield',
          title: 'Not enough storage',
          description: `This folder needs ${formatBytes(totalSize)} but you only have ${formatBytes(remaining)} remaining.`,
          href: '/billing',
          danger: true,
        })
        return
      }
    }

    // Collect all unique folder paths from the file list, sorted by depth (parent first)
    const folderPaths = new Set<string>()
    for (const ff of folderFiles) {
      const parts = ff.relativePath.split('/')
      // Build all ancestor folder paths (excluding the filename itself)
      for (let i = 1; i < parts.length; i++) {
        folderPaths.add(parts.slice(0, i).join('/'))
      }
    }
    const sortedFolderPaths = Array.from(folderPaths).sort((a, b) => {
      const depthA = a.split('/').length
      const depthB = b.split('/').length
      if (depthA !== depthB) return depthA - depthB
      return a.localeCompare(b)
    })

    // Track total progress for all files in the folder upload
    const totalFiles = folderFiles.length
    let completedFiles = 0
    const foldUploadId = `folder-upload-${Date.now()}`
    const rootFolderName = folderFiles[0].relativePath.split('/')[0]

    setUploads((prev) => [
      ...prev,
      {
        id: foldUploadId,
        name: `${rootFolderName}/ (${totalFiles} files)`,
        size: folderFiles.reduce((sum, ff) => sum + ff.file.size, 0),
        progress: 0,
        stage: 'Encrypting' as const,
      },
    ])

    try {
      // Map of relative folder path -> server folder ID
      const folderIdMap: Record<string, string> = {}

      // Create all folders in order (parent before child)
      for (const folderPath of sortedFolderPaths) {
        const parts = folderPath.split('/')
        const folderName = parts[parts.length - 1]
        const parentPath = parts.slice(0, -1).join('/')
        const parentId = parentPath ? folderIdMap[parentPath] : currentParentId

        const folderId = crypto.randomUUID()
        const folderKey = await getFileKey(folderId)
        const enc = await encryptFilename(folderKey, folderName)
        const nameEncrypted = JSON.stringify({
          nonce: toBase64(enc.nonce),
          ciphertext: toBase64(enc.ciphertext),
        })

        const result = await createFolder(nameEncrypted, parentId, folderId)
        folderIdMap[folderPath] = result.id

        // Index the folder in the search index
        const pathPrefix = breadcrumbs.slice(1).map((b) => b.name).join('/')
        const folderLocation = parentPath
          ? `/${pathPrefix ? pathPrefix + '/' : ''}${parentPath}`
          : pathPrefix ? `/${pathPrefix}` : '/'
        indexFile(result.id, {
          name: folderName,
          path: folderLocation,
          type: 'folder',
          size: 0,
          parent: parentId ?? null,
          starred: false,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          tags: [],
        })
      }

      setUploads((prev) =>
        prev.map((u) =>
          u.id === foldUploadId ? { ...u, stage: 'Uploading' as const, progress: 5 } : u,
        ),
      )

      // Upload all files into their respective folders
      for (const ff of folderFiles) {
        const parts = ff.relativePath.split('/')
        const parentPath = parts.slice(0, -1).join('/')
        const parentId = parentPath ? folderIdMap[parentPath] : currentParentId

        const fileId = crypto.randomUUID()
        const fileKey = await getFileKey(fileId)

        await encryptedUpload(ff.file, fileId, fileKey, parentId, (p) => {
          // Blend per-file progress into overall progress
          const fileProgress = p.progress / 100
          const overallProgress = Math.round(
            5 + ((completedFiles + fileProgress) / totalFiles) * 95,
          )
          setUploads((prev) =>
            prev.map((u) =>
              u.id === foldUploadId
                ? { ...u, stage: p.stage === 'Done' ? 'Uploading' as const : p.stage, progress: overallProgress }
                : u,
            ),
          )
        })

        // Index each file
        const pathPrefix = breadcrumbs.slice(1).map((b) => b.name).join('/')
        const filePath = parentPath
          ? `/${pathPrefix ? pathPrefix + '/' : ''}${parentPath}`
          : pathPrefix ? `/${pathPrefix}` : '/'
        indexFile(fileId, {
          name: ff.file.name,
          path: filePath,
          type: ff.file.type || 'application/octet-stream',
          size: ff.file.size,
          parent: parentId ?? null,
          starred: false,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          tags: [],
        })

        completedFiles++
      }

      setUploads((prev) => prev.filter((u) => u.id !== foldUploadId))
      showToast({
        icon: 'check',
        title: 'Folder uploaded',
        description: `${rootFolderName}/ -- ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`,
      })
      refreshUsage()
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'upload',
        title: 'Folder upload failed',
        description: err instanceof Error ? err.message : 'Something went wrong',
        danger: true,
      })
      setUploads((prev) =>
        prev.map((u) =>
          u.id === foldUploadId
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
      // Create folder first to get the server-assigned ID
      // Then encrypt the name with that ID as the key derivation input
      const folderId = crypto.randomUUID()
      let nameEncrypted = name
      if (isUnlocked && cryptoReady) {
        const folderKey = await getFileKey(folderId)
        const enc = await encryptFilename(folderKey, name)
        nameEncrypted = JSON.stringify({
          nonce: toBase64(enc.nonce),
          ciphertext: toBase64(enc.ciphertext),
        })
      }
      const result = await createFolder(nameEncrypted, currentParentId, folderId)

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
    } catch (err) {
      showToast({
        icon: 'folder',
        title: 'Failed to create folder',
        description: err instanceof Error ? err.message : 'Something went wrong',
        danger: true,
      })
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

  function handleCancelUpload(uploadId: string) {
    const controller = uploadAbortRef.current.get(uploadId)
    if (controller) {
      controller.abort()
    } else {
      // For queued items not yet started, just remove them
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
    }
  }

  function handlePauseUpload(uploadId: string) {
    const controller = uploadAbortRef.current.get(uploadId)
    if (controller) {
      controller.abort()
      uploadAbortRef.current.delete(uploadId)
    }
    setUploads((prev) =>
      prev.map((u) =>
        u.id === uploadId ? { ...u, paused: true } : u,
      ),
    )
  }

  function handleResumeUpload(uploadId: string) {
    // Remove paused state — the upload will restart from where the server left off
    // via the resume detection in encryptedUpload
    setUploads((prev) =>
      prev.map((u) =>
        u.id === uploadId ? { ...u, paused: false, stage: 'Queued' as const } : u,
      ),
    )
    // Note: full resume requires re-picking the file, which we don't have access to here.
    // For now, pausing marks the item visually. A true resume would need the File object cached.
    showToast({ icon: 'upload', title: 'Upload paused', description: 'Drop the file again to resume.' })
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
      // Trigger star pulse animation
      setStarPulseId(fileId)
      setTimeout(() => setStarPulseId(null), 400)
    } catch (err) {
      showToast({
        icon: 'star',
        title: 'Failed to update star',
        description: err instanceof Error ? err.message : 'Something went wrong',
        danger: true,
      })
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

  async function handleContextAction(action: string, fileId: string) {
    const file = files.find((f) => f.id === fileId)
    if (!file) return

    switch (action) {
      case 'open':
        handleFileSelect(file)
        break
      case 'share':
        setShareFileId(fileId)
        break
      case 'copy-link':
        try {
          if (!isUnlocked || !cryptoReady) {
            showToast({
              icon: 'lock',
              title: 'Vault is locked',
              description: 'Unlock the vault to copy share links.',
              danger: true,
            })
            return
          }
          const shares = await listMyShares()
          const existingShare = shares.find((s) => s.file_id === fileId)
          if (!existingShare) {
            showToast({
              icon: 'link',
              title: 'No share link exists',
              description: 'Share the file first to create a link.',
            })
            return
          }
          const fileKey = await getFileKey(fileId)
          const keyB64 = toBase64(fileKey)
          const shareUrl = `${window.location.origin}/s/${existingShare.token}#key=${encodeURIComponent(keyB64)}`
          await navigator.clipboard.writeText(shareUrl)
          showToast({ icon: 'check', title: 'Share link copied', description: 'Link with decryption key copied to clipboard.' })
        } catch (err) {
          showToast({
            icon: 'x',
            title: 'Failed to copy link',
            description: err instanceof Error ? err.message : 'Something went wrong.',
            danger: true,
          })
        }
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
      case 'versions':
        if (!file.is_folder) setVersionFileId(fileId)
        break
      case 'download':
        handleFileDownload(file)
        break
      case 'trash':
        // Animate the row out, then delete
        setTrashingIds((prev) => new Set(prev).add(ctxMenu.fileId))
        setTimeout(async () => {
          try {
            await deleteFile(ctxMenu.fileId)
            showToast({ icon: 'trash', title: 'Moved to trash', description: ctxMenu.fileName })
            unindexFile(ctxMenu.fileId)
            fetchFiles()
          } catch (err) {
            showToast({ icon: 'trash', title: 'Failed to trash', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
          } finally {
            setTrashingIds((prev) => {
              const next = new Set(prev)
              next.delete(ctxMenu.fileId)
              return next
            })
          }
        }, 200)
        break
      default:
        break
    }
  }

  // ─── Sorted file list (needed before selection helpers) ──
  // Folders always come first, regardless of the chosen key — moving a
  // folder into the middle of the file list looks broken even when the
  // sort technically makes sense (e.g. by size).
  const sortedFiles = [...files].sort((a, b) => {
    if (a.is_folder && !b.is_folder) return -1
    if (!a.is_folder && b.is_folder) return 1

    switch (sortKey) {
      case 'name-asc':
        return displayName(a).localeCompare(displayName(b))
      case 'name-desc':
        return displayName(b).localeCompare(displayName(a))
      case 'modified-desc':
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      case 'modified-asc':
        return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      case 'size-desc':
        return b.size_bytes - a.size_bytes
      case 'size-asc':
        return a.size_bytes - b.size_bytes
      case 'type-asc': {
        // Group by mime_type, fall back to extension, then by name within
        // each group so similar files cluster.
        const ta = (a.mime_type || displayName(a).split('.').pop() || '').toLowerCase()
        const tb = (b.mime_type || displayName(b).split('.').pop() || '').toLowerCase()
        if (ta !== tb) return ta.localeCompare(tb)
        return displayName(a).localeCompare(displayName(b))
      }
    }
  })

  // Persist the user's choice; localStorage write is cheap and keyed
  // globally so it carries across folders within the same browser.
  useEffect(() => {
    try {
      localStorage.setItem('bb_drive_sort', JSON.stringify({ key: sortKey }))
    } catch { /* localStorage full or blocked — fine, in-memory is enough */ }
  }, [sortKey])

  // ─── Multi-select helpers ──────────────────────────────

  /** Clear selection whenever the folder changes. */
  useEffect(() => {
    setSelectedIds(new Set())
    lastClickedIdRef.current = null
  }, [currentParentId])

  function toggleSelection(fileId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
    lastClickedIdRef.current = fileId
  }

  function handleRowClick(file: DriveFile, e: React.MouseEvent) {
    // If shift key is held and we have a previous click target, do range select
    if (e.shiftKey && lastClickedIdRef.current) {
      const ids = sortedFiles.map((f) => f.id)
      const lastIdx = ids.indexOf(lastClickedIdRef.current)
      const curIdx = ids.indexOf(file.id)
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx)
        const end = Math.max(lastIdx, curIdx)
        const rangeIds = ids.slice(start, end + 1)
        setSelectedIds((prev) => {
          const next = new Set(prev)
          for (const id of rangeIds) next.add(id)
          return next
        })
        return
      }
    }

    // Ctrl/Cmd+click toggles individual without clearing
    if (e[modKey]) {
      toggleSelection(file.id)
      return
    }

    // Plain click on a checkbox area is handled by the checkbox itself.
    // Plain click on the row body: open file/folder (existing behavior).
    handleFileSelect(file)
  }

  function handleCheckboxClick(fileId: string, e: React.MouseEvent) {
    e.stopPropagation()

    if (e.shiftKey && lastClickedIdRef.current) {
      const ids = sortedFiles.map((f) => f.id)
      const lastIdx = ids.indexOf(lastClickedIdRef.current)
      const curIdx = ids.indexOf(fileId)
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx)
        const end = Math.max(lastIdx, curIdx)
        const rangeIds = ids.slice(start, end + 1)
        setSelectedIds((prev) => {
          const next = new Set(prev)
          for (const id of rangeIds) next.add(id)
          return next
        })
        lastClickedIdRef.current = fileId
        return
      }
    }

    toggleSelection(fileId)
  }

  function selectAll() {
    if (selectedIds.size === sortedFiles.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sortedFiles.map((f) => f.id)))
    }
  }

  function clearSelection() {
    setSelectedIds(new Set())
    lastClickedIdRef.current = null
  }

  const allSelected = sortedFiles.length > 0 && selectedIds.size === sortedFiles.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < sortedFiles.length

  // ─── Bulk action handlers ────────────────────────────

  async function handleBulkTrash() {
    const ids = Array.from(selectedIds)
    const count = ids.length
    // Animate all selected rows out
    setTrashingIds(new Set(ids))
    setTimeout(async () => {
      try {
        await Promise.all(ids.map((id) => deleteFile(id)))
        for (const id of ids) unindexFile(id)
        showToast({
          icon: 'trash',
          title: 'Moved to trash',
          description: `${count} file${count !== 1 ? 's' : ''} moved to trash`,
        })
        clearSelection()
        fetchFiles()
      } catch (err) {
        showToast({
          icon: 'trash',
          title: 'Failed to trash',
          description: err instanceof Error ? err.message : 'Something went wrong',
          danger: true,
        })
      } finally {
        setTrashingIds(new Set())
      }
    }, 200)
  }

  async function handleBulkMoveConfirm(destinationId: string | null, _mode: 'move' | 'copy') {
    const ids = Array.from(selectedIds)
    const count = ids.length
    try {
      await Promise.all(
        ids.map((id) => updateFile(id, { parent_id: destinationId ?? undefined })),
      )
      showToast({
        icon: 'folder',
        title: 'Files moved',
        description: `${count} file${count !== 1 ? 's' : ''} moved successfully.`,
      })
      clearSelection()
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Move failed',
        description: err instanceof Error ? err.message : 'Could not move files.',
        danger: true,
      })
    } finally {
      setBulkMoveOpen(false)
    }
  }

  function handleBulkShare() {
    if (selectedIds.size === 1) {
      setShareFileId(Array.from(selectedIds)[0])
    } else {
      showToast({
        icon: 'share',
        title: 'Select one file to share',
        description: 'Sharing multiple files at once is not supported yet.',
      })
    }
  }

  async function handleBulkDownload() {
    const filesToDownload = sortedFiles.filter(
      (f) => selectedIds.has(f.id) && !f.is_folder,
    )
    if (filesToDownload.length === 0) {
      showToast({
        icon: 'download',
        title: 'Nothing to download',
        description: 'Select at least one file (not folder) to download.',
      })
      return
    }
    for (const file of filesToDownload) {
      await handleFileDownload(file)
    }
  }

  // ─── Drag-and-drop handlers ────────────────────────────

  function handleDragStart(e: React.DragEvent, file: DriveFile) {
    // If the dragged file is part of a multi-selection, drag all selected files
    if (selectedIds.size > 1 && selectedIds.has(file.id)) {
      e.dataTransfer.setData('text/plain', JSON.stringify(Array.from(selectedIds)))
      e.dataTransfer.effectAllowed = 'move'
    } else {
      e.dataTransfer.setData('text/plain', JSON.stringify([file.id]))
      e.dataTransfer.effectAllowed = 'move'
    }
    setDraggedFileId(file.id)
  }

  function handleDragEnd() {
    setDraggedFileId(null)
    setDragOverFolderId(null)
  }

  function handleDragOver(e: React.DragEvent, folder: DriveFile) {
    if (!folder.is_folder) return
    // Prevent dropping a folder onto itself
    if (draggedFileId === folder.id) return
    // Prevent dropping selected items onto a folder that is itself selected
    if (selectedIds.size > 1 && selectedIds.has(draggedFileId ?? '') && selectedIds.has(folder.id)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverFolderId(folder.id)
  }

  function handleDragLeave(e: React.DragEvent, folderId: string) {
    // Only clear if we're actually leaving the folder row (not entering a child element)
    const relatedTarget = e.relatedTarget as HTMLElement | null
    const currentTarget = e.currentTarget as HTMLElement
    if (relatedTarget && currentTarget.contains(relatedTarget)) return
    if (dragOverFolderId === folderId) {
      setDragOverFolderId(null)
    }
  }

  async function handleDrop(e: React.DragEvent, targetFolder: DriveFile) {
    e.preventDefault()
    setDragOverFolderId(null)
    setDraggedFileId(null)

    if (!targetFolder.is_folder) return

    let fileIds: string[]
    try {
      fileIds = JSON.parse(e.dataTransfer.getData('text/plain')) as string[]
    } catch {
      return
    }

    // Filter out the target folder itself (can't drop a folder into itself)
    fileIds = fileIds.filter((id) => id !== targetFolder.id)
    if (fileIds.length === 0) return

    const targetName = displayName(targetFolder)

    try {
      await Promise.all(
        fileIds.map((id) => updateFile(id, { parent_id: targetFolder.id })),
      )
      if (fileIds.length === 1) {
        const movedFile = files.find((f) => f.id === fileIds[0])
        const movedName = movedFile ? displayName(movedFile) : 'File'
        showToast({
          icon: 'folder',
          title: `Moved ${movedName} to ${targetName}`,
        })
      } else {
        showToast({
          icon: 'folder',
          title: `Moved ${fileIds.length} items to ${targetName}`,
        })
      }
      clearSelection()
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Move failed',
        description: err instanceof Error ? err.message : 'Could not move files.',
        danger: true,
      })
    }
  }

  // ─── Keyboard shortcuts ─────────────────────────────

  useKeyboardShortcuts({
    onUpload: browse,
    onNewFolder: () => setFolderDialogOpen(true),
    onSelectAll: selectAll,
    onTrashSelected: () => {
      if (selectedIds.size > 0) handleBulkTrash()
    },
    onDownloadSelected: () => {
      if (selectedIds.size > 0) handleBulkDownload()
    },
    onSearch: () => navigate('/search'),
    onEscape: () => {
      if (selectedIds.size > 0) clearSelection()
    },
  })

  // Open shortcuts cheatsheet with '?'
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.key === '?' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        setShortcutsOpen(true)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  // ─── Derived data ───────────────────────────────────

  const moveFile = files.find((f) => f.id === moveFileId) ?? null
  const renameFile = files.find((f) => f.id === renameFileId) ?? null

  // The file currently shown in the share dialog
  const shareFile = files.find((f) => f.id === shareFileId) ?? null

  return (
    <DriveLayout>
      <HiddenInput />
      <HiddenFolderInput />
      <HiddenResumeInput />
      {/* Top bar */}
        <div className="px-3 md:px-5 py-2.5 border-b border-line flex items-center gap-2 md:gap-3 flex-wrap md:flex-nowrap">
          {/* Breadcrumbs */}
          <Breadcrumb items={breadcrumbs} onNavigate={handleBreadcrumbNav} />

          {/* Search */}
          <form
            className="ml-auto flex items-center gap-2 border border-line rounded-md bg-paper px-2.5 py-1.5 w-full md:w-[260px] order-last md:order-none"
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
          <div className="flex items-center gap-1.5 shrink-0">
            <BBButton size="sm" variant="amber" onClick={() => setFolderDialogOpen(true)} className="gap-1.5">
              <Icon name="plus" size={13} /> New
            </BBButton>
            <BBButton size="sm" onClick={browse} className="gap-1.5">
              <Icon name="upload" size={13} /> <span className="hidden sm:inline">Upload</span>
            </BBButton>
            <BBButton size="sm" onClick={browseFolder} className="hidden sm:inline-flex gap-1.5">
              <Icon name="folder" size={13} /> Upload folder
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

        {/* Resume banner */}
        {pausedUploads.length > 0 && (
          <div className="px-5 py-2.5 border-b border-amber/30 bg-amber-bg/40 flex items-center gap-3 text-sm">
            <Icon name="upload" size={14} className="text-amber-deep shrink-0" />
            <span className="text-ink">
              {pausedUploads.length === 1
                ? `1 upload paused`
                : `${pausedUploads.length} uploads paused`}
              {' -- '}
              <span className="text-ink-3">
                {pausedUploads.map((u) => u.fileName).join(', ')}
              </span>
            </span>
            <BBButton
              size="sm"
              variant="amber"
              className="ml-auto gap-1.5"
              onClick={browseResume}
            >
              Select file to resume
            </BBButton>
            <BBButton
              size="sm"
              variant="ghost"
              onClick={() => {
                for (const u of pausedUploads) {
                  removeUploadState(u.fileId)
                }
                setPausedUploads([])
              }}
            >
              Dismiss
            </BBButton>
          </div>
        )}

        {/* Pending shares banner */}
        {!pendingSharesDismissed && (incomingInviteCount > 0 || pendingApprovalCount > 0) && (
          <div className="px-5 py-2.5 border-b border-amber/30 border-l-4 border-l-amber bg-amber-bg flex flex-col gap-1.5 text-sm">
            {incomingInviteCount > 0 && (
              <div className="flex items-center gap-3">
                <Icon name="share" size={14} className="text-amber-deep shrink-0" />
                <span className="text-ink">
                  You have {incomingInviteCount} file share{incomingInviteCount !== 1 ? 's' : ''} waiting
                </span>
                <BBButton
                  size="sm"
                  variant="amber"
                  className="ml-auto gap-1.5"
                  onClick={() => navigate('/shared?tab=pending')}
                >
                  View
                </BBButton>
                {pendingApprovalCount === 0 && (
                  <button
                    onClick={() => setPendingSharesDismissed(true)}
                    className="p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            )}
            {pendingApprovalCount > 0 && (
              <div className="flex items-center gap-3">
                <Icon name="shield" size={14} className="text-amber-deep shrink-0" />
                <span className="text-ink">
                  {pendingApprovalCount} share{pendingApprovalCount !== 1 ? 's' : ''} waiting for your approval
                </span>
                <BBButton
                  size="sm"
                  variant="amber"
                  className="ml-auto gap-1.5"
                  onClick={() => navigate('/shared?tab=pending')}
                >
                  Review
                </BBButton>
                {incomingInviteCount === 0 && (
                  <button
                    onClick={() => setPendingSharesDismissed(true)}
                    className="p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            )}
            {incomingInviteCount > 0 && pendingApprovalCount > 0 && (
              <div className="flex justify-end -mt-1">
                <button
                  onClick={() => setPendingSharesDismissed(true)}
                  className="p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Sort + column header */}
        <div className="px-3 md:px-5 py-1.5 border-b border-line bg-paper-2 flex items-center justify-end relative">
          <button
            type="button"
            onClick={() => setSortMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-ink-2 rounded hover:bg-paper hover:text-ink transition-colors"
            aria-label={`Sort: ${sortLabel(sortKey)}`}
            aria-haspopup="menu"
            aria-expanded={sortMenuOpen}
          >
            <span className="text-ink-3">Sort:</span>
            <span className="font-medium">{sortLabel(sortKey)}</span>
            <Icon name="chevron-down" size={10} className="text-ink-3" />
          </button>
          {sortMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setSortMenuOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-3 md:right-5 top-full mt-0.5 z-40 bg-paper border border-line-2 rounded-md shadow-2 py-1 min-w-[200px]"
              >
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    role="menuitemradio"
                    aria-checked={opt.key === sortKey}
                    onClick={() => {
                      setSortKey(opt.key)
                      setSortMenuOpen(false)
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-paper-2 transition-colors ${
                      opt.key === sortKey ? 'text-ink font-medium' : 'text-ink-2'
                    }`}
                  >
                    <span className="w-3 inline-flex">
                      {opt.key === sortKey && <Icon name="check" size={10} />}
                    </span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="px-3 md:px-5 py-2 border-b border-line bg-paper-2 grid gap-2.5 md:gap-[14px] grid-cols-[20px_32px_1fr_40px] md:grid-cols-[20px_32px_1fr_110px_110px_100px_60px]">
          <span className="flex items-center justify-center">
            {sortedFiles.length > 0 && (
              <BBCheckbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={() => selectAll()}
              />
            )}
          </span>
          <span />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
          <span className="hidden md:inline text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
          <span className="hidden md:inline text-[10px] font-medium uppercase tracking-wider text-ink-3">Modified</span>
          <span className="hidden md:inline text-[10px] font-medium uppercase tracking-wider text-ink-3">Shared</span>
          <span />
        </div>

        {/* File list with upload zone */}
        <UploadZone onFiles={handleFilesSelected} onFolderFiles={handleFolderFilesSelected}>
          <div
            className="flex-1 overflow-y-auto"
            onClick={(e) => {
              // Click on empty area (not on a file row) clears selection
              if (e.target === e.currentTarget && selectedIds.size > 0) {
                clearSelection()
              }
            }}
          >
            {loading ? (
              <div>
                {Array.from({ length: 8 }, (_, i) => (
                  <FileRowSkeleton key={i} />
                ))}
              </div>
            ) : sortedFiles.length === 0 ? (
              currentParentId ? (
                /* Subfolder is empty */
                <div className="flex flex-col items-center justify-center h-full text-center py-20">
                  <div
                    className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
                    style={{
                      background: 'var(--color-amber-bg)',
                      border: '1.5px dashed var(--color-line-2)',
                    }}
                  >
                    <Icon name="folder" size={24} className="text-amber-deep" />
                  </div>
                  <h2 className="text-[15px] font-semibold text-ink mb-1.5">This folder is empty</h2>
                  <p className="text-[13px] text-ink-3 max-w-[340px] leading-relaxed mb-5">
                    Drag files here or use the buttons below to add content to this folder.
                  </p>
                  <div className="flex gap-2">
                    <BBButton size="md" variant="amber" onClick={browse} className="gap-1.5">
                      <Icon name="upload" size={13} /> Upload files
                    </BBButton>
                    <BBButton size="md" variant="ghost" onClick={() => setFolderDialogOpen(true)} className="gap-1.5">
                      <Icon name="folder" size={13} /> New folder
                    </BBButton>
                  </div>
                </div>
              ) : (
                /* Root drive is empty — first-time experience */
                <EmptyDrive
                  onUpload={browse}
                  onCreateFolder={() => setFolderDialogOpen(true)}
                />
              )
            ) : (
              sortedFiles.map((file) => {
                const name = displayName(file)
                const fileType = getFileType(name, file.is_folder)
                const isSelected = selectedIds.has(file.id)
                const isDragTarget = file.is_folder && dragOverFolderId === file.id
                const isDragging = draggedFileId === file.id
                const isTrashing = trashingIds.has(file.id)
                const isRecentUpload = recentlyUploaded.has(file.id)
                return (
                  <div
                    key={file.id}
                    draggable={!isTrashing}
                    onDragStart={(e) => handleDragStart(e, file)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, file)}
                    onDragLeave={(e) => handleDragLeave(e, file.id)}
                    onDrop={(e) => handleDrop(e, file)}
                    className={[
                      'file-row group transition-colors duration-150 cursor-pointer grid gap-2.5 md:gap-[14px] grid-cols-[20px_32px_1fr_40px] md:grid-cols-[20px_32px_1fr_110px_110px_100px_60px] px-3 md:px-5 py-[11px]',
                      isDragTarget
                        ? 'file-row--drag-target bg-amber-bg ring-2 ring-amber ring-inset'
                        : isSelected
                          ? 'file-row--selected bg-amber-bg/50'
                          : selectedFileId === file.id
                            ? 'bg-amber-bg/30'
                            : 'hover:bg-paper-2',
                      isDragging ? 'opacity-40' : '',
                      isTrashing ? 'trash-slide-out' : '',
                      isRecentUpload ? 'upload-glow' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={(e) => handleRowClick(file, e)}
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
                    <span
                      className={`flex items-center justify-center ${
                        isSelected ? '' : 'opacity-0 group-hover:opacity-100'
                      } transition-opacity`}
                      onClick={(e) => handleCheckboxClick(file.id, e)}
                    >
                      <BBCheckbox
                        checked={isSelected}
                        onChange={() => {/* handled by parent click */}}
                      />
                    </span>
                    <FileIcon type={fileType} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{name}</span>
                        {file.is_starred && (
                          <span className={`inline-flex text-amber-deep${starPulseId === file.id ? ' star-pulse' : ''}`}>
                            <Icon name="star" size={11} />
                          </span>
                        )}
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
                    <span className="hidden md:inline font-mono text-[13px] text-ink-3 tabular-nums self-center">
                      {file.is_folder ? '--' : formatBytes(file.size_bytes)}
                    </span>
                    <span className="hidden md:inline text-[13px] text-ink-3 self-center">
                      {timeAgo(file.updated_at)}
                    </span>
                    <div className="hidden md:block self-center">
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

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="px-3 md:px-5 py-2.5 border-t border-line bg-ink flex items-center gap-2 md:gap-3.5 animate-slide-in-up">
            <span className="text-sm font-medium text-paper">
              {selectedIds.size} selected
            </span>
            <button
              onClick={clearSelection}
              className="text-xs text-paper/60 hover:text-paper transition-colors cursor-pointer"
            >
              Clear
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <BBButton
                size="sm"
                variant="ghost"
                className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5"
                onClick={() => setBulkMoveOpen(true)}
              >
                <Icon name="folder" size={13} /> Move
              </BBButton>
              <BBButton
                size="sm"
                variant="ghost"
                className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5"
                onClick={handleBulkTrash}
              >
                <Icon name="trash" size={13} /> Trash
              </BBButton>
              <BBButton
                size="sm"
                variant="ghost"
                className="text-paper/80 hover:text-paper hover:bg-white/10 gap-1.5"
                onClick={handleBulkShare}
              >
                <Icon name="share" size={13} /> Share
              </BBButton>
              <BBButton
                size="sm"
                variant="amber"
                className="gap-1.5"
                onClick={handleBulkDownload}
              >
                <Icon name="download" size={13} /> Download
              </BBButton>
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="px-3 md:px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-2 md:gap-3.5 text-[11px] text-ink-3">
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
        onCancel={handleCancelUpload}
        onPause={handlePauseUpload}
        onResume={handleResumeUpload}
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
        onVersionHistory={() => {
          if (selectedFile && !selectedFile.is_folder) {
            setVersionFileId(selectedFile.id)
            setSelectedFileId(null)
          }
        }}
      />

      {shareFile && (
        <ShareDialog
          open={shareFileId !== null}
          onClose={() => setShareFileId(null)}
          fileId={shareFile.id}
          fileName={displayName(shareFile)}
          fileSize={shareFile.size_bytes}
          isFolder={shareFile.is_folder}
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

      {bulkMoveOpen && selectedIds.size > 0 && (
        <MoveModal
          open={bulkMoveOpen}
          onClose={() => setBulkMoveOpen(false)}
          items={sortedFiles
            .filter((f) => selectedIds.has(f.id))
            .map((f) => ({
              id: f.id,
              name: displayName(f),
              isFolder: f.is_folder,
            }))}
          mode="move"
          onConfirm={handleBulkMoveConfirm}
        />
      )}

      <RenameDialog
        open={renameFileId !== null}
        onClose={() => setRenameFileId(null)}
        currentName={renameFile ? displayName(renameFile) : ''}
        onRename={handleRenameConfirm}
      />

      {versionFileId && (
        <VersionHistory
          open={true}
          onClose={() => setVersionFileId(null)}
          fileId={versionFileId}
          fileName={(() => {
            const f = files.find((x) => x.id === versionFileId)
            return f ? displayName(f) : ''
          })()}
          onVersionRestored={fetchFiles}
        />
      )}

      <ShortcutsCheatsheet
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <WelcomeTour
        open={tourOpen}
        completedSteps={tourCompleted}
        onCompleteStep={(title) => {
          setTourCompleted((prev) => {
            const next = new Set(prev)
            next.add(title)
            setPreference('welcome_tour', {
              seen: false,
              completed: [...next],
            }).catch(() => {})
            return next
          })
          setTourOpen(false)
        }}
        onClose={() => {
          setTourOpen(false)
          setPreference('welcome_tour', {
            seen: true,
            completed: [...tourCompleted],
          }).catch(() => {})
        }}
      />
    </DriveLayout>
  )
}
