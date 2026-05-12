import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { Breadcrumb } from '../components/breadcrumb'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import { FileList } from '../components/file-list'
import { PresenceAvatars } from '../components/presence-avatars'
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
import { ShortcutsCheatsheet } from '../components/shortcuts-cheatsheet'
import { WelcomeTour } from '../components/welcome-tour'
import { OnboardingGuide } from '../components/onboarding-guide'
import { OnboardingTour } from '../components/onboarding-tour'
import { FilePreview } from '../components/preview/file-preview'
import { useFilePreview } from '../hooks/use-file-preview'
import { useOnboarding } from '../lib/onboarding-context'
import { getPreference, setPreference } from '../lib/api'
import { useDriveData } from '../lib/drive-data-context'
import { useToast } from '../components/toast'
import { useWsEvent } from '../lib/ws-context'
import { useSync } from '../lib/sync-context'
import { useKeys } from '../lib/key-context'
import { useKeyboardShortcuts, isMac } from '../hooks/use-keyboard-shortcuts'
import { useFrozen } from '../hooks/use-frozen'
import { useAuth } from '../lib/auth-context'
import {
  listFiles,
  createFolder,
  toggleStar,
  updateFile,
  deleteFile,
  getFile,
  getPendingApprovals,
  listMyShares,
  listVersions,
  getSharesForFile,
  getFolderMembers,
  type DriveFile,
  type MyShare,
  type StorageUsage,
  type SyncNode,
} from '../lib/api'
import type { FileActivityEntry } from '../components/file-details-panel'
import { timeAgo } from '../components/file-list'
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
import { encryptFilename, toBase64, decryptFileMetadata } from '../lib/crypto'
import { useSearchIndex } from '../hooks/use-search-index'
import { EmptyDrive } from '../components/empty-states/empty-drive'
import { formatBytes } from '../lib/format'
import { cacheFileList, getCachedFileList } from '../lib/offline-cache'
import { hashFile, checkDuplicate, recordUpload } from '../lib/upload-dedup'

// ─── Drive component ────────────────────────────────
// Folders are always grouped before files; the chosen key only orders
// within each group. localStorage key: 'bb_drive_sort'.

function inferMimeFromName(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'heic':
      return 'image/heic'
    case 'heif':
      return 'image/heif'
    case 'pdf':
      return 'application/pdf'
    case 'txt':
      return 'text/plain'
    case 'md':
      return 'text/markdown'
    case 'csv':
      return 'text/csv'
    case 'json':
      return 'application/json'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'mp4':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    default:
      return null
  }
}

