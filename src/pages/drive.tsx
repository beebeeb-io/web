import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { Breadcrumb } from '../components/breadcrumb'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { FileList } from '../components/file-list'
import { FileDetailsPanel, type FileDetailsMeta } from '../components/file-details-panel'
import { TrustDetailsPanel, type TrustFile } from '../components/trust-details-panel'
import { ShareDialog } from '../components/share-dialog'
import { ShareInfoModal } from '../components/share-info-modal'
import { MoveModal } from '../components/move-modal'
import { RenameDialog } from '../components/rename-dialog'
import { UploadZone, useBrowseFiles, useBrowseFolders, type FolderFile } from '../components/upload-zone'
import type { UploadItem } from '../components/upload-progress'
import { UploadCards } from '../components/upload-progress-card'
import { NewFolderDialog } from '../components/new-folder-dialog'
import { VersionHistory } from '../components/version-history'
import { DuplicateFileDialog, getUniqueName, type ConflictItem } from '../components/duplicate-file-dialog'
import { NotificationInbox, useNotifications } from '../components/notification-inbox'
import { WelcomeTour } from '../components/welcome-tour'
import { OnboardingGuide } from '../components/onboarding-guide'
import { useOnboarding } from '../lib/onboarding-context'
import { getPreference, setPreference } from '../lib/api'
import { useToast } from '../components/toast'
import { useWsEvent } from '../lib/ws-context'
import { useSync } from '../lib/sync-context'
import { useKeys } from '../lib/key-context'
import { useKeyboardShortcuts, isMac } from '../hooks/use-keyboard-shortcuts'
import { useFrozen } from '../hooks/use-frozen'
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
  type MyShare,
  type StorageUsage,
} from '../lib/api'
import { getRemainingBytes } from '../components/quota-warning'
import {
  UpgradeNudgeModal,
  StorageFullBanner,
  shouldShowUpgradeNudge,
} from '../components/upgrade-nudge-modal'
import { encryptedUpload } from '../lib/encrypted-upload'
import { encryptedDownload } from '../lib/encrypted-download'
import { downloadAsZip, ZIP_SIZE_WARNING_BYTES } from '../lib/bulk-download'
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
  const { isFrozen } = useFrozen()
  const { getFileKey, isUnlocked, cryptoReady, cryptoError } = useKeys()
  const { indexFile, unindexFile } = useSearchIndex()
  const sync = useSync()
  const { refresh: refreshOnboarding } = useOnboarding()
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
  // Cache the File object per upload-id so we can re-invoke the encrypted
  // upload pipeline when the user clicks Retry on a failed item.
  const uploadFilesRef = useRef<Map<string, File>>(new Map())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [syncedAgo, setSyncedAgo] = useState(0)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [shareFileId, setShareFileId] = useState<string | null>(null)
  // File whose Manage-shares modal is currently open.
  const [manageSharesFileId, setManageSharesFileId] = useState<string | null>(null)
  // Active shares owned by the current user, used to flag rows in the file
  // list and seed the ShareInfoModal so it doesn't have to refetch from
  // scratch every time it opens.
  const [myShares, setMyShares] = useState<MyShare[]>([])
  const [moveFileId, setMoveFileId] = useState<string | null>(null)
  const [renameFileId, setRenameFileId] = useState<string | null>(null)
  const [versionFileId, setVersionFileId] = useState<string | null>(null)
  const [trustFileId, setTrustFileId] = useState<string | null>(null)
  const [tourOpen, setTourOpen] = useState(false)
  const [tourCompleted, setTourCompleted] = useState<Set<string>>(new Set())
  const [pausedUploads, setPausedUploads] = useState<UploadState[]>([])

  // Track the last uploaded file id for the onboarding guide's first-share step.
  const [lastUploadedFileId, setLastUploadedFileId] = useState<string | null>(null)

  // ─── Pending shares state ────────────────────────────
  const [incomingInviteCount, setIncomingInviteCount] = useState(0)
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0)
  const [bulkZipProgress, setBulkZipProgress] = useState<{ done: number; total: number } | null>(null)
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
  const [externalDecryptedNames, setExternalDecryptedNames] = useState<Record<string, string | null>>({})

  // ─── Duplicate-file conflict dialog ─────────────────
  interface PendingConflictUpload {
    conflicts: ConflictItem[]
    nonConflicting: File[]
    allFiles: File[]
  }
  const [pendingConflict, setPendingConflict] = useState<PendingConflictUpload | null>(null)

  // ─── Storage quota state ─────────────────────────
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [showUpgradeNudge, setShowUpgradeNudge] = useState(false)

  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? undefined

  const fetchFiles = useCallback(async () => {
    // Guard: never fetch (and therefore never trigger decryption) until the vault
    // is unlocked. The sync engine and API can return data at any time but the
    // FileList cannot decrypt filenames without the master key.
    if (!isUnlocked) return
    setLoading(true)
    try {
      const trashed = location.pathname === '/trash'
      // Prefer the sync engine's in-memory tree once it has booted.
      // The legacy /api/v1/files listing remains the fallback for users
      // on a server that doesn't yet expose /sync/snapshot.
      if (sync.ready) {
        const nodes = sync
          .children(currentParentId ?? null)
          .filter((n) => Boolean(n.is_trashed) === trashed)
          .map<DriveFile>((n) => ({
            id: n.id,
            name_encrypted: n.name_encrypted,
            mime_type: n.mime_type ?? '',
            size_bytes: n.size_bytes,
            is_folder: n.is_folder,
            parent_id: n.parent_id,
            chunk_count: n.chunk_count ?? 1,
            is_starred: n.is_starred,
            has_thumbnail: n.has_thumbnail,
            version_number: n.version_number,
            created_at: n.created_at,
            updated_at: n.updated_at,
          }))
        setFiles(nodes)
      } else {
        const data = await listFiles(currentParentId ?? undefined, trashed)
        setFiles(data)
      }
      setSyncedAgo(0)
    } catch (err) {
      console.error('[Drive] Failed to load files:', err)
      showToast({ icon: 'x', title: 'Failed to load files', danger: true })
      setFiles([])
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParentId, location.pathname, sync.ready, isUnlocked])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // ─── My active shares ──────────────────────────────
  // Loaded once per drive session and refreshed when the user creates,
  // revokes, or deletes a share. Powers the "shared" indicator on file
  // rows and seeds the ShareInfoModal so it doesn't have to flash a
  // loading state every time it opens.
  const fetchMyShares = useCallback(async () => {
    if (!isUnlocked) return
    try {
      const shares = await listMyShares()
      setMyShares(shares)
    } catch {
      // Non-fatal — the file list still works without share indicators.
    }
  }, [isUnlocked])

  useEffect(() => {
    fetchMyShares()
  }, [fetchMyShares])

  // Re-derive when the sync engine pushes ops affecting the visible folder.
  useEffect(() => {
    if (!sync.ready) return
    fetchFiles()
    // Run on every tree mutation surfaced by the sync context.
  }, [sync.treeVersion, sync.ready, fetchFiles])

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
    getStorageUsage().then(usage => {
      setStorageUsage(usage)
      // Show upgrade nudge once per session when approaching quota limit
      if (shouldShowUpgradeNudge(usage.used_bytes, usage.plan_limit_bytes)) {
        setShowUpgradeNudge(true)
      }
    }).catch(() => {})
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

  // Build a map of lowercase decrypted name → DriveFile for conflict detection.
  function buildNameToFileMap(): Map<string, DriveFile> {
    const map = new Map<string, DriveFile>()
    for (const file of files) {
      if (file.is_folder) continue
      const name = externalDecryptedNames[file.id]
      if (name) map.set(name.toLowerCase(), file)
    }
    return map
  }

  /**
   * Queue a resolved list of uploads.
   * Each item carries the File to upload, an optional replaceFileId for the
   * Replace path, and the final name to use (may differ from file.name for
   * the "Keep both" path where we rename with a suffix).
   */
  function queueResolvedUploads(
    resolved: Array<{ file: File; replaceFileId?: string; finalName?: string }>,
  ) {
    if (resolved.length === 0) return

    const newUploads: UploadItem[] = resolved.map((r, i) => ({
      id: `upload-${Date.now()}-${i}`,
      name: r.finalName ?? r.file.name,
      size: r.file.size,
      progress: 0,
      stage: 'Queued' as const,
    }))
    setUploads((prev) => [...prev, ...newUploads])

    resolved.forEach((r, i) => {
      const uploadId = newUploads[i].id
      // For "Keep both", create a renamed File object so encryptedUpload
      // encrypts the new name (not the original).
      const fileToUpload =
        r.finalName && r.finalName !== r.file.name
          ? new File([r.file], r.finalName, { type: r.file.type })
          : r.file
      uploadFilesRef.current.set(uploadId, fileToUpload)
      doEncryptedUpload(uploadId, fileToUpload, r.replaceFileId)
    })
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

    // ─── Conflict detection ───────────────────────
    // Only check when the vault is unlocked and we have decrypted names.
    if (isUnlocked && Object.keys(externalDecryptedNames).length > 0) {
      const nameToFile = buildNameToFileMap()
      const conflicts: ConflictItem[] = []
      const nonConflicting: File[] = []

      for (const f of selectedFiles) {
        const existing = nameToFile.get(f.name.toLowerCase())
        if (existing) {
          const existingName = externalDecryptedNames[existing.id] ?? f.name
          conflicts.push({
            newFile: f,
            existingFileId: existing.id,
            existingName: existingName ?? f.name,
          })
        } else {
          nonConflicting.push(f)
        }
      }

      if (conflicts.length > 0) {
        // Pause and show the conflict dialog; uploads are queued on resolution.
        setPendingConflict({ conflicts, nonConflicting, allFiles: selectedFiles })
        return
      }
    }

    // ─── No conflicts — queue immediately ─────────
    queueResolvedUploads(selectedFiles.map((f) => ({ file: f })))
  }

  // ─── Conflict dialog resolution ──────────────────

  function handleConflictReplace() {
    if (!pendingConflict) return
    const { conflicts, nonConflicting } = pendingConflict
    setPendingConflict(null)
    queueResolvedUploads([
      ...nonConflicting.map((f) => ({ file: f })),
      ...conflicts.map((c) => ({ file: c.newFile, replaceFileId: c.existingFileId })),
    ])
  }

  function handleConflictKeepBoth() {
    if (!pendingConflict) return
    const { conflicts, nonConflicting } = pendingConflict
    setPendingConflict(null)

    // Build the set of existing lowercase names for suffix generation.
    const existingNames = new Set(
      files
        .filter((f) => !f.is_folder)
        .map((f) => externalDecryptedNames[f.id])
        .filter(Boolean)
        .map((n) => (n as string).toLowerCase()),
    )
    // Track names already assigned in this batch to prevent duplicates.
    const usedInBatch = new Set<string>()

    const resolved = [
      ...nonConflicting.map((f) => ({ file: f })),
      ...conflicts.map((c) => {
        const finalName = getUniqueName(c.newFile.name, existingNames, usedInBatch)
        usedInBatch.add(finalName.toLowerCase())
        return { file: c.newFile, finalName }
      }),
    ]
    queueResolvedUploads(resolved)
  }

  function handleConflictCancel() {
    setPendingConflict(null)
  }

  /**
   * Upload a single file.
   *
   * @param replaceFileId  When set (Replace mode), uses the EXISTING file's ID
   *   so the server creates a new version of that file. The key is derived from
   *   this ID — same key as the original, so old versions remain decryptable.
   *   When undefined (normal / Keep-both mode), generates a fresh UUID.
   */
  async function doEncryptedUpload(uploadId: string, file: File, replaceFileId?: string) {
    if (!isUnlocked || !cryptoReady) {
      showToast({
        icon: 'lock',
        title: 'Vault is locked',
        description: 'Log in again to unlock encryption before uploading.',
        danger: true,
      })
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
      uploadFilesRef.current.delete(uploadId)
      return
    }

    // Replace mode uses the existing file's ID for versioning;
    // normal mode generates a new UUID.
    const fileId = replaceFileId ?? crypto.randomUUID()
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
      uploadFilesRef.current.delete(uploadId)
      // Remove from paused list if this was a resume
      setPausedUploads((prev) => prev.filter((u) => u.fileId !== fileId))
      setLastUploadedFileId(fileId)
      showToast({ icon: 'check', title: 'Uploaded', description: file.name })
      // Refresh storage usage so quota warning updates
      refreshUsage()
      // Advance onboarding state (first_upload_done might now be true)
      void refreshOnboarding()
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
        // Cancelled by user — silently remove from list, drop the cached File
        setUploads((prev) => prev.filter((u) => u.id !== uploadId))
        uploadFilesRef.current.delete(uploadId)
        return
      }
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong'
      showToast({
        icon: 'upload',
        title: 'Upload failed',
        description: errorMessage,
        danger: true,
      })
      // Mark the card as Error so the user sees it failed and can hit Retry.
      // Keep the cached File in uploadFilesRef so handleRetryUpload can re-run
      // the encrypted-upload pipeline without the user re-picking the file.
      setUploads((prev) =>
        prev.map((u) =>
          u.id === uploadId
            ? { ...u, stage: 'Error' as const, progress: 0, errorMessage }
            : u,
        ),
      )
    }
  }

  function handleRetryUpload(uploadId: string) {
    const file = uploadFilesRef.current.get(uploadId)
    if (!file) {
      // Cached File was lost (e.g. page reload between failure and retry click).
      // Just drop the stale card — the user will need to re-pick the file.
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
      return
    }
    // Reset the card to Queued so the existing UI re-engages (prevents a flash
    // of "Uploaded 0%" if doEncryptedUpload's progress callback hasn't fired
    // yet by the time the user looks at the card).
    setUploads((prev) =>
      prev.map((u) =>
        u.id === uploadId
          ? {
              ...u,
              stage: 'Queued' as const,
              progress: 0,
              bytesUploaded: undefined,
              startedAt: undefined,
              errorMessage: undefined,
            }
          : u,
      ),
    )
    void doEncryptedUpload(uploadId, file)
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
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong'
      showToast({
        icon: 'upload',
        title: 'Folder upload failed',
        description: errorMessage,
        danger: true,
      })
      // Folder uploads don't support per-file retry yet (we'd need to remember
      // which subfile failed and how far it got). Surface as Error so the user
      // sees it failed; the dismiss (×) button removes the card.
      setUploads((prev) =>
        prev.map((u) =>
          u.id === foldUploadId
            ? { ...u, stage: 'Error' as const, progress: 0, errorMessage }
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
        file.mime_type ?? undefined,
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
    const cached = externalDecryptedNames[file.id]
    if (cached === undefined) return '' // pending — caller should not use this until truthy
    return cached ?? 'Encrypted file'   // null = failed
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
      { id: folder.id, name: externalDecryptedNames[folder.id] ?? 'Folder' },
    ])
  }

  function handleBreadcrumbNav(index: number) {
    setBreadcrumbs((prev) => prev.slice(0, index + 1))
  }

  function handleCancelUpload(uploadId: string) {
    const controller = uploadAbortRef.current.get(uploadId)
    if (controller) {
      controller.abort()
    } else {
      // For queued/error items not currently in flight, remove the card and
      // drop the cached File — there's nothing to cancel via signal.
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
    }
    uploadFilesRef.current.delete(uploadId)
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
      case 'manage-shares':
      // Legacy action id kept for any callers still passing 'copy-link'
      // before the context-menu rename — funnels into the same modal.
      case 'copy-link':
        setManageSharesFileId(file.id)
        // Refresh the share list so the modal opens with current data.
        fetchMyShares()
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
      case 'unstar':
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
    const selectedItems = files.filter((f) => ids.includes(f.id))
    if (selectedItems.length === 0) {
      showToast({ icon: 'download', title: 'Nothing to download', description: 'Select at least one file to download.' })
      return
    }

    // Single non-folder file → regular download (no zip overhead)
    if (selectedItems.length === 1 && !selectedItems[0].is_folder) {
      await handleFileDownload(selectedItems[0])
      return
    }

    // Check size warning before starting
    const nonFolderItems = selectedItems.filter(f => !f.is_folder)
    const estimatedBytes = nonFolderItems.reduce((s, f) => s + (f.size_bytes ?? 0), 0)
    if (estimatedBytes > ZIP_SIZE_WARNING_BYTES) {
      showToast({
        icon: 'cloud',
        title: 'Large download',
        description: 'Total size exceeds 1 GB — this may take a while.',
      })
    }

    // Multi-file or folder → ZIP
    const total = selectedItems.length
    showToast({ icon: 'download', title: `Creating ZIP…`, description: `Downloading ${total} item${total !== 1 ? 's' : ''}` })
    setBulkZipProgress({ done: 0, total })

    try {
      const { errorCount } = await downloadAsZip(
        selectedItems,
        getFileKey,
        {
          onProgress: (done, tot) => setBulkZipProgress({ done, total: tot }),
          zipFilename: `beebeeb-files-${new Date().toISOString().slice(0, 10)}.zip`,
        },
      )
      if (errorCount > 0) {
        showToast({
          icon: 'download',
          title: 'ZIP downloaded with errors',
          description: `${errorCount} file${errorCount !== 1 ? 's' : ''} failed — see _errors.txt inside the zip.`,
          danger: true,
        })
      } else {
        showToast({ icon: 'download', title: 'ZIP downloaded', description: `${total} item${total !== 1 ? 's' : ''} packaged successfully.` })
      }
    } catch (err) {
      showToast({
        icon: 'download',
        title: 'ZIP failed',
        description: err instanceof Error ? err.message : 'Could not create the archive.',
        danger: true,
      })
    } finally {
      setBulkZipProgress(null)
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
      if (searchInputRef.current) {
        searchInputRef.current.focus()
        searchInputRef.current.select()
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

  // Cmd-K / Ctrl-K focuses the inline search bar. Uses capture phase so it
  // fires before the global GlobalShortcuts handler (which would open the
  // command palette), and stopPropagation prevents that from also triggering.
  useEffect(() => {
    function handleSearchKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      // Don't hijack while the user is already typing somewhere else.
      if (
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) &&
        target !== searchInputRef.current
      ) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        // stopImmediatePropagation so GlobalShortcuts' bubble listener
        // (document-level, same element) doesn't also open the command palette.
        e.stopImmediatePropagation()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    document.addEventListener('keydown', handleSearchKey, { capture: true })
    return () => document.removeEventListener('keydown', handleSearchKey, { capture: true })
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
            role="search"
            aria-label="Search vault"
            className="ml-auto flex items-center gap-2 border border-line rounded-md bg-paper px-2.5 py-1 w-full md:w-[260px] order-last md:order-none"
            onSubmit={(e) => {
              e.preventDefault()
              if (searchInputRef.current?.value.trim())
                navigate(`/search?q=${encodeURIComponent(searchInputRef.current.value.trim())}`)
            }}
          >
            <Icon name="search" size={13} className="text-ink-4 shrink-0" />
            <input
              ref={searchInputRef}
              data-search-input
              aria-label="Search files and folders"
              placeholder="Search files and folders..."
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
            />
            <kbd className="hidden sm:inline-flex items-center self-center gap-0.5 px-1.5 py-[3px] text-[10px] leading-none font-mono text-ink-4 bg-paper-2 border border-line rounded shrink-0">
              {isMac ? <><span className="text-[11px] leading-none">⌘</span>K</> : 'Ctrl+K'}
            </kbd>
          </form>

          {/* New + Upload */}
          <div className="flex items-center gap-1.5 shrink-0">
            <BBButton size="sm" variant="amber" onClick={() => setFolderDialogOpen(true)} className="gap-1.5" disabled={isFrozen} title={isFrozen ? 'Account is frozen' : undefined}>
              <Icon name="plus" size={13} /> New folder
            </BBButton>
            <BBButton size="sm" onClick={browse} className="gap-1.5" aria-label="Upload files" disabled={isFrozen} title={isFrozen ? 'Account is frozen' : undefined}>
              <Icon name="upload" size={13} /> <span className="hidden sm:inline" aria-hidden="true">Upload</span>
            </BBButton>
            <BBButton size="sm" onClick={browseFolder} className="hidden sm:inline-flex gap-1.5" disabled={isFrozen} title={isFrozen ? 'Account is frozen' : undefined}>
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

        {/* Storage-full banner — always visible when quota is hit */}
        {storageUsage &&
          storageUsage.plan_limit_bytes > 0 &&
          storageUsage.used_bytes >= storageUsage.plan_limit_bytes && (
          <StorageFullBanner
            currentPlan={storageUsage.plan_name}
            onUpgrade={() => setShowUpgradeNudge(true)}
          />
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
                    onClick={() => setPendingSharesDismissed(true)} aria-label="Dismiss notification" type="button"
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
                    onClick={() => setPendingSharesDismissed(true)} aria-label="Dismiss notification" type="button"
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
                  onClick={() => setPendingSharesDismissed(true)} aria-label="Dismiss notification" type="button"
                  className="p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Onboarding guide — context-driven bottom chip (spec 024 §1.6-1.9) */}
        {currentParentId === undefined && location.pathname === '/' && (
          <OnboardingGuide
            onPickFile={browse}
            onOpenShare={(id) => id && setShareFileId(id)}
            lastUploadedFileId={lastUploadedFileId}
          />
        )}

        {/* File list with upload zone. flex-1 + flex-col lets UploadZone fill the
            remaining viewport height so dragging files to the empty area below
            the list still triggers the drop zone. */}
        <div className="flex-1 flex flex-col min-h-0">
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
            onToggleStar={handleToggleStar}
            onDropToFolder={handleDropToFolder}
            onBulkTrash={handleBulkTrash}
            onBulkMove={(ids) => { setBulkMoveIds(ids); setBulkMoveOpen(true) }}
            onBulkShare={handleBulkShare}
            onBulkDownload={handleBulkDownload}
            bulkZipProgress={bulkZipProgress}
            trashingIds={trashingIds}
            starPulseId={starPulseId}
            recentlyUploadedIds={recentlyUploaded}
            onShowTrustDetails={(file) => setTrustFileId(file.id)}
            myShares={myShares}
            uploadCards={
              <UploadCards
                uploads={uploads}
                onCancel={handleCancelUpload}
                onRetry={handleRetryUpload}
              />
            }
          />
        </UploadZone>
        </div>

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

      {/* Duplicate-file conflict dialog — shown before uploading when names collide */}
      <DuplicateFileDialog
        open={pendingConflict !== null}
        conflicts={pendingConflict?.conflicts ?? []}
        onReplace={handleConflictReplace}
        onKeepBoth={handleConflictKeepBoth}
        onCancel={handleConflictCancel}
      />

      {/* Upload progress — inline cards inside the file list (spec 024 §4).
          The floating UploadProgress panel is replaced by UploadCards rendered
          via the FileList uploadCards prop. Paused-upload summary is still shown
          in the status bar (see below). */}

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

      <TrustDetailsPanel
        open={trustFileId !== null}
        onClose={() => setTrustFileId(null)}
        file={(() => {
          const f = files.find((x) => x.id === trustFileId)
          if (!f) return null
          const trust: TrustFile = {
            id: f.id,
            name: displayName(f),
            sizeBytes: f.size_bytes,
            createdAt: f.created_at,
            cipher: 'AES-256-GCM',
            region: 'Europe',
            city: 'Falkenstein',
            provider: 'Hetzner',
          }
          return trust
        })()}
      />

      {shareFile && (
        <ShareDialog
          open={shareFileId !== null}
          onClose={() => setShareFileId(null)}
          fileId={shareFile.id}
          fileName={displayName(shareFile)}
          fileSize={shareFile.size_bytes}
          isFolder={shareFile.is_folder}
          onShareCreated={() => {
            // Advance onboarding context (first_share_done might now be true)
            void refreshOnboarding()
            // Refresh share indicators on file rows.
            void fetchMyShares()
          }}
        />
      )}

      {manageSharesFileId && (() => {
        const file = files.find((f) => f.id === manageSharesFileId)
        if (!file) return null
        return (
          <ShareInfoModal
            isOpen={true}
            onClose={() => setManageSharesFileId(null)}
            fileId={file.id}
            fileName={displayName(file)}
            myShares={myShares}
            onCreateNew={() => setShareFileId(file.id)}
            onRevoked={() => { void fetchMyShares() }}
          />
        )
      })()}

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

      {versionFileId && (() => {
        const f = files.find((x) => x.id === versionFileId)
        return (
          <VersionHistory
            open={true}
            onClose={() => setVersionFileId(null)}
            fileId={versionFileId}
            fileName={f ? displayName(f) : ''}
            mimeType={f?.mime_type ?? undefined}
            onVersionRestored={fetchFiles}
          />
        )
      })()}

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

      {/* Upgrade nudge modal — shown at >= 80% quota, once per session */}
      {showUpgradeNudge && storageUsage && (
        <UpgradeNudgeModal
          usedBytes={storageUsage.used_bytes}
          quotaBytes={storageUsage.plan_limit_bytes}
          currentPlan={storageUsage.plan_name}
          onClose={() => setShowUpgradeNudge(false)}
        />
      )}
    </DriveLayout>
  )
}
