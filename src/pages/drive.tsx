import {useState, useEffect, useCallback, useMemo, useRef} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'

import {DriveLayout} from '../components/drive-layout'







import {useBrowseFiles, useBrowseFolders} from '../components/upload-zone'
import type {UploadItem} from '../components/upload-progress'



import {DriveTopBar} from './drive/drive-top-bar'
import {DriveBanners, type DedupWarning, type FolderSuggestion} from './drive/drive-banners'
import {DriveFileList} from './drive/drive-file-list'
import {DriveCreationOverlays} from './drive/drive-creation-overlays'
import {DriveFileOverlays} from './drive/drive-file-overlays'
import {DriveGuideOverlays} from './drive/drive-guide-overlays'
import {useDriveUploads} from './drive/use-drive-uploads'
import {useDriveCommands} from './drive/use-drive-commands'

import {getNewDocumentType, type NewDocumentType} from '../lib/new-document'

import {FEATURE_OFFICE_EDITOR} from '../lib/flags'


import {type ConflictItem} from '../components/duplicate-file-dialog'




import {useFilePreview} from '../hooks/use-file-preview'
import {useOnboarding} from '../lib/onboarding-context'
import {getPreference, setPreference} from '../lib/api'
import {applyKnownLargeThumbFlags, recordLargeThumbFlags} from '../lib/sync-thumb-flags'
import {createAttributionRefresher, learnAttribution, rowsMissingAttribution, withAttribution, type RowAttribution} from '../lib/row-attribution'


import {useDriveData} from '../lib/drive-data-context'
import {useToast} from '../components/toast'
import {useWsEvent} from '../lib/ws-context'
import {useSelfHealRefetch} from '../hooks/use-self-heal-refetch'
import {useSync} from '../lib/sync-context'
import {useKeys} from '../lib/key-context'
import {useKeyboardShortcuts} from '../hooks/use-keyboard-shortcuts'
import {useFrozen} from '../hooks/use-frozen'
import {useAuth} from '../lib/auth-context'
import {listAllFiles, bulkTrashFiles, getFile, getPendingApprovals, listMyShares, getFolderMembers, type DriveFile, type MyShare, type StorageUsage, type SyncNode} from '../lib/api'
import {moveOwnerItems} from '../lib/owner-upload-key'

import {userFriendlyError} from '../lib/user-friendly-error'
import {usePlanBlock} from '../hooks/use-plan-block'
import type {FileActivityEntry} from '../components/file-details-panel'


import {UploadQuotaLedger} from '../lib/upload-quota'
import {siblingLowercaseNames} from '../lib/name-collision'
import {shouldShowUpgradeNudge} from '../components/upgrade-nudge-modal'




import {downloadAsZip, ZIP_SIZE_WARNING_BYTES} from '../lib/bulk-download'
import {getActiveUploads, removeUploadState, type UploadState} from '../lib/upload-resume'
import {decryptFileMetadata, readFileMetadata} from '../lib/crypto'
import {renameOwnerRow} from '../lib/owner-rename'


import {useSearchIndex} from '../hooks/use-search-index'



import {cacheFileList, getCachedFileList, invalidateFileListCache, getOfflineCacheScope, isCurrentOfflineCacheScope} from '../lib/offline-cache'
import {decideSyncRows, EMPTY_CONFIRM_MS} from '../lib/sync-rows'
import {createScopedTimer} from '../lib/scoped-timer'
import {recordUpload} from '../lib/upload-dedup'


import {knownPoolLocation, learnPoolLocations} from '../lib/sync-storage-locations'


// ─── Drive component ────────────────────────────────
// Folders are always grouped before files; the chosen key only orders
// within each group. localStorage key: 'bb_drive_sort'.

