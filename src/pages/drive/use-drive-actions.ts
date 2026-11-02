import { useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import type { DriveFile } from '../../lib/api'
import type { BackupsDeleteRequest } from './drive-creation-overlays'
import { decryptFileMetadata, readFileMetadata } from '../../lib/crypto'
import { moveOwnerItems } from '../../lib/owner-upload-key'
import { renameOwnerRow } from '../../lib/owner-rename'
import { bulkTrashFiles, getFile } from '../../lib/api'
import { downloadAsZip, ZIP_SIZE_WARNING_BYTES } from '../../lib/bulk-download'
import { userFriendlyError } from '../../lib/user-friendly-error'

import type { useSync } from '../../lib/sync-context'
import type { useAuth } from '../../lib/auth-context'
import type { useKeys } from '../../lib/key-context'
import type { useSearchIndex } from '../../hooks/use-search-index'
import type { useDriveData } from '../../lib/drive-data-context'
import type { useToast } from '../../components/toast'

export interface DriveActionsParams {
  keys: ReturnType<typeof useKeys>
  search: ReturnType<typeof useSearchIndex>
  driveData: ReturnType<typeof useDriveData>
  sync: ReturnType<typeof useSync>
  user: ReturnType<typeof useAuth>['user']
  showToast: ReturnType<typeof useToast>['showToast']
  files: DriveFile[]
  moveFileId: string | null
  renameFileId: string | null
  bulkMoveIds: string[]
  setMoveFileId: Dispatch<SetStateAction<string | null>>
  setRenameFileId: Dispatch<SetStateAction<string | null>>
  setVersionFileId: Dispatch<SetStateAction<string | null>>
  setShareFileId: Dispatch<SetStateAction<string | null>>
  setManageSharesFileId: Dispatch<SetStateAction<string | null>>
  setBundleFileIds: Dispatch<SetStateAction<string[]>>
  setBulkMoveIds: Dispatch<SetStateAction<string[]>>
  setBulkMoveOpen: Dispatch<SetStateAction<boolean>>
  setBulkZipProgress: Dispatch<SetStateAction<{ done: number; total: number } | null>>
  setTrashingIds: Dispatch<SetStateAction<Set<string>>>
  setBackupsDeleteRequest: Dispatch<SetStateAction<BackupsDeleteRequest | null>>
  displayName: (file: DriveFile) => string
  handleFolderOpen: (folder: DriveFile) => void
  handleToggleStar: (fileId: string) => Promise<void> | void
  performSingleTrash: (file: DriveFile) => void
  handleFileDownload: (file: DriveFile) => Promise<void> | void
  openPreview: (file: DriveFile) => void
  isBackupsRoot: (file: DriveFile) => boolean
  fetchFiles: () => Promise<void>
  fetchMyShares: () => Promise<void>
}

export function useDriveActions(params: DriveActionsParams) {
  const {
    keys,
    search,
    driveData,
    sync,
    user,
    showToast,
    files,
    moveFileId,
    renameFileId,
    bulkMoveIds,
    setMoveFileId,
    setRenameFileId,
    setVersionFileId,
    setShareFileId,
    setManageSharesFileId,
    setBundleFileIds,
    setBulkMoveIds,
    setBulkMoveOpen,
    setBulkZipProgress,
    setTrashingIds,
    setBackupsDeleteRequest,
    displayName,
    handleFolderOpen,
    handleToggleStar,
    performSingleTrash,
    handleFileDownload,
    openPreview,
    isBackupsRoot,
    fetchFiles,
    fetchMyShares,
  } = params
  const { getFileKey, getMasterKey, getFileKeyForFile, getResidentUserId, isUnlocked, cryptoReady } = keys
  const { reindexFields, unindexFile } = search
  const { unpinFolders } = driveData
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

  return {
    handleMoveConfirm,
    handleRenameConfirm,
    handleFileAction,
    handleDropToFolder,
    handleBulkTrash,
    performBulkTrash,
    handleBulkMoveConfirm,
    handleBulkShare,
    handleBulkDownload,
  }
}