export function Drive() {
  const { isFrozen } = useFrozen()
  const { user } = useAuth()
  const { getFileKey, isUnlocked, cryptoReady, cryptoError } = useKeys()
  const { usage: driveUsage, incomingCount: driveIncomingCount, refreshUsage: refreshDriveUsage } = useDriveData()
  const { indexFile, unindexFile } = useSearchIndex()
  const sync = useSync()
  const { refresh: refreshOnboarding } = useOnboarding()
  const { previewFile, openPreview, closePreview } = useFilePreview()
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

  // ─── Offline cache state ─────────────────────────────
  const [showingCached, setShowingCached] = useState(false)

  // ─── Pending shares state ────────────────────────────
  // incomingInviteCount comes from DriveDataContext (deduplicated).
  const incomingInviteCount = driveIncomingCount
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

  // ─── Folder viewer counts (presence) ─────────────────
  // Maps folderId → { count, emails } for shared folders visible in the current view.
  const [folderViewerCounts, setFolderViewerCounts] = useState<
    Record<string, { count: number; emails: string[] }>
  >({})

  // ─── External selection + decrypted names (for keyboard shortcuts + dialogs) ─
  const [externalSelectedIds, setExternalSelectedIds] = useState<Set<string>>(new Set())
  const [externalDecryptedNames, setExternalDecryptedNames] = useState<Record<string, string | null>>({})

  // ─── Duplicate-file conflict dialog ─────────────────
  type ResolvedUpload = { file: File; replaceFileId?: string; finalName?: string }
  interface PendingConflictUpload {
    conflicts: ConflictItem[]
    autoVersioned: ResolvedUpload[]
    nonConflicting: File[]
    allFiles: File[]
  }
  const [pendingConflict, setPendingConflict] = useState<PendingConflictUpload | null>(null)

  // ─── Smart folder suggestion state ───────────────────
  type FolderSuggestion = { type: 'images'; count: number } | { type: 'pdfs'; count: number }
  const DISMISSED_SUGGESTIONS_KEY = 'bb_dismissed_folder_suggestions'

  function getDismissedSuggestions(): Set<string> {
    try {
      const raw = localStorage.getItem(DISMISSED_SUGGESTIONS_KEY)
      if (!raw) return new Set()
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set()
    } catch {
      return new Set()
    }
  }

  function dismissSuggestion(key: string) {
    try {
      const current = getDismissedSuggestions()
      current.add(key)
      localStorage.setItem(DISMISSED_SUGGESTIONS_KEY, JSON.stringify([...current]))
    } catch { /* quota */ }
  }

  const [folderSuggestion, setFolderSuggestion] = useState<FolderSuggestion | null>(null)
  const [suggestionCreating, setSuggestionCreating] = useState(false)

  // ─── Shortcuts cheatsheet ────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(false)

  // ─── Dedup banner state ──────────────────────────────
  // Shows when a file whose hash was already uploaded this session is selected.
  interface DedupWarning {
    /** The file that looks like a duplicate */
    file: File
    /** Hash used to look it up */
    hash: string
    /** Name of the previously uploaded file */
    existingName: string
    /** Remaining files that are not duplicates — queued if the user skips */
    otherFiles: File[]
  }
  const [dedupWarning, setDedupWarning] = useState<DedupWarning | null>(null)

  // ─── Storage quota state (from shared DriveDataContext) ──────────────────
  const storageUsage: StorageUsage | null = driveUsage
  const [showUpgradeNudge, setShowUpgradeNudge] = useState(false)

  // ─── File activity feed (for FileDetailsPanel right rail) ────────────────
  const [fileActivity, setFileActivity] = useState<FileActivityEntry[]>([])

  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? undefined

  // Ref-tracked sync.ready so fetchFiles/refreshFromSync can read the current
  // value without listing it as a dep (which would re-create the callbacks and
  // re-fire the useEffect on every sync state transition, causing API storms).
  const syncReadyRef = useRef(sync.ready)
  useEffect(() => { syncReadyRef.current = sync.ready }, [sync.ready])

  // Stable mapper — deps never change after mount.
  const syncNodeToDriveFile = useCallback((n: SyncNode): DriveFile => ({
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
  }), [])

  // refreshFromSync — reads sync.children() without an API call.
  // Used by the treeVersion effect so SSE-pushed updates don't hit the server
  // on every mutation event.
  const refreshFromSync = useCallback(() => {
    if (!isUnlocked || !syncReadyRef.current) return
    const trashed = location.pathname === '/trash'
    const nodes = sync
      .children(currentParentId ?? null)
      .filter((n) => Boolean(n.is_trashed) === trashed)
      .map(syncNodeToDriveFile)
    setFiles(nodes)
    setShowingCached(false)
    if (!trashed) cacheFileList(currentParentId ?? null, nodes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParentId, location.pathname, isUnlocked, syncNodeToDriveFile])

  // fetchFiles — triggered on folder navigation (currentParentId change).
  // When the sync engine is ready and the view is not trash, show the
  // sync snapshot immediately (no spinner) then fall through to a background
  // API call so the list is always fresh after back-navigation. This prevents
  // stale data when SSE may have missed events for the revisited folder.
  const fetchFiles = useCallback(async () => {
    if (!isUnlocked) return
    const trashed = location.pathname === '/trash'

    if (syncReadyRef.current && !trashed) {
      // Show sync snapshot immediately — drop the spinner right away.
      const nodes = sync
        .children(currentParentId ?? null)
        .filter((n) => !n.is_trashed)
        .map(syncNodeToDriveFile)
      setFiles(nodes)
      setShowingCached(false)
      setLoading(false)
      cacheFileList(currentParentId ?? null, nodes)
      // Fall through to the API refresh — do NOT return here.
    } else {
      setLoading(true)
    }

    try {
      const data = await listFiles(currentParentId ?? undefined, trashed)
      setFiles(data)
      setShowingCached(false)
      if (!trashed) cacheFileList(currentParentId ?? null, data)
      setSyncedAgo(0)
    } catch (err) {
      console.error('[Drive] Failed to load files:', err)
      const isOffline = !navigator.onLine
      const cached = getCachedFileList(currentParentId ?? null)
      if (isOffline && cached) {
        setFiles(cached)
        setShowingCached(true)
      } else {
        showToast({ icon: 'x', title: 'Failed to load files', danger: true })
        setFiles([])
        setShowingCached(false)
      }
    } finally {
      setLoading(false)
    }
  // sync.ready intentionally read via syncReadyRef to avoid infinite re-fetch
  // loop: listing sync.ready as a dep would recreate fetchFiles on every sync
  // state transition and re-trigger this effect, hammering the API.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParentId, location.pathname, isUnlocked, syncNodeToDriveFile])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // When sync becomes ready, show the live snapshot without an extra API call.
  // fetchFiles already ran the API call on mount; this just swaps in fresh
  // in-memory data once the sync engine has its first snapshot.
  useEffect(() => {
    if (sync.ready && isUnlocked) refreshFromSync()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.ready])

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

  // ─── Folder viewer counts (collaborative presence) ────
  // For each shared folder visible in the current view, fetch how many
  // collaborators have access. We batch-resolve after `files` settles.
  // Throttled to avoid hammering the API on large directories.
  useEffect(() => {
    if (!isUnlocked || files.length === 0) {
      setFolderViewerCounts({})
      return
    }
    let cancelled = false

    // Only look at folders that the current user has shared (myShares gives us
    // the subset without needing to probe every folder row).
    const sharedFolderIds = files
      .filter((f) => f.is_folder)
      .map((f) => f.id)
      .filter((id) => myShares.some((s) => s.file_id === id))

    if (sharedFolderIds.length === 0) {
      setFolderViewerCounts({})
      return
    }

    async function resolveViewerCounts() {
      const counts: Record<string, { count: number; emails: string[] }> = {}
      const currentUserId = user?.user_id ?? null

      for (const folderId of sharedFolderIds) {
        if (cancelled) return
        try {
          const { members } = await getFolderMembers(folderId)
          // Exclude current user from the count
          const others = members.filter((m) => m.user_id !== currentUserId)
          if (others.length > 0) {
            counts[folderId] = {
              count: others.length,
              emails: others.map((m) => m.email),
            }
          }
        } catch {
          // Non-fatal — skip this folder
        }
      }
      if (!cancelled) {
        setFolderViewerCounts(counts)
      }
    }

    void resolveViewerCounts()
    return () => { cancelled = true }
  // Depend on files + myShares; re-run when files list or share list changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, myShares, isUnlocked])

  // ─── Smart folder suggestion analysis ─────────────────
  // Only active at root (no parent). Detect 5+ images or 5+ PDFs without
  // a corresponding folder. Show at most one suggestion at a time.
  useEffect(() => {
    if (currentParentId || loading || files.length === 0) {
      setFolderSuggestion(null)
      return
    }
    const dismissed = getDismissedSuggestions()
    const folderNames = files
      .filter((f) => f.is_folder)
      .map((f) => {
        const dec = externalDecryptedNames[f.id]
        return dec ? dec.toLowerCase() : null
      })
      .filter(Boolean) as string[]

    const imageFiles = files.filter(
      (f) => !f.is_folder && (f.mime_type ?? '').startsWith('image/'),
    )
    const pdfFiles = files.filter(
      (f) => !f.is_folder && f.mime_type === 'application/pdf',
    )

    const hasPhotosFolder = folderNames.some((n) => n === 'photos')
    const hasDocumentsFolder = folderNames.some((n) => n === 'documents')

    if (imageFiles.length >= 5 && !hasPhotosFolder && !dismissed.has('images')) {
      setFolderSuggestion({ type: 'images', count: imageFiles.length })
    } else if (pdfFiles.length >= 5 && !hasDocumentsFolder && !dismissed.has('pdfs')) {
      setFolderSuggestion({ type: 'pdfs', count: pdfFiles.length })
    } else {
      setFolderSuggestion(null)
    }
  // externalDecryptedNames changes frequently; include it so folder names are resolved
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, loading, currentParentId, externalDecryptedNames])

  // Re-derive when the sync engine pushes an op affecting the visible folder.
  // Uses refreshFromSync (sync tree only, no API call) — fetchFiles is reserved
  // for navigation changes so SSE events don't hammer the server.
  useEffect(() => {
    if (!sync.ready) return
    refreshFromSync()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.treeVersion, sync.ready, refreshFromSync])

  // Deep-link into a folder when navigating from search results
  useEffect(() => {
    const state = location.state as {
      openFolderId?: string | null
      openFolderName?: string
      openFileId?: string | null
    } | null
    if (state?.openFolderId) {
      setBreadcrumbs([
        { id: null, name: 'All files' },
        { id: state.openFolderId, name: state.openFolderName ?? 'Folder' },
      ])
    }
    if (state?.openFileId) {
      // Auto-select the file so the detail panel opens
      setSelectedFileId(state.openFileId)
    }
    if (state?.openFolderId || state?.openFileId) {
      // Clear location state so refreshing doesn't re-navigate
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, navigate, location.pathname])

  // Deep-link via ?folder=<id> query param (used by the Quick Access sidebar
  // on the home route). Runs whenever the search string changes — the Quick
  // Access Link writes ?folder=<id>, this effect resolves the folder name and
  // sets breadcrumbs accordingly.
  const lastResolvedFolderRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isUnlocked) return
    const params = new URLSearchParams(location.search)
    const folderId = params.get('folder')
    if (!folderId) {
      lastResolvedFolderRef.current = null
      return
    }
    if (lastResolvedFolderRef.current === folderId) return
    lastResolvedFolderRef.current = folderId
    let cancelled = false
    ;(async () => {
      try {
        const file = await getFile(folderId)
        const fileKey = await getFileKey(folderId)
        const { name } = await decryptFileMetadata(fileKey, file.name_encrypted)
        if (cancelled) return
        setBreadcrumbs([
          { id: null, name: 'All files' },
          { id: folderId, name: name || 'Folder' },
        ])
      } catch (err) {
        if (cancelled) return
        // Folder may have been deleted/unshared. Show with a placeholder name.
        // eslint-disable-next-line no-console
        console.error('[drive] Failed to resolve ?folder= deep link', { folderId, err })
        setBreadcrumbs([
          { id: null, name: 'All files' },
          { id: folderId, name: 'Folder' },
        ])
      }
    })()
    return () => { cancelled = true }
  }, [location.search, isUnlocked, getFileKey])

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

  // Show upgrade nudge once per session when approaching quota limit
  useEffect(() => {
    if (storageUsage && shouldShowUpgradeNudge(storageUsage.used_bytes, storageUsage.plan_limit_bytes)) {
      setShowUpgradeNudge(true)
    }
  }, [storageUsage])

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

  // Check for pending admin approvals on mount (incoming invites come from context)
  useEffect(() => {
    getPendingApprovals()
      .then((approvals) => setPendingApprovalCount(approvals.length))
      .catch(() => {})
  }, [])

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
  const openNewFolderDialog = useCallback(() => setFolderDialogOpen(true), [])

  useEffect(() => {
    const handleUploadTrigger = () => browse()
    const handleNewFolderTrigger = () => openNewFolderDialog()
    window.addEventListener('beebeeb:upload-trigger', handleUploadTrigger)
    window.addEventListener('beebeeb:new-folder-trigger', handleNewFolderTrigger)
    return () => {
      window.removeEventListener('beebeeb:upload-trigger', handleUploadTrigger)
      window.removeEventListener('beebeeb:new-folder-trigger', handleNewFolderTrigger)
    }
  }, [browse, openNewFolderDialog])

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
        let resumeStartedAt: number | undefined
        await encryptedUpload(
          file,
          match.fileId,
          fileKey,
          match.parentId ?? undefined,
          (p) => {
            if (p.stage === 'Uploading' && !resumeStartedAt) {
              resumeStartedAt = Date.now()
            }
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId
                  ? {
                      ...u,
                      stage: p.stage,
                      progress: p.progress,
                      bytesUploaded: p.bytesUploaded,
                      uploadedChunks: p.uploadedChunks,
                      totalChunks: p.totalChunks,
                      chunkSizeBytes: p.chunkSizeBytes,
                      storageRegion: p.region,
                      startedAt: resumeStartedAt,
                    }
                  : u,
              ),
            )
          },
          match.fileId, // resumeFileId
          undefined,
          undefined,
          getFileKey,
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

  function shouldAutoVersionUpload(existingFile: DriveFile, incomingFile: File): boolean {
    const existingName = externalDecryptedNames[existingFile.id] ?? existingFile.name_encrypted
    const existingMime = existingFile.mime_type || inferMimeFromName(existingName)
    const incomingMime = incomingFile.type || inferMimeFromName(incomingFile.name)
    const sameType = !existingMime || !incomingMime || existingMime.toLowerCase() === incomingMime.toLowerCase()
    return sameType && existingFile.size_bytes !== incomingFile.size
  }

  /**
   * Queue a resolved list of uploads.
   * Each item carries the File to upload, an optional replaceFileId for the
   * Replace path, and the final name to use (may differ from file.name for
   * the "Keep both" path where we rename with a suffix).
   */
  function queueResolvedUploads(
    resolved: ResolvedUpload[],
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

  async function handleFilesSelected(selectedFiles: File[]) {
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

    // ─── Smart duplicate detection (session-based, pre-encryption) ────────
    // Hash each file with SHA-256 and check against files already uploaded
    // this session. We check one duplicate at a time — if the user hits
    // "Skip", we continue checking the rest. "Upload anyway" proceeds for
    // that file and records the hash.
    const toCheck = [...selectedFiles]
    const cleared: File[] = []
    for (const f of toCheck) {
      let hash: string
      try {
        hash = await hashFile(f)
      } catch {
        // Hash failed (memory, permissions) — pass through without a check
        cleared.push(f)
        continue
      }
      const existing = checkDuplicate(hash)
      if (existing) {
        // Show the dedup banner for this file, passing the remaining files
        // so the "Skip" path can still process them.
        const otherFiles = toCheck.filter((x) => x !== f).concat(cleared)
        setDedupWarning({ file: f, hash, existingName: existing.name, otherFiles })
        return
      }
      cleared.push(f)
    }

    // ─── Conflict detection ───────────────────────
    // Run whenever the vault is unlocked. buildNameToFileMap() only includes
    // files that have already decrypted names — files not yet decrypted are
    // simply absent from the map (treating them as non-conflicting is the
    // correct safe default; false conflicts are worse than missed conflicts here).
    if (isUnlocked) {
      const nameToFile = buildNameToFileMap()
      const conflicts: ConflictItem[] = []
      const autoVersioned: ResolvedUpload[] = []
      const nonConflicting: File[] = []

      for (const f of cleared) {
        const existing = nameToFile.get(f.name.toLowerCase())
        if (existing) {
          if (shouldAutoVersionUpload(existing, f)) {
            autoVersioned.push({ file: f, replaceFileId: existing.id })
          } else {
            const existingName = externalDecryptedNames[existing.id] ?? f.name
            conflicts.push({
              newFile: f,
              existingFileId: existing.id,
              existingName: existingName ?? f.name,
            })
          }
        } else {
          nonConflicting.push(f)
        }
      }

      if (conflicts.length > 0) {
        // Pause only unresolved conflicts. Same-name, same-type changed files
        // are already resolved as version uploads.
        setPendingConflict({ conflicts, autoVersioned, nonConflicting, allFiles: cleared })
        return
      }

      if (autoVersioned.length > 0) {
        queueResolvedUploads([
          ...nonConflicting.map((f) => ({ file: f })),
          ...autoVersioned,
        ])
        return
      }
    }

    // ─── No conflicts — queue immediately ─────────
    queueResolvedUploads(cleared.map((f) => ({ file: f })))
  }

  // ─── Conflict dialog resolution ──────────────────

  function handleConflictReplace() {
    if (!pendingConflict) return
    const { conflicts, autoVersioned, nonConflicting } = pendingConflict
    setPendingConflict(null)
    queueResolvedUploads([
      ...nonConflicting.map((f) => ({ file: f })),
      ...autoVersioned,
      ...conflicts.map((c) => ({ file: c.newFile, replaceFileId: c.existingFileId })),
    ])
  }

  function handleConflictKeepBoth() {
    if (!pendingConflict) return
    const { conflicts, autoVersioned, nonConflicting } = pendingConflict
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
      ...autoVersioned,
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
      const uploadedFile = await encryptedUpload(file, fileId, fileKey, currentParentId, (p) => {
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
                  uploadedChunks: p.uploadedChunks,
                  totalChunks: p.totalChunks,
                  chunkSizeBytes: p.chunkSizeBytes,
                  storageRegion: p.region,
                  startedAt: uploadStartedAt,
                }
              : u,
          ),
        )
      }, undefined, undefined, abortController.signal, getFileKey)
      const uploadedFileId = uploadedFile.id

      // Update the encrypted search index with the new file
      const pathPrefix = breadcrumbs.slice(1).map((b) => b.name).join('/')
      indexFile(uploadedFileId, {
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
      setLastUploadedFileId(uploadedFileId)
      showToast({ icon: 'check', title: 'Uploaded', description: file.name })
      // Notify sidebar badge that a file was uploaded
      window.dispatchEvent(new CustomEvent('beebeeb:file-uploaded'))
      // Record hash for duplicate detection in this session (fire-and-forget)
      hashFile(file).then((hash) => recordUpload(hash, file.name)).catch(() => {})
      // Refresh storage usage so quota warning updates
      refreshDriveUsage()
      // Advance onboarding state (first_upload_done might now be true)
      void refreshOnboarding()
      // Mark as recently uploaded for glow animation
      setRecentlyUploaded((prev) => new Set(prev).add(uploadedFileId))
      setTimeout(() => {
        setRecentlyUploaded((prev) => {
          const next = new Set(prev)
          next.delete(uploadedFileId)
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

        const uploadedFile = await encryptedUpload(ff.file, fileId, fileKey, parentId, (p) => {
          // Blend per-file progress into overall progress
          const fileProgress = p.progress / 100
          const overallProgress = Math.round(
            5 + ((completedFiles + fileProgress) / totalFiles) * 95,
          )
          setUploads((prev) =>
            prev.map((u) =>
              u.id === foldUploadId
                ? {
                    ...u,
                    stage: p.stage === 'Done' ? 'Uploading' as const : p.stage,
                    progress: overallProgress,
                    uploadedChunks: p.uploadedChunks,
                    totalChunks: p.totalChunks,
                    chunkSizeBytes: p.chunkSizeBytes,
                    storageRegion: p.region,
                  }
                : u,
            ),
          )
        }, undefined, undefined, undefined, getFileKey)

        // Index each file
        const pathPrefix = breadcrumbs.slice(1).map((b) => b.name).join('/')
        const filePath = parentPath
          ? `/${pathPrefix ? pathPrefix + '/' : ''}${parentPath}`
          : pathPrefix ? `/${pathPrefix}` : '/'
        indexFile(uploadedFile.id, {
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
      // Notify sidebar badge that files were uploaded
      window.dispatchEvent(new CustomEvent('beebeeb:file-uploaded', { detail: { count: totalFiles } }))
      refreshDriveUsage()
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

  // ─── Smart folder suggestion: create folder + move files ─────────────────

  async function handleAcceptFolderSuggestion() {
    if (!folderSuggestion || !isUnlocked || !cryptoReady) return
    const folderName = folderSuggestion.type === 'images' ? 'Photos' : 'Documents'
    const filesToMove = folderSuggestion.type === 'images'
      ? files.filter((f) => !f.is_folder && (f.mime_type ?? '').startsWith('image/'))
      : files.filter((f) => !f.is_folder && f.mime_type === 'application/pdf')

    setSuggestionCreating(true)
    try {
      // Create the folder
      const folderId = crypto.randomUUID()
      const folderKey = await getFileKey(folderId)
      const enc = await encryptFilename(folderKey, folderName)
      const nameEncrypted = JSON.stringify({
        nonce: toBase64(enc.nonce),
        ciphertext: toBase64(enc.ciphertext),
      })
      const result = await createFolder(nameEncrypted, undefined, folderId)

      // Move all matching files into it
      await Promise.all(filesToMove.map((f) => updateFile(f.id, { parent_id: result.id })))

      showToast({
        icon: 'folder',
        title: `${folderName} folder created`,
        description: `${filesToMove.length} file${filesToMove.length !== 1 ? 's' : ''} moved.`,
      })
      setFolderSuggestion(null)
      fetchFiles()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not create folder',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        danger: true,
      })
    } finally {
      setSuggestionCreating(false)
    }
  }

  function handleDismissFolderSuggestion() {
    if (!folderSuggestion) return
    dismissSuggestion(folderSuggestion.type)
    setFolderSuggestion(null)
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

  // Load activity feed when the details panel opens for a file
  useEffect(() => {
    if (!selectedFileId || !selectedFile) {
      setFileActivity([])
      return
    }
    let cancelled = false
    async function loadActivity() {
      if (!selectedFileId) return
      try {
        const events: FileActivityEntry[] = []

        // ── Baseline: created event ──────────────────────────────────────────
        if (selectedFile) {
          events.push({
            label: selectedFile.is_folder ? 'Folder created' : 'File created',
            when: timeAgo(selectedFile.created_at),
            icon: selectedFile.is_folder ? 'folder' : 'upload',
          })
        }

        // ── Version history (files only) ─────────────────────────────────────
        if (selectedFile && !selectedFile.is_folder) {
          try {
            const versionData = await listVersions(selectedFileId)
            if (!cancelled) {
              // Each version beyond the first represents a new upload
              const sorted = [...versionData.versions].sort(
                (a, b) => a.version_number - b.version_number,
              )
              for (const v of sorted) {
                if (v.version_number > 1) {
                  events.push({
                    label: `Version ${v.version_number} uploaded`,
                    when: timeAgo(v.created_at),
                    icon: 'clock',
                  })
                }
              }
            }
          } catch {
            // Versions endpoint may not be available — skip silently
          }
        }

        // ── Share events ─────────────────────────────────────────────────────
        try {
          const shares = await getSharesForFile(selectedFileId)
          if (!cancelled) {
            for (const s of shares) {
              events.push({
                label: 'Share link created',
                when: timeAgo(s.created_at),
                icon: 'share',
              })
              if (s.revoked) {
                events.push({
                  label: 'Share link revoked',
                  when: s.expires_at ? timeAgo(s.expires_at) : 'previously',
                  icon: 'x',
                })
              }
            }
          }
        } catch {
          // Share endpoint may not include this file — skip silently
        }

        // We only have relative "time ago" strings, so preserve insertion order which is chronological
        // (events were pushed in: created → versions → shares, already time-ordered)

        if (!cancelled) setFileActivity(events)
      } catch {
        if (!cancelled) setFileActivity([])
      }
    }
    loadActivity()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileId])

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
      hasThumbnail: file.has_thumbnail ?? false,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
      location: locationPath || '/',
      cipher: isUnlocked ? 'AES-256-GCM' : undefined,
      keyId: isUnlocked ? file.id : undefined,
      region: undefined,
      noteEncrypted: file.note_encrypted ?? null,
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
      // Notify the sidebar starred section to refresh
      window.dispatchEvent(new Event('beebeeb:star-changed'))
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
        else openPreview(file)
        break
      case 'preview':
        if (!file.is_folder) openPreview(file)
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

  async function handleDropToFolder(ids: string[], targetFolder: DriveFile, knownFolderName?: string) {
    // Use the pre-decrypted name from the event if available (covers pinned
    // folders that may not be in the current `files` list / decryptedNames map).
    const targetName = knownFolderName || displayName(targetFolder) || 'folder'
    try {
      await Promise.all(ids.map((id) => updateFile(id, { parent_id: targetFolder.id })))
      if (ids.length === 1) {
        const movedFile = files.find((f) => f.id === ids[0])
        const movedName = movedFile ? displayName(movedFile) : 'File'
        showToast({ icon: 'folder', title: `Moved to ${targetName}`, description: movedName || undefined })
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
      const ce = e as CustomEvent<{ folderId: string; fileIds: string[]; folderName?: string }>
      const detail = ce.detail
      if (!detail?.folderId || !Array.isArray(detail.fileIds)) return
      const target = files.find((f) => f.id === detail.folderId)
      if (target) {
        handleDropToFolder(detail.fileIds, target, detail.folderName)
        return
      }
      // Pinned folder may not be in the current `files` list — fetch it.
      getFile(detail.folderId)
        .then((folder) => handleDropToFolder(detail.fileIds, folder, detail.folderName))
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
    onNewFolder: openNewFolderDialog,
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
    onShortcuts: () => setShowShortcuts((v) => !v),
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
    onEscape: () => {
      if (showShortcuts) setShowShortcuts(false)
      // Other escape handling is done inside FileList
    },
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

          {/* Presence avatars — shown when the current folder is shared */}
          {currentParentId && (
            <PresenceAvatars
              folderId={
                myShares.some((s) => s.file_id === currentParentId)
                  ? currentParentId
                  : null
              }
              currentUserId={user?.user_id ?? null}
            />
          )}

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
            <BBButton size="sm" onClick={browse} className="gap-1.5" aria-label="Upload files" disabled={isFrozen} title={isFrozen ? 'Account is frozen' : undefined} data-tour="upload">
              <Icon name="upload" size={13} /> <span className="hidden sm:inline" aria-hidden="true">Upload</span>
            </BBButton>
            <BBButton size="sm" onClick={browseFolder} className="hidden sm:inline-flex gap-1.5" disabled={isFrozen} title={isFrozen ? 'Account is frozen' : undefined}>
              <Icon name="folder" size={13} /> Upload folder
            </BBButton>
          </div>

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

        {/* Offline cached data banner */}
        {showingCached && (
          <div className="px-5 py-2 border-b border-amber/30 bg-amber-bg flex items-center gap-2 text-[12px] text-amber-deep">
            <Icon name="cloud" size={13} className="shrink-0" />
            Offline — showing cached files from your last visit
          </div>
        )}

        {/* Duplicate file warning banner */}
        {dedupWarning && (
          <div className="px-5 py-2.5 border-b border-amber/40 bg-amber-bg/50 flex items-start gap-3 text-sm">
            <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
            <span className="flex-1 text-ink">
              <span className="font-medium">
                &apos;{dedupWarning.file.name}&apos;
              </span>{' '}
              looks like a file you already uploaded
              {dedupWarning.existingName !== dedupWarning.file.name && (
                <> (as &apos;{dedupWarning.existingName}&apos;)</>
              )}
              . Upload anyway?
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <BBButton
                size="sm"
                variant="amber"
                onClick={() => {
                  const { file, hash, otherFiles } = dedupWarning
                  setDedupWarning(null)
                  // Mark as already-acknowledged so it won't re-trigger
                  recordUpload(hash, file.name)
                  // Queue this file directly (skip dedup for it — already confirmed)
                  queueResolvedUploads([{ file }])
                  // Check remaining files through the normal pipeline
                  if (otherFiles.length > 0) void handleFilesSelected(otherFiles)
                }}
              >
                Upload
              </BBButton>
              <BBButton
                size="sm"
                variant="ghost"
                onClick={() => {
                  const { otherFiles } = dedupWarning
                  setDedupWarning(null)
                  // Skip this file and continue with remaining
                  if (otherFiles.length > 0) void handleFilesSelected(otherFiles)
                }}
              >
                Skip
              </BBButton>
            </div>
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

        {/* Smart folder suggestion banner */}
        {folderSuggestion && !currentParentId && (
          <div className="px-5 py-3 border-b border-amber/30 border-l-4 border-l-amber bg-paper-2 flex items-center gap-3 text-sm">
            <Icon name="folder" size={14} className="text-amber-deep shrink-0" />
            <span className="flex-1 text-ink">
              {folderSuggestion.type === 'images'
                ? `You have ${folderSuggestion.count} images in your root folder. Create a Photos folder and move them there?`
                : `You have ${folderSuggestion.count} PDFs in your root folder. Create a Documents folder and move them there?`}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <BBButton
                size="sm"
                variant="amber"
                disabled={suggestionCreating}
                onClick={handleAcceptFolderSuggestion}
              >
                {suggestionCreating
                  ? 'Creating…'
                  : folderSuggestion.type === 'images'
                    ? 'Create Photos folder'
                    : 'Create Documents folder'}
              </BBButton>
              <BBButton
                size="sm"
                variant="ghost"
                disabled={suggestionCreating}
                onClick={handleDismissFolderSuggestion}
              >
                Dismiss
              </BBButton>
            </div>
          </div>
        )}

        {/* File list with upload zone. flex-1 + flex-col lets UploadZone fill the
            remaining viewport height so dragging files to the empty area below
            the list still triggers the drop zone. */}
        <div className="flex-1 flex flex-col min-h-0">
        <UploadZone onFiles={handleFilesSelected} onFolderFiles={handleFolderFilesSelected}>
          <FileList
            files={files}
            loading={loading}
            parentId={currentParentId ?? null}
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
                <EmptyDrive onUpload={browse} onCreateFolder={openNewFolderDialog} />
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
            folderViewerCounts={folderViewerCounts}
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
        activity={fileActivity}
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
        onPreview={() => {
          if (selectedFile && !selectedFile.is_folder) {
            openPreview(selectedFile)
            setSelectedFileId(null)
          }
        }}
      />

      {/* Full-screen file preview overlay */}
      {previewFile && (() => {
        const previewIdx = files.findIndex((f) => f.id === previewFile.id)
        const hasPrev = previewIdx > 0
        const hasNext = previewIdx < files.length - 1
        return (
          <FilePreview
            file={previewFile}
            decryptedName={externalDecryptedNames[previewFile.id] ?? undefined}
            onClose={closePreview}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={hasPrev ? () => openPreview(files[previewIdx - 1]) : undefined}
            onNext={hasNext ? () => openPreview(files[previewIdx + 1]) : undefined}
          />
        )
      })()}

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

      {/* First-run spotlight tour — 3 steps: upload, share, mobile */}
      <OnboardingTour />

      {/* Upgrade nudge modal — shown at >= 80% quota, once per session */}
      {showUpgradeNudge && storageUsage && (
        <UpgradeNudgeModal
          usedBytes={storageUsage.used_bytes}
          quotaBytes={storageUsage.plan_limit_bytes}
          currentPlan={storageUsage.plan_name}
          onClose={() => setShowUpgradeNudge(false)}
        />
      )}

      {/* Keyboard shortcuts help button — bottom-right FAB */}
      <button
        type="button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => setShowShortcuts((v) => !v)}
        className="hidden sm:flex fixed right-5 z-40 items-center justify-center w-8 h-8 rounded-full bg-paper border border-line-2 shadow-2 text-ink-3 hover:text-ink hover:border-line hover:shadow-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
        style={{ bottom: 'max(1.25rem, env(safe-area-inset-bottom, 1.25rem))' }}
      >
        <span className="text-sm font-mono font-semibold leading-none select-none">?</span>
      </button>

      {/* Shortcuts cheatsheet — also opens on '?' key via GlobalShortcuts in app.tsx */}
      <ShortcutsCheatsheet open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </DriveLayout>
  )
}