export function Drive() {
  const { isFrozen } = useFrozen()
  const { user } = useAuth()
  const keys = useKeys()
  const { getFileKey, getMasterKey, getFileKeyForFile, getResidentUserId, isUnlocked, cryptoReady, cryptoError } = keys
  const driveData = useDriveData()
  const { usage: driveUsage, planDetails: drivePlanDetails, incomingCount: driveIncomingCount, setOffline: setDriveOffline, unpinFolders, accountDocument: driveAccountDocument } = driveData
  const search = useSearchIndex()
  const { reindexFields, unindexFile } = search
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
  // "+ New" document (task 1582): the type whose name prompt is open, and the
  // id of a just-created text file whose preview should open in edit mode.
  const [newDocType, setNewDocType] = useState<NewDocumentType | null>(null)
  const [previewEditFileId, setPreviewEditFileId] = useState<string | null>(null)
  // Office types need the editor to be reachable: the build flag, the one
  // gate for the office editor (office-labs.ts; the Labs opt-in was dropped,
  // task 1567) — the same gate as the preview's Edit button and the route.
  const officeAvailable = FEATURE_OFFICE_EDITOR
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const uploadAbortRef = useRef<Map<string, AbortController>>(new Map())
  // Cache the File object per upload-id so we can re-invoke the encrypted
  // upload pipeline when the user clicks Retry on a failed item.
  const uploadFilesRef = useRef<Map<string, File>>(new Map())
  // Bytes reserved by uploads queued but not yet reflected in `storageUsage`
  // (task 1544 finding 2a) -- see UploadQuotaLedger's doc comment. A plain
  // ref (not state): reserving/releasing must never itself trigger a
  // re-render.
  const quotaLedgerRef = useRef(new UploadQuotaLedger())
  const [syncedAgo, setSyncedAgo] = useState(0)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [shareFileId, setShareFileId] = useState<string | null>(null)
  // Bundle share (task 0417): the ordered set of file ids selected for a single
  // "Share with Beebeeb" link. Non-empty (length > 1) ⇒ the ShareDialog opens
  // in bundle mode over these files instead of a single-file share.
  const [bundleFileIds, setBundleFileIds] = useState<string[]>([])
  // File whose Manage-shares modal is currently open.
  const [manageSharesFileId, setManageSharesFileId] = useState<string | null>(null)
  // Active shares owned by the current user, used to flag rows in the file
  // list and seed the ShareInfoModal so it doesn't have to refetch from
  // scratch every time it opens.
  const [myShares, setMyShares] = useState<MyShare[]>([])
  const [moveFileId, setMoveFileId] = useState<string | null>(null)
  const [renameFileId, setRenameFileId] = useState<string | null>(null)
  const [versionFileId, setVersionFileId] = useState<string | null>(null)
  // Pending trash of the Backups root, awaiting the extra confirmation (0838).
  const [backupsDeleteRequest, setBackupsDeleteRequest] = useState<
    { kind: 'single'; file: DriveFile } | { kind: 'bulk'; ids: string[] } | null
  >(null)
  const [trustFileId, setTrustFileId] = useState<string | null>(null)
  const [tourOpen, setTourOpen] = useState(false)
  const [tourCompleted, setTourCompleted] = useState<Set<string>>(new Set())
  // The persisted `welcome_tour.seen` value, mirrored from disk so step
  // completions can write it BACK UNCHANGED (task 1527 fix-round). Only two
  // paths are allowed to flip it: this component's onClose below ("Skip for
  // now" / "Close" → true) and the mount effect a few lines down, which
  // re-reads the real preference on every fresh mount — including the mount
  // that happens after the Settings "Show welcome checklist" action
  // navigates back here having written seen:false. Defaults to false so a
  // step completed in the brief window before that fetch resolves doesn't
  // wrongly persist `seen: true`.
  const tourSeenRef = useRef(false)
  // Whether the mount effect's GET of `welcome_tour` has come back. Until it
  // has, tourSeenRef/tourCompleted are DEFAULTS, not the user's real state:
  // writing them would persist `seen:false` (reopening a dismissed board) and
  // drop every earlier completed step. Completions that land in that window
  // are parked in pendingTourStepsRef and merged into the real preference
  // once it arrives (e2e classification of thumbnail-variant, 2026-09-25).
  const tourPrefLoadedRef = useRef(false)
  const pendingTourStepsRef = useRef<Set<string>>(new Set())

  // Mark a welcome-checklist step done from a REAL completion signal (files
  // actually queued, a step's own confirmed action) — never from a step
  // button being clicked. Writes the persisted `seen` value back UNCHANGED
  // (tourSeenRef, above) — never `seen: false` unconditionally. That
  // unconditional write was the bug: it reopened the board on the next
  // upload for anyone who had pressed "Skip for now"/"Close" (seen:true),
  // including every user who had already dismissed the board before this
  // feature shipped. Only the footer's "Skip for now" / "Close" (onClose
  // below) is allowed to persist `seen: true` (task 1527 — a step action
  // used to also close the checklist for good via onClose(), which was a
  // separate, earlier bug this function already fixed).
  // `hideBoard` additionally hides the board locally (no persistence) for
  // steps that navigate the user away to finish the step elsewhere; the
  // board reappears on the next drive mount because `seen` stayed
  // unchanged.
  //
  // The next `tourCompleted` set is computed here, outside the setState
  // updater, and written once — StrictMode double-invokes updater
  // functions, which previously fired setPreference twice per call.
  const markTourStepDone = useCallback((id: string, opts?: { hideBoard?: boolean }) => {
    if (!tourPrefLoadedRef.current) {
      // Real preference not read yet — never persist defaults over it.
      pendingTourStepsRef.current.add(id)
      setTourCompleted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    } else if (!tourCompleted.has(id)) {
      const next = new Set(tourCompleted)
      next.add(id)
      setTourCompleted(next)
      setPreference('welcome_tour', {
        seen: tourSeenRef.current,
        completed: [...next],
      }).catch(() => {})
    }
    if (opts?.hideBoard) setTourOpen(false)
  }, [tourCompleted])

  // The 2FA step's "done" state is derived from the account's real
  // totp_enabled flag rather than tracked manually — clicking "Set up 2FA"
  // only navigates to the setup page, it doesn't mean 2FA got enabled
  // (task 1527). Merge that live signal into the persisted completed set
  // for display; `security` is deliberately never written into
  // `tourCompleted` itself.
  const tourCompletedForDisplay = useMemo(() => {
    if (!user?.totp_enabled) return tourCompleted
    const next = new Set(tourCompleted)
    next.add('security')
    return next
  }, [tourCompleted, user?.totp_enabled])
  const [pausedUploads, setPausedUploads] = useState<UploadState[]>([])
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false)

  // ─── Offline cache state ─────────────────────────────
  // The "is the drive serving cached data right now?" flag lives in
  // DriveDataContext (isOffline / setOffline). The DriveLayout reads it to
  // render the offline banner so the indicator is consistent across routes.
  //
  // Inline banner for a failed initial list load when no cache is available.
  // Surfaced beside the file grid with a Try again button so the user is not
  // stranded on an empty page after a flaky load.
  const [loadError, setLoadError] = useState<string | null>(null)

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
  // Tracked via ref so fetchFiles/refreshFromSync can read the current map
  // when persisting to the offline cache without listing the names in their
  // dep arrays (which would re-run them on every decrypted name update).
  const externalDecryptedNamesRef = useRef(externalDecryptedNames)
  useEffect(() => {
    externalDecryptedNamesRef.current = externalDecryptedNames
  }, [externalDecryptedNames])

  // ─── Duplicate-file conflict dialog ─────────────────
  type ResolvedUpload = { file: File; replaceFileId?: string; finalName?: string; conflictCreated?: boolean }
  interface PendingConflictUpload {
    conflicts: ConflictItem[]
    autoVersioned: ResolvedUpload[]
    nonConflicting: File[]
    allFiles: File[]
  }
  const [pendingConflict, setPendingConflict] = useState<PendingConflictUpload | null>(null)

  // ─── Smart folder suggestion state ───────────────────
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
  const [dedupWarning, setDedupWarning] = useState<DedupWarning | null>(null)

  // ─── Storage quota state (from shared DriveDataContext) ──────────────────
  const storageUsage: StorageUsage | null = driveUsage
  const [showUpgradeNudge, setShowUpgradeNudge] = useState(false)

  // ─── File activity feed (for FileDetailsPanel right rail) ────────────────
  const [fileActivity, setFileActivity] = useState<FileActivityEntry[]>([])

  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? undefined
  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null

  // Ref-tracked sync.ready so fetchFiles/refreshFromSync can read the current
  // value without listing it as a dep (which would re-create the callbacks and
  // re-fire the useEffect on every sync state transition, causing API storms).
  const syncReadyRef = useRef(sync.ready)
  useEffect(() => { syncReadyRef.current = sync.ready }, [sync.ready])

  // Ref-tracked sync.treeComplete (task 1700). Declared BEFORE the treeVersion
  // effect below so a render that flips both (snapshot merged) always updates
  // this ref before refreshFromSync runs.
  const syncTreeCompleteRef = useRef(sync.treeComplete)
  useEffect(() => { syncTreeCompleteRef.current = sync.treeComplete }, [sync.treeComplete])

  // Current rows / folder, readable from refreshFromSync and WS handlers
  // without adding them to callbacks' dep arrays (task 1700 no-clobber +
  // scoping checks).
  const filesRef = useRef<DriveFile[]>([])
  useEffect(() => { filesRef.current = files }, [files])
  const currentParentIdRef = useRef<string | null>(null)
  useEffect(() => { currentParentIdRef.current = currentParentId ?? null }, [currentParentId])

  // Navigation scope for the delayed actions below (review S2): route + folder.
  // A timer scheduled for one scope must never fire against another — the
  // scope is re-checked at fire time and pending runs are cancelled on change.
  const syncScopeRef = useRef('')
  const emptyConfirmTimer = useRef(createScopedTimer(() => syncScopeRef.current)).current
  const wsRefetchTimer = useRef(createScopedTimer(() => syncScopeRef.current)).current
  // Empty-derive confirmation (task 1700): an all-empty derive from the tree
  // is deferred briefly so a delete+create burst cannot flash EmptyDrive.
  const emptyConfirmedRef = useRef(false)
  useEffect(() => {
    syncScopeRef.current = `${location.pathname}|${currentParentId ?? ''}`
    // Scope change or unmount: drop delayed actions that belong to the old view.
    return () => {
      emptyConfirmTimer.cancel()
      wsRefetchTimer.cancel()
    }
  }, [location.pathname, currentParentId, emptyConfirmTimer, wsRefetchTimer])

  // Sync nodes (snapshot) carry no has_large_thumbnail; GET /files does. Keep
  // every value we have seen so a sync-sourced refresh cannot silently demote
  // the preview to the medium thumbnail (see lib/sync-thumb-flags.ts).
  const knownLargeThumbRef = useRef(new Map<string, boolean>())
  const withKnownLargeThumbs = useCallback((next: DriveFile[]): DriveFile[] => {
    const out = applyKnownLargeThumbFlags(next, knownLargeThumbRef.current)
    recordLargeThumbFlags(knownLargeThumbRef.current, out)
    return out
  }, [])

  // Sync nodes carry a storage_pool_id but no storage_location; GET /files
  // carries the location. Learn pool -> location from API rows so a
  // sync-derived refresh keeps each row's real country (task 1919, 2050; see
  // lib/sync-storage-locations.ts). A pool never seen stays unknown.
  const poolLocationsRef = useRef(new Map<string, unknown>())

  // Task 2237b: sync nodes carry no attribution (who added a row to a shared
  // folder), GET /files does. Learn it from API rows and overlay it, so a
  // guest's file pushed over the stream opens through the shared-folder path
  // without a reload; a row the API never described is looked up, bounded
  // (see lib/row-attribution.ts).
  const rowAttributionRef = useRef(new Map<string, RowAttribution>())
  const listingInFlightRef = useRef(false)
  const [attributionRefresher] = useState(() => createAttributionRefresher({
    known: rowAttributionRef.current,
    getFile,
    listFolder: () => listAllFiles(currentParentIdRef.current ?? undefined),
    onLearned: () => refreshFromSyncRef.current(),
    listingInFlight: () => listingInFlightRef.current,
  }))
  useEffect(() => () => attributionRefresher.reset(), [currentParentId, attributionRefresher])

  // Stable mapper — deps never change after mount.
  const syncNodeToDriveFile = useCallback((n: SyncNode): DriveFile => {
    // Folders hold no chunks, so the API sends them no location either.
    const location = n.is_folder ? undefined : knownPoolLocation(poolLocationsRef.current, n)
    return withAttribution({
      id: n.id,
      name_encrypted: n.name_encrypted,
      file_request_id: n.file_request_id,
      sender_ephemeral_pubkey: n.sender_ephemeral_pubkey,
      wrapped_content_key: n.wrapped_content_key,
      mime_type: n.mime_type ?? '',
      size_bytes: n.size_bytes,
      is_folder: n.is_folder,
      is_trashed: n.is_trashed,
      parent_id: n.parent_id,
      chunk_count: n.chunk_count ?? 1,
      is_starred: n.is_starred,
      has_thumbnail: n.has_thumbnail,
      has_large_thumbnail: n.has_large_thumbnail,
      version_number: n.version_number,
      created_at: n.created_at,
      updated_at: n.updated_at,
      ...(location === undefined ? {} : { storage_location: location }),
    }, rowAttributionRef.current)
  }, [])

  // refreshFromSync — reads sync.children() without an API call.
  // Used by the treeVersion effect so SSE-pushed updates don't hit the server
  // on every mutation event.
  //
  // Task 1700: this must not redraw for unrelated ops (identical derived rows
  // are skipped by signature), must not clobber a good list with an empty
  // derive while tree coverage is incomplete, and must not persist either
  // state to the offline cache.
  const refreshFromSync = useCallback(() => {
    if (!isUnlocked || !syncReadyRef.current) return
    const trashed = location.pathname === '/trash'
    const rawNodes = sync
      .children(currentParentId ?? null)
      .filter((n) => Boolean(n.is_trashed) === trashed)
    // The rows on screen may still be API rows: learn their pools' cities
    // before they are replaced by sync-derived ones.
    learnPoolLocations(poolLocationsRef.current, rawNodes, filesRef.current)
    const syncNodes = rawNodes.map(syncNodeToDriveFile)
    const nodes = withKnownLargeThumbs(syncNodes)
    const coverageComplete = syncTreeCompleteRef.current
    if (!trashed) attributionRefresher.request(rowsMissingAttribution(nodes, rowAttributionRef.current))

    const decision = decideSyncRows({
      next: nodes,
      current: filesRef.current,
      coverageComplete,
      emptyConfirmed: emptyConfirmedRef.current,
    })
    emptyConfirmedRef.current = false

    if (decision.confirmEmpty) {
      emptyConfirmTimer.schedule(EMPTY_CONFIRM_MS, () => {
        emptyConfirmedRef.current = true
        refreshFromSyncRef.current()
      })
      return
    }
    emptyConfirmTimer.cancel()
    if (!decision.apply) return

    setFiles(nodes)
    setDriveOffline(false)
    if (!trashed && coverageComplete && nodes.length > 0) {
      // Persist current decryptedNames map alongside so a cold offline reload
      // can display names without re-running the crypto bootstrap. Only a
      // complete tree may write the cache (task 1700).
      const names: Record<string, string> = {}
      for (const [id, name] of Object.entries(externalDecryptedNamesRef.current)) {
        if (typeof name === 'string') names[id] = name
      }
      void cacheFileList(currentParentId ?? null, nodes, names)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParentId, location.pathname, isUnlocked, syncNodeToDriveFile, withKnownLargeThumbs, setDriveOffline])

  // fetchFiles — triggered on folder navigation (currentParentId change).
  // When the sync engine is ready and the view is not trash, show the
  // sync snapshot immediately (no spinner) then fall through to a background
  // API call so the list is always fresh after back-navigation. This prevents
  // stale data when SSE may have missed events for the revisited folder.
  const fetchFiles = useCallback(async () => {
    if (!isUnlocked) return
    const cacheScope = getOfflineCacheScope()
    if (!isCurrentOfflineCacheScope(cacheScope)) return
    const trashed = location.pathname === '/trash'

    if (syncReadyRef.current && !trashed) {
      // Show sync snapshot immediately — drop the spinner right away.
      const syncNodes = sync
        .children(currentParentId ?? null)
        .filter((n) => !n.is_trashed)
        .map(syncNodeToDriveFile)
      const nodes = withKnownLargeThumbs(syncNodes)
      setFiles(nodes)
      setDriveOffline(false)
      setLoading(false)
      if (syncTreeCompleteRef.current && nodes.length > 0) {
        // Never cache a list derived from an incomplete tree (task 1700).
        void cacheFileList(currentParentId ?? null, nodes)
      }
      // Fall through to the API refresh — do NOT return here.
    } else {
      setLoading(true)
    }

    listingInFlightRef.current = true
    try {
      const data = withKnownLargeThumbs(await listAllFiles(currentParentId ?? undefined, { trashed }))
      learnAttribution(rowAttributionRef.current, data)
      if (!isCurrentOfflineCacheScope(cacheScope)) return
      if (syncReadyRef.current) {
        learnPoolLocations(poolLocationsRef.current, sync.children(currentParentId ?? null), data)
      }
      setFiles(data)
      setDriveOffline(false)
      setLoadError(null)
      if (!trashed) {
        if (data.length === 0) {
          // Authoritative empty list (the folder really is empty online) —
          // clear any stale cache. The no-[]-write guard in offline-cache.ts
          // exists to stop partial-tree clobbers, not genuine empties (review
          // NIT: without this, deleted rows stay visible offline up to TTL).
          void invalidateFileListCache(currentParentId ?? null)
        } else {
          // Persist alongside whatever decrypted names the previous render
          // produced — the new file set may be a superset of the cached entries.
          const names: Record<string, string> = {}
          for (const [id, name] of Object.entries(externalDecryptedNamesRef.current)) {
            if (typeof name === 'string') names[id] = name
          }
          void cacheFileList(currentParentId ?? null, data, names)
        }
      }
      setSyncedAgo(0)
    } catch (err) {
      if (!isCurrentOfflineCacheScope(cacheScope)) return
      console.error('[Drive] Failed to load files:', err)
      // 4xx errors are real failures (auth, permission, not found) — surface
      // them. Network errors (status 0, TypeError, offline navigator) and
      // transient 5xx fall back to the offline cache for this parent_id.
      const apiStatus = (err instanceof Error && 'status' in err)
        ? (err as { status?: number }).status
        : undefined
      const isNetworkOrServerError =
        !navigator.onLine ||
        apiStatus === 0 ||
        apiStatus === undefined ||
        (typeof apiStatus === 'number' && apiStatus >= 500)
      const cached = isNetworkOrServerError
        ? await getCachedFileList(currentParentId ?? null)
        : null
      // Treat stale entries as missing — task spec says > 7d entries become a
      // "couldn't load files" error rather than misleadingly old data.
      if (!isCurrentOfflineCacheScope(cacheScope)) return
      if (cached && !cached.stale) {
        setFiles(withKnownLargeThumbs(cached.files))
        setDriveOffline(true)
        setLoadError(null)
        if (Object.keys(cached.decryptedNames).length) {
          // Hydrate decrypted names so the offline cold-reload doesn't need
          // crypto bootstrap to show readable file names.
          setExternalDecryptedNames((prev) => ({ ...cached.decryptedNames, ...prev }))
        }
      } else {
        // Show an inline banner with a Try again button instead of (only)
        // toasting — the page would otherwise be a silent empty state.
        setLoadError(userFriendlyError(err))
        setFiles([])
        setDriveOffline(false)
      }
    } finally {
      listingInFlightRef.current = false
      if (isCurrentOfflineCacheScope(cacheScope)) setLoading(false)
    }
  // sync.ready intentionally read via syncReadyRef to avoid infinite re-fetch
  // loop: listing sync.ready as a dep would recreate fetchFiles on every sync
  // state transition and re-trigger this effect, hammering the API.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParentId, location.pathname, isUnlocked, syncNodeToDriveFile, withKnownLargeThumbs, setDriveOffline])

  // Latest-callback refs for the scope-guarded timers (review S2): when the
  // scope still matches, the CURRENT callback must run, not the closure from
  // when the timer was scheduled.
  const refreshFromSyncRef = useRef(refreshFromSync)
  useEffect(() => { refreshFromSyncRef.current = refreshFromSync }, [refreshFromSync])
  const fetchFilesRef = useRef(fetchFiles)
  useEffect(() => { fetchFilesRef.current = fetchFiles }, [fetchFiles])

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
  // `treeComplete` is a dep so a snapshot-absence prune (which lands while
  // coverage is still false, and is then applied by refreshFromSync's
  // no-clobber guard) is re-derived once coverage completes. PR #130 review.
  useEffect(() => {
    if (!sync.ready) return
    refreshFromSync()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.treeVersion, sync.ready, sync.treeComplete, refreshFromSync])

  // Command palette → "New …" from a page other than Drive (task 1582, PR
  // #117 review): the palette navigates here with the type in state.
  useEffect(() => {
    const id = (location.state as { newDocumentType?: NewDocumentType['id'] } | null)?.newDocumentType
    if (!id) return
    navigate(location.pathname + location.search, { replace: true, state: null })
    let t: NewDocumentType
    try {
      t = getNewDocumentType(id)
    } catch {
      return
    }
    if (t.editor === 'office' && !FEATURE_OFFICE_EDITOR) return
    setNewDocType(t)
  }, [location.state, navigate, location.pathname, location.search])

  // Deep-link into a folder when navigating from search results
  useEffect(() => {
    const state = location.state as {
      openFolderId?: string | null
      openFolderName?: string
      openFileId?: string | null
    } | null
    if (state?.openFileId) {
      // Auto-select the file so the detail panel opens
      setSelectedFileId(state.openFileId)
    }
    if (state?.openFolderId) {
      // Route through the URL (task 0839) so the full breadcrumb chain rebuilds
      // and the location is shareable / Back-navigable, instead of setting a
      // flat [root, folder] pair directly.
      navigate(`/?folder=${state.openFolderId}`, { replace: true, state: null })
    } else if (state?.openFileId) {
      // Clear location state so refreshing doesn't re-navigate
      navigate(location.pathname + location.search, { replace: true, state: null })
    }
  }, [location.state, navigate, location.pathname, location.search])

  // Deep-link via ?folder=<id> query param (used by the Quick Access sidebar
  // on the home route). Runs whenever the search string changes — the Quick
  // Access Link writes ?folder=<id>, this effect resolves the folder name and
  // sets breadcrumbs accordingly.
  const lastResolvedFolderRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isUnlocked) return
    const params = new URLSearchParams(location.search)
    const folderId = params.get('folder')

    // Palette/recent file results deep-link as ?folder=<parent>&highlight=<id>
    // (command-palette.tsx). Selecting the file opens the detail panel; for a
    // root file the parent is empty (?folder=&highlight=<id>), so apply this
    // regardless of whether folderId is set. The folder breadcrumb rebuild below
    // still runs as before.
    const highlightId = params.get('highlight')
    if (highlightId) {
      setSelectedFileId(highlightId)
      // Best-effort scroll the row into view once it renders.
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-file-id="${CSS.escape(highlightId)}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }

    // Already in sync with this folder — covers optimistic in-app navigation
    // (handleFolderOpen / breadcrumb clicks set the ref before pushing the URL),
    // so we don't fight the optimistic breadcrumbs by rebuilding them.
    if (lastResolvedFolderRef.current === folderId) return

    if (!folderId) {
      // Navigated to the drive root (e.g. Back out of every folder).
      lastResolvedFolderRef.current = null
      setBreadcrumbs([{ id: null, name: 'All files' }])
      return
    }

    let cancelled = false
    ;(async () => {
      // Rebuild the FULL breadcrumb trail by walking parent_id from the target
      // up to the root, so a pasted deep-link URL or a Back/forward jump restores
      // the complete path — not a flat [root, folder] pair (task 0839).
      const chain: { id: string | null; name: string }[] = []
      let currentId: string | null = folderId
      const MAX_DEPTH = 50
      try {
        for (let depth = 0; depth < MAX_DEPTH && currentId; depth++) {
          const file = await getFile(currentId)
          let name = 'Folder'
          try {
            const fileKey = await getFileKey(currentId)
            const decrypted = await decryptFileMetadata(fileKey, file.name_encrypted)
            if (decrypted.name) name = decrypted.name
          } catch { /* unreadable ancestor (e.g. share boundary) — keep placeholder */ }
          chain.unshift({ id: currentId, name })
          currentId = file.parent_id ?? null
        }
        if (cancelled) return
        setBreadcrumbs([{ id: null, name: 'All files' }, ...chain])
        // Mark resolved ONLY after committing the breadcrumbs. Setting it earlier
        // is unsafe: if this run is cancelled (deps changed during crypto warm-up)
        // before the commit, the next run would see ref === folderId and skip the
        // rebuild, stranding the view at root.
        lastResolvedFolderRef.current = folderId
      } catch (err) {
        if (cancelled) return
        // Target folder deleted/unshared, or an ancestor is unreadable. Fall back
        // to a flat crumb so the view is still usable.
        // eslint-disable-next-line no-console
        console.error('[drive] Failed to resolve ?folder= deep link', { folderId, err })
        setBreadcrumbs([
          { id: null, name: 'All files' },
          { id: folderId, name: 'Folder' },
        ])
        lastResolvedFolderRef.current = folderId
      }
    })()
    return () => { cancelled = true }
  }, [location.search, isUnlocked, getFileKey])

  useEffect(() => {
    getPreference<{ seen?: boolean; completed?: string[] }>('welcome_tour')
      .then((pref) => {
        // Mirror the real persisted value so markTourStepDone writes it
        // back unchanged instead of clobbering it (task 1527 fix-round).
        tourSeenRef.current = !!pref?.seen
        const merged = new Set(pref?.completed ?? [])
        const pending = pendingTourStepsRef.current
        const hasNew = [...pending].some((id) => !merged.has(id))
        pending.forEach((id) => merged.add(id))
        pending.clear()
        tourPrefLoadedRef.current = true
        setTourCompleted(merged)
        if (hasNew) {
          setPreference('welcome_tour', {
            seen: tourSeenRef.current,
            completed: [...merged],
          }).catch(() => {})
        }
        if (!pref?.seen) setTourOpen(true)
      })
      // On a failed read we never learn the real state, so we never write
      // it either: pending completions stay local to this mount.
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
  // Task 1037 — needs_plan / lapsed accounts cannot upload (quota 0 by design):
  // a clear notice instead of the generic "Not enough storage" toast.
  const { blockUpload, handlePlanError } = usePlanBlock()

  // ─── Real-time WebSocket event handling ──────────

  // File list changes: refresh on create, upload, delete, trash, restore, move, rename
  // Task 1700: once tree coverage is complete, the tree already drives the
  // visible rows (refreshFromSync above). Only events touching the watched
  // folder need an API refetch, and those are coalesced; while coverage is
  // incomplete the unconditional API fallback is kept.
  useWsEvent(
    ['file.created', 'file.uploaded', 'file.deleted', 'file.trashed', 'file.restored', 'file.moved', 'file.renamed', 'version.restored'],
    useCallback((event) => {
      if (syncReadyRef.current && syncTreeCompleteRef.current) {
        const eventData = event.data as { id?: string } | undefined
        const nodeId = eventData?.id
        if (typeof nodeId === 'string') {
          const node = sync.getNode(nodeId)
          if (node && (node.parent_id ?? null) !== currentParentIdRef.current) {
            // A parent/deeper/unrelated folder changed — its tree update
            // already landed and must not redraw this list.
            return
          }
        }
        wsRefetchTimer.schedule(500, () => fetchFilesRef.current())
        return
      }
      fetchFiles()
    }, [fetchFiles, sync]),
  )

  // Cross-client search-index pruning. The encrypted index is shared across a
  // user's clients, but `unindexFile` only ran on the client that performed the
  // delete (handleTrash / handleBulkTrash below) — so a file removed on client A
  // stayed in the index and surfaced as a stale hit in client B's search. When a
  // delete/trash event arrives for a file, prune it from the index too (the WS
  // event's `data` is `{ id }`; `unindexFile` persists via saveIndex internally).
  useWsEvent(
    ['file.deleted', 'file.trashed'],
    useCallback((event) => {
      const data = event.data as { id?: string }
      if (data.id) void unindexFile(data.id)
    }, [unindexFile]),
  )

  // Self-heal on realtime reconnect / tab refocus. The SSE sync engine has
  // gapless catch-up, but it isn't guaranteed live on every surface — a delete
  // performed on another client while this tab was disconnected/backgrounded
  // could otherwise leave a ghost row until manual navigation.
  useSelfHealRefetch(fetchFiles)

  // Star toggled on another device or by a collaborator — update in-place.
  //
  // Only while the sync engine is NOT ready. Once it is, the rows are derived
  // from the sync tree, and the tree's single realtime writer for stars is the
  // ordered `/sync/stream` connection (SyncClient.applyStarredFrame). The same
  // file.starred event also arrives here over the WebSocket, and the two
  // deliveries can be reordered against each other: a delayed older `true`
  // landing here after the newer `false` would re-star the row (PR #115
  // review). One ordered source per mode, never two.
  useWsEvent(
    ['file.starred'],
    useCallback((event) => {
      if (syncReadyRef.current) return
      // Server shape: `{ type: 'file.starred', data: { id, is_starred } }`
      // (event_bus.rs SyncEvent::FileStarred). This read `data.file_id`, which
      // the server never sends, so the handler was a silent no-op (task 1577).
      const data = event.data as { id?: string; is_starred?: boolean }
      if (typeof data.id === 'string' && typeof data.is_starred === 'boolean') {
        const id = data.id
        const isStarred = data.is_starred
        setFiles((prev) =>
          prev.map((f) =>
            f.id === id ? { ...f, is_starred: isStarred } : f,
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


  const {
    browseResume,
    HiddenResumeInput,
    handleFilesSelected,
    handleFolderFilesSelected,
    handleRetryUpload,
    handleConflictReplace,
    handleConflictKeepBoth,
    handleConflictCancel,
    queueResolvedUploads,
    handleFileDownload,
  } = useDriveUploads({
    keys,
    search,
    driveData,
    files,
    setFiles,
    uploads,
    setUploads,
    pausedUploads,
    setPausedUploads,
    uploadAbortRef,
    uploadFilesRef,
    quotaLedgerRef,
    pendingConflict,
    setPendingConflict,
    setDedupWarning,
    setRecentlyUploaded,
    markTourStepDone,
    fetchFiles,
    storageUsage,
    breadcrumbs,
    currentParentId,
    externalDecryptedNames,
    blockUpload,
    handlePlanError,
    refreshOnboarding,
  })


  // Browse files hook
  const { browse, HiddenInput } = useBrowseFiles(handleFilesSelected)
  const { browseFolder, HiddenFolderInput } = useBrowseFolders(handleFolderFilesSelected)
  const openNewFolderDialog = useCallback(() => setFolderDialogOpen(true), [])

  useEffect(() => {
    const handleUploadTrigger = () => browse()
    const handleNewFolderTrigger = () => openNewFolderDialog()
    // Command palette → "New document" etc. (task 1582). Office types are
    // re-checked against the gate here too — never trust the event's sender.
    const handleNewDocumentTrigger = (e: Event) => {
      const id = (e as CustomEvent<{ type?: NewDocumentType['id'] }>).detail?.type
      if (!id) return
      let t: NewDocumentType
      try {
        t = getNewDocumentType(id)
      } catch {
        return
      }
      if (t.editor === 'office' && !FEATURE_OFFICE_EDITOR) return
      e.preventDefault() // tells the palette Drive handled it
      setNewDocType(t)
    }
    window.addEventListener('beebeeb:upload-trigger', handleUploadTrigger)
    window.addEventListener('beebeeb:new-folder-trigger', handleNewFolderTrigger)
    window.addEventListener('beebeeb:new-document-trigger', handleNewDocumentTrigger)
    return () => {
      window.removeEventListener('beebeeb:upload-trigger', handleUploadTrigger)
      window.removeEventListener('beebeeb:new-folder-trigger', handleNewFolderTrigger)
      window.removeEventListener('beebeeb:new-document-trigger', handleNewDocumentTrigger)
    }
  }, [browse, openNewFolderDialog])

  // Resume upload handler
  const {
    displayName,
    handleCreateFolder,
    handleCreateDocument,
    handleAcceptFolderSuggestion,
    handleDismissFolderSuggestion,
    isBackupsRoot,
    summarizeBackups,
    performSingleTrash,
    handleFolderOpen,
    handleBreadcrumbNav,
    handleCancelUpload,
    buildDetailsMeta,
    handleToggleStar,
  } = useDriveCommands({
    keys,
    search,
    driveData,
    sync,
    user,
    showToast,
    navigate,
    openPreview,
    fetchFiles,
    markTourStepDone,
    refreshOnboarding,
    dismissSuggestion,
    lastResolvedFolderRef,
    files,
    setFiles,
    externalDecryptedNames,
    breadcrumbs,
    setBreadcrumbs,
    currentParentId,
    selectedFileId,
    setFileActivity,
    folderSuggestion,
    setFolderSuggestion,
    setSuggestionCreating,
    setPreviewEditFileId,
    setTrashingIds,
    setStarPulseId,
    setUploads,
    uploadAbortRef,
    uploadFilesRef,
  })
  // ─── Search re-index on rename/move (task 0843) ──────
  // The on-upload `indexFile` path never sees later renames/moves, so without
  // this the search index keeps the OLD name / OLD path until a full rebuild.

  // Build the search-index path string ("/A/B") for a destination folder by
  // walking parents up the sync tree and decrypting each name. Returns "/" for
  // the vault root. Best-effort: an unreadable ancestor is skipped.
  const buildIndexPathForParent = useCallback(async (parentId: string | null): Promise<string> => {
    const parts: string[] = []
    let currentId = parentId
    for (let depth = 0; depth < 50 && currentId; depth++) {
      const node = sync.getNode(currentId)
      if (!node) break
      try {
        const key = await getFileKey(node.id)
        const { name } = await decryptFileMetadata(key, node.name_encrypted)
        if (name && name !== 'Encrypted file') parts.unshift(name)
      } catch { /* unreadable ancestor — skip */ }
      currentId = node.parent_id ?? null
    }
    return parts.length ? `/${parts.join('/')}` : '/'
  }, [sync, getFileKey])

  // Re-index after a successful move: patch parent + recomputed path. Fire-and-
  // forget; a miss self-heals on the next reconcileFromTree (drive-layout).
  const reindexAfterMove = useCallback((ids: string[], destinationId: string | null) => {
    void buildIndexPathForParent(destinationId).then((path) => {
      for (const id of ids) void reindexFields(id, { parent: destinationId, path })
    })
  }, [buildIndexPathForParent, reindexFields])

  // ─── Move handler ─────────────────────────────────

  async function handleMoveConfirm(destinationId: string | null, _mode: 'move' | 'copy') {
    if (!moveFileId) return
    try {
      // rv-web198c P2-5: a move into a shared folder publishes its wraps.
      await moveOwnerItems({ ids: [moveFileId], destinationId, rows: files, masterKey: isUnlocked ? getMasterKey() : undefined, viewerId: user?.user_id ?? null })
      reindexAfterMove([moveFileId], destinationId)
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
      // SF-0002 review: the write-time read-only check runs first (a row whose
      // current version is still repair-sealed is refused even if it was never
      // opened). rv-web198c P2-4: a guest's or member's row is renamed under
      // ITS key, proven to open its current name; otherwise it is refused.
      await renameOwnerRow({
        fileId: renameFileId,
        file: files.find((f) => f.id === renameFileId),
        newName,
        viewerId: user?.user_id ?? null,
        residentUserId: getResidentUserId(),
        masterKey: getMasterKey(),
        getFileKey,
        getFileKeyForFile,
        readName: readFileMetadata,
      })
      void reindexFields(renameFileId, { name: newName })
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
        // Folders have no blob of their own: package the subtree as a ZIP via
        // the same path as selection + bulk Download (handleFileDownload()
        // returns early for folders, so calling it here did nothing).
        if (file.is_folder) handleBulkDownload([file.id])
        else handleFileDownload(file)
        break
      case 'trash': {
        // The root "Backups" folder holds device backups (task 0838) — gate it
        // behind an explicit warning instead of the silent one-tap trash.
        if (isBackupsRoot(file)) {
          setBackupsDeleteRequest({ kind: 'single', file })
          break
        }
        performSingleTrash(file)
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
      await moveOwnerItems({ ids, destinationId: targetFolder.id, rows: files, masterKey: isUnlocked ? getMasterKey() : undefined, viewerId: user?.user_id ?? null })
      reindexAfterMove(ids, targetFolder.id)
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
    // If the selection includes the Backups root, gate the whole batch behind
    // the warning (task 0838). Resolve immediately — the dialog drives the rest.
    const backupsRoot = files.find((f) => ids.includes(f.id) && isBackupsRoot(f))
    if (backupsRoot) {
      setBackupsDeleteRequest({ kind: 'bulk', ids })
      return
    }
    return performBulkTrash(ids)
  }

  async function performBulkTrash(ids: string[]) {
    const count = ids.length
    setTrashingIds(new Set(ids))
    return new Promise<void>((resolve) => {
      setTimeout(async () => {
        try {
          await bulkTrashFiles(ids)
          for (const id of ids) unindexFile(id)
          // Drop any trashed folders from Quick Access (no-op for unpinned ids).
          unpinFolders(ids)
          showToast({ icon: 'trash', title: 'Moved to trash', description: `${count} file${count !== 1 ? 's' : ''} moved to trash` })
          fetchFiles()
        } catch (err) {
          showToast({ icon: 'trash', title: 'Failed to trash', description: userFriendlyError(err), danger: true })
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
      await moveOwnerItems({ ids, destinationId, rows: files, masterKey: isUnlocked ? getMasterKey() : undefined, viewerId: user?.user_id ?? null })
      reindexAfterMove(ids, destinationId)
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
      return
    }
    // Bundle share (task 0417): N>1 files → ONE anonymous link over the ordered
    // set. Folders cannot be bundle items (a bundle is a flat set of files), so
    // reject a selection containing any folder before opening the dialog.
    const selected = files.filter((f) => ids.includes(f.id))
    if (selected.some((f) => f.is_folder)) {
      showToast({ icon: 'share', title: 'Folders can’t be bundled', description: 'A multi-file share link covers files only. Deselect folders and try again.' })
      return
    }
    if (selected.length < 2) {
      showToast({ icon: 'share', title: 'Nothing to share', description: 'Select at least one file to share.' })
      return
    }
    setBundleFileIds(ids)
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
        getFileKeyForFile,
        {
          onProgress: (done, tot) => setBulkZipProgress({ done, total: tot }),
          zipFilename: `beebeeb-files-${new Date().toISOString().slice(0, 10)}.zip`,
        },
        getMasterKey(),
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
      // The dedicated search shortcut now opens the command palette (task 0842).
      window.dispatchEvent(new Event('beebeeb:open-command-palette'))
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
      else openPreview(file)
    },
    onEscape: () => {
      if (showShortcuts) setShowShortcuts(false)
      // Other escape handling is done inside FileList
    },
  })

  // ─── Derived data ───────────────────────────────────

  const moveFile = files.find((f) => f.id === moveFileId) ?? null
  const renameFile = files.find((f) => f.id === renameFileId) ?? null
  // Sibling names the rename dialog must block (task 1544 finding 3) — an
  // unguarded rename into an existing name is what created the duplicate-
  // name ambiguity buildNameToFileMap() above has to defend against.
  const renameSiblingNames = renameFileId
    ? siblingLowercaseNames(files, renameFileId, (f) => externalDecryptedNames[f.id])
    : new Set<string>()

  // The file currently shown in the share dialog
  const shareFile = files.find((f) => f.id === shareFileId) ?? null

  // Bundle share (task 0417): resolve the selected ids to ordered file objects,
  // preserving the SELECTION order (positions 0..N-1 in the bundle). Filtered to
  // non-folder files that still exist.
  const bundleFiles = bundleFileIds
    .map((id) => files.find((f) => f.id === id))
    .filter((f): f is DriveFile => !!f && !f.is_folder)
    .map((f) => ({ id: f.id, name: displayName(f), size: f.size_bytes }))

  // Task 1700: while the sync client exists but its tree coverage is not
  // complete, an empty list is not proof of an empty vault — keep the boot
  // skeleton rather than rendering EmptyDrive. Only when there is nothing
  // else to show and no explicit load error.
  const syncHydrating =
    sync.ready && !sync.treeComplete && files.length === 0 && !loadError

  return (
    <DriveLayout>
      <HiddenInput />
      <HiddenFolderInput />
      <HiddenResumeInput />
      {/* Top bar */}
      {/* Top bar: breadcrumbs, presence, search, new/upload. */}
      <DriveTopBar
        breadcrumbs={breadcrumbs}
        onNavigate={handleBreadcrumbNav}
        folderId={currentParentId ?? null}
        sharedFolderIds={new Set(myShares.map((s) => s.file_id))}
        currentUserId={user?.user_id ?? null}
        officeAvailable={officeAvailable}
        frozen={isFrozen}
        uploadMenuOpen={uploadMenuOpen}
        onToggleUploadMenu={() => setUploadMenuOpen((v) => !v)}
        onNewFolder={openNewFolderDialog}
        onNewDocument={setNewDocType}
        onUpload={browse}
        onUploadFolder={browseFolder}
      />

        <DriveBanners
          pausedUploads={pausedUploads}
          onResumeSelect={browseResume}
          onDismissPaused={() => {
            for (const u of pausedUploads) removeUploadState(u.fileId)
            setPausedUploads([])
          }}
          loadError={loadError}
          onRetryLoad={fetchFiles}
          dedupWarning={dedupWarning}
          onDedupUpload={() => {
            if (!dedupWarning) return
            const { file, hash, otherFiles } = dedupWarning
            setDedupWarning(null)
            // Mark as already-acknowledged so it won't re-trigger
            recordUpload(hash, file.name)
            // Queue this file directly (skip dedup for it — already confirmed)
            queueResolvedUploads([{ file }])
            // Check remaining files through the normal pipeline
            if (otherFiles.length > 0) void handleFilesSelected(otherFiles)
          }}
          onDedupSkip={() => {
            if (!dedupWarning) return
            const { otherFiles } = dedupWarning
            setDedupWarning(null)
            // Skip this file and continue with remaining
            if (otherFiles.length > 0) void handleFilesSelected(otherFiles)
          }}
          storageUsage={storageUsage}
          accountState={driveAccountDocument?.account?.state}
          subscription={drivePlanDetails.subscription}
          onUpgrade={() => setShowUpgradeNudge(true)}
          incomingInviteCount={incomingInviteCount}
          pendingApprovalCount={pendingApprovalCount}
          pendingSharesDismissed={pendingSharesDismissed}
          onDismissPendingShares={() => setPendingSharesDismissed(true)}
          onViewPendingShares={() => navigate('/shared?tab=pending')}
          folderSuggestion={folderSuggestion}
          suggestionCreating={suggestionCreating}
          isRoot={!currentParentId}
          onAcceptSuggestion={handleAcceptFolderSuggestion}
          onDismissSuggestion={handleDismissFolderSuggestion}
        />

        <DriveFileList
          files={files}
          loading={loading}
          syncHydrating={syncHydrating}
          currentParentId={currentParentId}
          officeAvailable={officeAvailable}
          isFrozen={isFrozen}
          onUpload={browse}
          onFiles={handleFilesSelected}
          onFolderFiles={handleFolderFilesSelected}
          onNewFolder={openNewFolderDialog}
          onNewDocument={setNewDocType}
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
          recentlyUploaded={recentlyUploaded}
          onShowTrustDetails={(file) => setTrustFileId(file.id)}
          myShares={myShares}
          folderViewerCounts={folderViewerCounts}
          uploads={uploads}
          onCancelUpload={handleCancelUpload}
          onRetryUpload={handleRetryUpload}
          unlocked={isUnlocked}
          hasCryptoError={!!cryptoError}
          syncedAgo={syncedAgo}
        />

      {/* ─── Overlays ────────────────────────── */}
      <DriveCreationOverlays
        folderDialogOpen={folderDialogOpen}
        onCloseFolderDialog={() => setFolderDialogOpen(false)}
        onCreateFolder={handleCreateFolder}
        newDocType={newDocType}
        existingDocNames={files.map((f) => externalDecryptedNames[f.id]).filter((n): n is string => !!n)}
        namesReady={!loading && files.every((f) => externalDecryptedNames[f.id] !== undefined)}
        onCloseNewDocument={() => setNewDocType(null)}
        onCreateDocument={handleCreateDocument}
        backupsDeleteRequest={backupsDeleteRequest}
        files={files}
        isBackupsRoot={isBackupsRoot}
        summarizeBackups={summarizeBackups}
        onCancelBackups={() => setBackupsDeleteRequest(null)}
        onConfirmBackups={(req) => {
          setBackupsDeleteRequest(null)
          if (req.kind === 'single') performSingleTrash(req.file)
          else performBulkTrash(req.ids)
        }}
        pendingConflict={pendingConflict}
        onConflictReplace={handleConflictReplace}
        onConflictKeepBoth={handleConflictKeepBoth}
        onConflictCancel={handleConflictCancel}
      />

      <DriveFileOverlays
        selectedFile={selectedFile}
        onCloseDetails={() => setSelectedFileId(null)}
        buildDetailsMeta={buildDetailsMeta}
        fileActivity={fileActivity}
        onDownloadSelected={(file) => {
          if (file.is_folder) handleBulkDownload([file.id])
          else void handleFileDownload(file)
        }}
        onShareSelected={(file) => {
          setShareFileId(file.id)
          setSelectedFileId(null)
        }}
        onStarSelected={(file) => void handleToggleStar(file.id)}
        onMoveSelected={(file) => {
          setMoveFileId(file.id)
          setSelectedFileId(null)
        }}
        onTrashSelected={(file) => {
          handleFileAction('trash', file)
          setSelectedFileId(null)
        }}
        onVersionHistorySelected={(file) => {
          if (file.is_folder) return
          setVersionFileId(file.id)
          setSelectedFileId(null)
        }}
        onPreviewSelected={(file) => {
          if (file.is_folder) return
          openPreview(file)
          setSelectedFileId(null)
        }}
        onNoteUpdated={(fileId, encrypted) => {
          setFiles((prev) =>
            prev.map((f) => (f.id === fileId ? { ...f, note_encrypted: encrypted } : f)),
          )
        }}
        previewFile={previewFile}
        externalDecryptedNames={externalDecryptedNames}
        previewEditFileId={previewEditFileId}
        onClosePreview={() => {
          setPreviewEditFileId(null)
          closePreview()
        }}
        files={files}
        onOpenPreview={openPreview}
        onDeletePreview={performSingleTrash}
        trustFileId={trustFileId}
        onCloseTrust={() => setTrustFileId(null)}
        displayName={displayName}
        shareFileId={shareFileId}
        shareFile={shareFile}
        onCloseShare={() => setShareFileId(null)}
        onShareCreated={() => {
          // Advance onboarding context (first_share_done might now be true)
          void refreshOnboarding()
          // Refresh share indicators on file rows.
          void fetchMyShares()
        }}
        bundleFiles={bundleFiles}
        onCloseBundle={() => setBundleFileIds([])}
        manageSharesFileId={manageSharesFileId}
        onCloseManageShares={() => setManageSharesFileId(null)}
        myShares={myShares}
        currentParentId={currentParentId ?? null}
        onCreateNewShare={(file) => setShareFileId(file.id)}
        onSharesRevoked={() => { void fetchMyShares() }}
        moveFileId={moveFileId}
        moveFile={moveFile}
        onCloseMove={() => setMoveFileId(null)}
        onMoveConfirm={handleMoveConfirm}
        bulkMoveOpen={bulkMoveOpen}
        bulkMoveIds={bulkMoveIds}
        onCloseBulkMove={() => { setBulkMoveOpen(false); setBulkMoveIds([]) }}
        onBulkMoveConfirm={handleBulkMoveConfirm}
        renameFileId={renameFileId}
        renameFile={renameFile}
        onCloseRename={() => setRenameFileId(null)}
        onRenameConfirm={handleRenameConfirm}
        renameSiblingNames={renameSiblingNames}
        versionFileId={versionFileId}
        onCloseVersionHistory={() => setVersionFileId(null)}
        onVersionRestored={fetchFiles}
      />

      <DriveGuideOverlays
        tourOpen={tourOpen}
        onCloseTour={() => {
          setTourOpen(false)
          // Skip for now / Close is one of the two places allowed to set
          // seen:true (task 1527 fix-round) — update the mirror ref too so
          // a later markTourStepDone (e.g. the next upload) writes it back
          // as true instead of reverting to whatever was last fetched.
          tourSeenRef.current = true
          setPreference('welcome_tour', {
            seen: true,
            completed: [...tourCompleted],
          }).catch(() => {})
        }}
        onUpload={browse}
        tourCompletedForDisplay={tourCompletedForDisplay}
        markTourStepDone={markTourStepDone}
        showUpgradeNudge={showUpgradeNudge}
        storageUsage={storageUsage}
        subscription={drivePlanDetails.subscription ?? null}
        onCloseUpgrade={() => setShowUpgradeNudge(false)}
        previewOpen={previewFile !== null}
        showShortcuts={showShortcuts}
        onToggleShortcuts={() => setShowShortcuts((v) => !v)}
        onCloseShortcuts={() => setShowShortcuts(false)}
      />
    </DriveLayout>
  )
}
