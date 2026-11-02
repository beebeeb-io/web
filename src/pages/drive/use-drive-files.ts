import {useCallback, useEffect, useRef, useState} from 'react'

import {listAllFiles, getFile, listMyShares, getFolderMembers, type DriveFile, type MyShare, type SyncNode} from '../../lib/api'
import {applyKnownLargeThumbFlags, recordLargeThumbFlags} from '../../lib/sync-thumb-flags'
import {createAttributionRefresher, learnAttribution, rowsMissingAttribution, withAttribution, type RowAttribution} from '../../lib/row-attribution'
import {knownPoolLocation, learnPoolLocations} from '../../lib/sync-storage-locations'
import {cacheFileList, getCachedFileList, invalidateFileListCache, getOfflineCacheScope, isCurrentOfflineCacheScope} from '../../lib/offline-cache'
import {decideSyncRows, EMPTY_CONFIRM_MS} from '../../lib/sync-rows'
import {createScopedTimer} from '../../lib/scoped-timer'
import {userFriendlyError} from '../../lib/user-friendly-error'
import {useSync} from '../../lib/sync-context'

type DriveFilesParams = {
  isUnlocked: boolean
  sync: ReturnType<typeof useSync>
  pathname: string
  currentParentId: string | undefined
  files: DriveFile[]
  setFiles: (update: DriveFile[] | ((prev: DriveFile[]) => DriveFile[])) => void
  setLoading: (loading: boolean) => void
  setLoadError: (error: string | null) => void
  setDriveOffline: (offline: boolean) => void
  setSyncedAgo: (seconds: number) => void
  setExternalDecryptedNames: (update: (prev: Record<string, string | null>) => Record<string, string | null>) => void
  externalDecryptedNamesRef: React.MutableRefObject<Record<string, string | null>>
  userId: string | null
  myShares: MyShare[]
  setMyShares: (shares: MyShare[]) => void
  setFolderViewerCounts: (counts: Record<string, { count: number; emails: string[] }>) => void
}

/**
 * File listing for the drive page: the sync-tree derive (refreshFromSync), the
 * API fetch with the offline-cache fallback (fetchFiles), active shares and the
 * folder presence counts.
 */
export function useDriveFiles({
  isUnlocked, sync, pathname, currentParentId, files, setFiles, setLoading,
  setLoadError, setDriveOffline, setSyncedAgo, setExternalDecryptedNames,
  externalDecryptedNamesRef, userId, myShares, setMyShares, setFolderViewerCounts,
}: DriveFilesParams) {
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
  syncScopeRef.current = `${pathname}|${currentParentId ?? ''}`
  // Scope change or unmount: drop delayed actions that belong to the old view.
  return () => {
    emptyConfirmTimer.cancel()
    wsRefetchTimer.cancel()
  }
}, [pathname, currentParentId, emptyConfirmTimer, wsRefetchTimer])

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
  const trashed = pathname === '/trash'
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
}, [currentParentId, pathname, isUnlocked, syncNodeToDriveFile, withKnownLargeThumbs, setDriveOffline])

// fetchFiles — triggered on folder navigation (currentParentId change).
// When the sync engine is ready and the view is not trash, show the
// sync snapshot immediately (no spinner) then fall through to a background
// API call so the list is always fresh after back-navigation. This prevents
// stale data when SSE may have missed events for the revisited folder.
const fetchFiles = useCallback(async () => {
  if (!isUnlocked) return
  const cacheScope = getOfflineCacheScope()
  if (!isCurrentOfflineCacheScope(cacheScope)) return
  const trashed = pathname === '/trash'

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
}, [currentParentId, pathname, isUnlocked, syncNodeToDriveFile, withKnownLargeThumbs, setDriveOffline])

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
    const currentUserId = userId

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

  return {
    syncReadyRef, syncTreeCompleteRef, filesRef, currentParentIdRef, wsRefetchTimer,
    withKnownLargeThumbs, syncNodeToDriveFile, refreshFromSync, fetchFiles,
    refreshFromSyncRef, fetchFilesRef, fetchMyShares,
  }
}
