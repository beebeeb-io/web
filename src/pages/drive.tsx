import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { Breadcrumb } from '../components/breadcrumb'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { FileList } from '../components/file-list'
import { FileDetailsPanel, type FileDetailsMeta } from '../components/file-details-panel'
import { ShareDialog } from '../components/share-dialog'
import { MoveModal } from '../components/move-modal'
import { RenameDialog } from '../components/rename-dialog'
import { UploadZone, useBrowseFiles, useBrowseFolders, type FolderFile } from '../components/upload-zone'
import { UploadProgress, type UploadItem } from '../components/upload-progress'
import { NewFolderDialog } from '../components/new-folder-dialog'
import { VersionHistory } from '../components/version-history'
import { NotificationInbox, useNotifications } from '../components/notification-inbox'
import { WelcomeTour } from '../components/welcome-tour'
import { getPreference, setPreference } from '../lib/api'
import { useToast } from '../components/toast'
import { useWsEvent } from '../lib/ws-context'
import { useKeys } from '../lib/key-context'
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts'
import {
  listFiles,
  createFolder,
  toggleStar,
  updateFile,
  deleteFile,
  getFile,
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
import { encryptFilename, toBase64 } from '../lib/crypto'
import { useSearchIndex } from '../hooks/use-search-index'
import { EmptyDrive } from '../components/empty-states/empty-drive'
import { formatBytes } from '../lib/format'

// ─── Drive component ────────────────────────────────
// Folders are always grouped before files; the chosen key only orders
// within each group. localStorage key: 'bb_drive_sort'.

export function Drive() {
  const { getFileKey, isUnlocked, cryptoReady, cryptoError } = useKeys()
  const { indexFile, unindexFile } = useSearchIndex()
  const location = useLocation()
  const navigate = useNavigate()
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
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
  const [tourOpen, setTourOpen] = useState(false)
  const [tourCompleted, setTourCompleted] = useState<Set<string>>(new Set())
  const [pausedUploads, setPausedUploads] = useState<UploadState[]>([])

  // ─── Pending shares state ────────────────────────────
  const [incomingInviteCount, setIncomingInviteCount] = useState(0)
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0)
  const [pendingSharesDismissed, setPendingSharesDismissed] = useState(false)

  // ─── Bulk move state ─────────────────────────────────
  const [bulkMoveIds, setBulkMoveIds] = useState<string[]>([])
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)

  // ─── Micro-interaction state ───────────────────────
  const [recentlyUploaded, setRecentlyUploaded] = useState<Set<string>>(new Set())
  const [trashingIds, setTrashingIds] = useState<Set<string>>(new Set())
  const [starPulseId, setStarPulseId] = useState<string | null>(null)

  // ─── External selection + decrypted names (for keyboard shortcuts + dialogs) ─
  const [externalSelectedIds, setExternalSelectedIds] = useState<Set<string>>(new Set())
  const [externalDecryptedNames, setExternalDecryptedNames] = useState<Record<string, string>>({})

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

  // Warn before leaving if uploads are still in flight
  useEffect(() => {
    const hasActive = uploads.some((u) => u.stage !== 'Done' && u.stage !== 'Error')
    if (!hasActive) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [uploads])

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

    const newUploads: UploadItem[] = selectedFiles.map((f, i) => ({
      id: `upload-${Date.now()}-${i}`,
      name: f.name,
      size: f.size,
      progress: 0,
      stage: 'Queued' as const,
    }))
    setUploads((prev) => [...prev, ...newUploads])

    selectedFiles.forEach((file, i) => {
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

  function displayName(file: DriveFile): string {
    return externalDecryptedNames[file.id] ?? file.name_encrypted
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
    setBreadcrumbs((prev) => [
      ...prev,
      { id: folder.id, name: externalDecryptedNames[folder.id] ?? folder.name_encrypted },
    ])
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
      region: undefined,
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
      await updateFile(moveFileId, { parent_id: destinationId })
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

  // ─── File action handler (from FileList context menu + double-click) ──

  async function handleFileAction(action: string, file: DriveFile) {
    switch (action) {
      case 'open':
        if (file.is_folder) handleFolderOpen(file)
        else setSelectedFileId(file.id)
        break
      case 'share':
        setShareFileId(file.id)
        break
      case 'copy-link':
        try {
          if (!isUnlocked || !cryptoReady) {
            showToast({ icon: 'lock', title: 'Vault is locked', description: 'Unlock the vault to copy share links.', danger: true })
            return
          }
          const shares = await listMyShares()
          const existingShare = shares.find((s) => s.file_id === file.id)
          if (!existingShare) {
            showToast({ icon: 'link', title: 'No share link exists', description: 'Share the file first to create a link.' })
            return
          }
          const fileKey = await getFileKey(file.id)
          const keyB64 = toBase64(fileKey)
          const shareUrl = `${window.location.origin}/s/${existingShare.token}#key=${encodeURIComponent(keyB64)}`
          await navigator.clipboard.writeText(shareUrl)
          showToast({ icon: 'check', title: 'Share link copied', description: 'Link with decryption key copied to clipboard.' })
        } catch (err) {
          showToast({ icon: 'x', title: 'Failed to copy link', description: err instanceof Error ? err.message : 'Something went wrong.', danger: true })
        }
        break
      case 'move':
        setMoveFileId(file.id)
        break
      case 'rename':
        if (!isUnlocked || !cryptoReady) {
          showToast({ icon: 'lock', title: 'Vault is locked', description: 'Unlock the vault before renaming files.', danger: true })
          return
        }
        setRenameFileId(file.id)
        break
      case 'star':
        handleToggleStar(file.id)
        break
      case 'versions':
        if (!file.is_folder) setVersionFileId(file.id)
        break
      case 'download':
        handleFileDownload(file)
        break
      case 'trash': {
        const trashName = displayName(file)
        setTrashingIds((prev) => new Set(prev).add(file.id))
        setTimeout(async () => {
          try {
            await deleteFile(file.id)
            showToast({ icon: 'trash', title: 'Moved to trash', description: trashName })
            unindexFile(file.id)
            fetchFiles()
          } catch (err) {
            showToast({ icon: 'trash', title: 'Failed to trash', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
          } finally {
            setTrashingIds((prev) => { const next = new Set(prev); next.delete(file.id); return next })
          }
        }, 200)
        break
      }
    }
  }

  // ─── Drop to folder handler ────────────────────────

  async function handleDropToFolder(ids: string[], targetFolder: DriveFile) {
    const targetName = displayName(targetFolder)
    try {
      await Promise.all(ids.map((id) => updateFile(id, { parent_id: targetFolder.id })))
      if (ids.length === 1) {
        const movedFile = files.find((f) => f.id === ids[0])
        const movedName = movedFile ? displayName(movedFile) : 'File'
        showToast({ icon: 'folder', title: `Moved ${movedName} to ${targetName}` })
      } else {
        showToast({ icon: 'folder', title: `Moved ${ids.length} items to ${targetName}` })
      }
      fetchFiles()
    } catch (err) {
      showToast({ icon: 'x', title: 'Move failed', description: err instanceof Error ? err.message : 'Could not move files.', danger: true })
    }
  }

  // Listen for sidebar pinned-folder drops dispatched from quick-access.tsx.
  // Sidebar uses dnd-kit for sortable reordering, so it can't share file-list's
  // native HTML5 dnd state — instead it fires a window event with file ids and
  // a target folder id, and we look up the folder + run the same move flow.
  useEffect(() => {
    function onDrop(e: Event) {
      const ce = e as CustomEvent<{ folderId: string; fileIds: string[] }>
      const detail = ce.detail
      if (!detail?.folderId || !Array.isArray(detail.fileIds)) return
      const target = files.find((f) => f.id === detail.folderId)
      if (target) {
        handleDropToFolder(detail.fileIds, target)
        return
      }
      // Pinned folder may not be in the current `files` list — fetch it.
      getFile(detail.folderId)
        .then((folder) => handleDropToFolder(detail.fileIds, folder))
        .catch(() => {
          showToast({ icon: 'x', title: 'Move failed', description: 'Could not load target folder.', danger: true })
        })
    }
    window.addEventListener('beebeeb:drop-into-folder', onDrop)
    return () => window.removeEventListener('beebeeb:drop-into-folder', onDrop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  // ─── Bulk action handlers ────────────────────────────

  async function handleBulkTrash(ids: string[]) {
    const count = ids.length
    setTrashingIds(new Set(ids))
    return new Promise<void>((resolve) => {
      setTimeout(async () => {
        try {
          await Promise.all(ids.map((id) => deleteFile(id)))
          for (const id of ids) unindexFile(id)
          showToast({ icon: 'trash', title: 'Moved to trash', description: `${count} file${count !== 1 ? 's' : ''} moved to trash` })
          fetchFiles()
        } catch (err) {
          showToast({ icon: 'trash', title: 'Failed to trash', description: err instanceof Error ? err.message : 'Something went wrong', danger: true })
        } finally {
          setTrashingIds(new Set())
          resolve()
        }
      }, 200)
    })
  }

  async function handleBulkMoveConfirm(destinationId: string | null, _mode: 'move' | 'copy') {
    const ids = bulkMoveIds
    const count = ids.length
    try {
      await Promise.all(ids.map((id) => updateFile(id, { parent_id: destinationId })))
      showToast({ icon: 'folder', title: 'Files moved', description: `${count} file${count !== 1 ? 's' : ''} moved successfully.` })
      fetchFiles()
    } catch (err) {
      showToast({ icon: 'x', title: 'Move failed', description: err instanceof Error ? err.message : 'Could not move files.', danger: true })
    } finally {
      setBulkMoveOpen(false)
      setBulkMoveIds([])
    }
  }

  function handleBulkShare(ids: string[]) {
    if (ids.length === 1) {
      setShareFileId(ids[0])
    } else {
      showToast({ icon: 'share', title: 'Select one file to share', description: 'Sharing multiple files at once is not supported yet.' })
    }
  }

  async function handleBulkDownload(ids: string[]) {
    const filesToDownload = files.filter((f) => ids.includes(f.id) && !f.is_folder)
    if (filesToDownload.length === 0) {
      showToast({ icon: 'download', title: 'Nothing to download', description: 'Select at least one file (not folder) to download.' })
      return
    }
    for (const file of filesToDownload) {
      await handleFileDownload(file)
    }
  }

  // ─── Keyboard shortcuts ─────────────────────────────

  useKeyboardShortcuts({
    onUpload: browse,
    onNewFolder: () => setFolderDialogOpen(true),
    onSelectAll: () => {}, // handled inside FileList
    onTrashSelected: () => {
      if (externalSelectedIds.size > 0) handleBulkTrash(Array.from(externalSelectedIds))
    },
    onDownloadSelected: () => {
      if (externalSelectedIds.size > 0) handleBulkDownload(Array.from(externalSelectedIds))
    },
    onSearch: () => {
      const input = document.querySelector<HTMLInputElement>('[data-search-input]')
      if (input) {
        input.focus()
        input.select()
      } else {
        navigate('/search')
      }
    },
    // onShortcuts is wired globally in app.tsx (GlobalShortcuts).
    onOpenSelected: () => {
      // Prefer the active selection set; fall back to the inspector's pinned file.
      const ids = externalSelectedIds.size > 0
        ? Array.from(externalSelectedIds)
        : selectedFileId ? [selectedFileId] : []
      if (ids.length !== 1) return
      const file = files.find((f) => f.id === ids[0])
      if (!file) return
      if (file.is_folder) handleFolderOpen(file)
      else setSelectedFileId(file.id)
    },
    onEscape: () => {}, // handled inside FileList
  })

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
              data-search-input
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

        {/* File list with upload zone */}
        <UploadZone onFiles={handleFilesSelected} onFolderFiles={handleFolderFilesSelected}>
          <FileList
            files={files}
            loading={loading}
            emptyState={
              currentParentId ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-20">
                  <div
                    className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
                    style={{ background: 'var(--color-amber-bg)', border: '1.5px dashed var(--color-line-2)' }}
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
                <EmptyDrive onUpload={browse} onCreateFolder={() => setFolderDialogOpen(true)} />
              )
            }
            onNavigateFolder={handleFolderOpen}
            selectedFileId={selectedFileId}
            onSelectFile={(file) => file && setSelectedFileId(file.id)}
            onSelectionChange={setExternalSelectedIds}
            onDecryptedNamesChange={setExternalDecryptedNames}
            onFileAction={handleFileAction}
            onDropToFolder={handleDropToFolder}
            onBulkTrash={handleBulkTrash}
            onBulkMove={(ids) => { setBulkMoveIds(ids); setBulkMoveOpen(true) }}
            onBulkShare={handleBulkShare}
            onBulkDownload={handleBulkDownload}
            trashingIds={trashingIds}
            starPulseId={starPulseId}
            recentlyUploadedIds={recentlyUploaded}
          />
        </UploadZone>

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

      {bulkMoveOpen && bulkMoveIds.length > 0 && (
        <MoveModal
          open={bulkMoveOpen}
          onClose={() => { setBulkMoveOpen(false); setBulkMoveIds([]) }}
          items={files
            .filter((f) => bulkMoveIds.includes(f.id))
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
