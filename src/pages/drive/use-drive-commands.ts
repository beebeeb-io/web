// The drive's command-palette command list.
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import type { DriveFile } from '../../lib/api'
import type { FileActivityEntry, FileDetailsMeta } from '../../components/file-details-panel'
import type { FolderSuggestion } from './drive-banners'
import type { UploadItem } from '../../components/upload-progress'
import type { NewDocumentType } from '../../lib/new-document'
import type { useKeys } from '../../lib/key-context'
import type { useSearchIndex } from '../../hooks/use-search-index'
import type { useDriveData } from '../../lib/drive-data-context'
import type { useSync } from '../../lib/sync-context'
import type { useAuth } from '../../lib/auth-context'
import type { useOnboarding } from '../../lib/onboarding-context'
import type { useToast } from '../../components/toast'
import { timeAgo } from '../../components/file-list'
import { createNamedOwnerFolder, folderCreateFailureToast } from '../../lib/new-folder'
import { createOwnerFolder, moveOwnerItems } from '../../lib/owner-upload-key'
import { foldName, NewDocumentNameClashError } from '../../lib/new-document'
import { blankDocumentBytes } from '../../lib/office/blank-documents'
import { FEATURE_OFFICE_EDITOR } from '../../lib/flags'
import { userFriendlyError } from '../../lib/user-friendly-error'
import { isBackupsRoot as isBackupsRootPure } from '../../lib/backups-root'
import { decryptFileMetadata, encryptFileMetadata, serializeEncryptedBlob } from '../../lib/crypto'
import { encryptedUpload } from '../../lib/encrypted-upload'
import { deleteFile, getSharesForFile, listAllFiles, listVersions, toggleStar } from '../../lib/api'

export interface DriveCommandsParams {
  keys: ReturnType<typeof useKeys>
  search: ReturnType<typeof useSearchIndex>
  driveData: ReturnType<typeof useDriveData>
  sync: ReturnType<typeof useSync>
  user: ReturnType<typeof useAuth>['user']
  showToast: ReturnType<typeof useToast>['showToast']
  navigate: NavigateFunction
  openPreview: (file: DriveFile) => void
  fetchFiles: () => Promise<void>
  markTourStepDone: (id: string, opts?: { hideBoard?: boolean }) => void
  refreshOnboarding: ReturnType<typeof useOnboarding>['refresh']
  dismissSuggestion: (key: string) => void
  lastResolvedFolderRef: MutableRefObject<string | null>
  files: DriveFile[]
  setFiles: Dispatch<SetStateAction<DriveFile[]>>
  externalDecryptedNames: Record<string, string | null>
  breadcrumbs: { id: string | null; name: string }[]
  setBreadcrumbs: Dispatch<SetStateAction<{ id: string | null; name: string }[]>>
  currentParentId: string | undefined
  selectedFileId: string | null
  setFileActivity: Dispatch<SetStateAction<FileActivityEntry[]>>
  folderSuggestion: FolderSuggestion | null
  setFolderSuggestion: Dispatch<SetStateAction<FolderSuggestion | null>>
  setSuggestionCreating: Dispatch<SetStateAction<boolean>>
  setPreviewEditFileId: Dispatch<SetStateAction<string | null>>
  setTrashingIds: Dispatch<SetStateAction<Set<string>>>
  setStarPulseId: Dispatch<SetStateAction<string | null>>
  setUploads: Dispatch<SetStateAction<UploadItem[]>>
  uploadAbortRef: MutableRefObject<Map<string, AbortController>>
  uploadFilesRef: MutableRefObject<Map<string, File>>
}

export function useDriveCommands(params: DriveCommandsParams) {
  const {
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
  } = params
  const { getFileKey, getMasterKey, getFileKeyForFile, isUnlocked, cryptoReady } = keys
  const { indexFile, unindexFile } = search
  const { refreshUsage: refreshDriveUsage, unpinFolders } = driveData
  function displayName(file: DriveFile): string {
    const cached = externalDecryptedNames[file.id]
    if (cached === undefined) return '' // pending — caller should not use this until truthy
    return cached ?? 'Encrypted file'   // null = failed
  }

  async function handleCreateFolder(name: string) {
    try {
      // The name is sealed under the key of an id minted for this folder
      // before anything is sent; with the vault locked nothing is sent
      // (src/lib/new-folder.ts). Inside a shared folder its name-key wrap is
      // published too (guests and members read the name through it).
      const result = await createNamedOwnerFolder({
        name,
        parentId: currentParentId,
        vaultReady: isUnlocked && cryptoReady,
        getFileKey: (id) => getFileKey(id),
        getMasterKey,
        seal: encryptFileMetadata,
      })

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
      showToast(folderCreateFailureToast(err))
    }
  }

  // ─── "+ New" document (task 1582) ────────────────────────────────────────
  //
  // Creates a real, valid, empty file of the chosen type in the current
  // folder through the SAME encrypted upload path as any other upload
  // (encryptedUpload: name + mime encrypted as metadata, content encrypted
  // chunk by chunk on this device). There is no plaintext fallback: with the
  // vault locked, creation is refused.
  //
  // Called synchronously from the name prompt's submit event. For Office
  // types the editor tab is opened HERE, before the first await, while the
  // browser still counts it as a user gesture — opening it after the upload
  // resolves would be eaten by the popup blocker. The tab shows a short
  // "encrypting" line until the file exists, then navigates to the editor.
  function handleCreateDocument(type: NewDocumentType, name: string): Promise<void> {
    if (!isUnlocked || !cryptoReady) {
      return Promise.reject(new Error('Your vault is locked. Log in again to unlock encryption, then try again.'))
    }
    if (type.editor === 'office' && !FEATURE_OFFICE_EDITOR) {
      return Promise.reject(new Error('The Office editor is not enabled on this device.'))
    }
    const fileId = crypto.randomUUID()
    let tab: Window | null = null
    if (type.editor === 'office') {
      tab = window.open('', `bb-office-${fileId}`)
      if (tab) {
        try {
          tab.document.title = `Creating ${name}`
          tab.document.body.style.cssText =
            'margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:14px Inter,system-ui,sans-serif;color:#6b6760;background:#fbfaf7'
          tab.document.body.textContent = `Encrypting ${name} on this device…`
        } catch {
          // Cosmetic only.
        }
      }
    }
    return (async () => {
      try {
        // Authoritative clash check against a FRESH, complete listing of the
        // folder (every page), each name decrypted now — not the on-screen
        // cache, which can lag a sibling renamed or added from another
        // device (PR #117 review). The server cannot catch this itself: it
        // only ever sees encrypted names.
        const siblings = await listAllFiles(currentParentId ?? undefined)
        const wanted = foldName(name)
        for (const f of siblings) {
          let sibling: string | null = null
          try {
            sibling = (await decryptFileMetadata(await getFileKeyForFile(f), f.name_encrypted)).name
          } catch {
            sibling = null // undecryptable: cannot clash with a name we can see
          }
          if (sibling && foldName(sibling) === wanted) {
            throw new NewDocumentNameClashError(name)
          }
        }
        const bytes = await blankDocumentBytes(type)
        const file = new File([bytes as BlobPart], name, { type: type.mimeType })
        const fileKey = await getFileKey(fileId)
        const created = await encryptedUpload(
          file,
          fileId,
          fileKey,
          getMasterKey(),
          currentParentId,
          undefined,
          undefined,
          undefined,
          undefined,
        )
        const pathPrefix = breadcrumbs.slice(1).map((b) => b.name).join('/')
        const now = new Date().toISOString()
        indexFile(created.id, {
          name,
          path: pathPrefix ? `/${pathPrefix}` : '/',
          type: type.mimeType,
          size: bytes.length,
          parent: currentParentId ?? null,
          starred: false,
          created: now,
          modified: now,
          tags: [],
        })
        window.dispatchEvent(new CustomEvent('beebeeb:file-uploaded'))
        void fetchFiles()
        void refreshDriveUsage()
        // A created file is a real first file: advance onboarding and the
        // welcome checklist's "upload" step like any upload (PR #117 review).
        markTourStepDone('upload')
        void refreshOnboarding()

        if (type.editor === 'office') {
          const url = `/office/${encodeURIComponent(created.id)}`
          if (tab && !tab.closed) {
            tab.location.replace(url)
          } else if (!window.open(url, `bb-office-${created.id}`)) {
            showToast({
              icon: 'check',
              title: `Created ${name}`,
              description: 'Your browser blocked the editor tab. Open the file from Drive to edit it.',
            })
            return
          }
        } else {
          setPreviewEditFileId(created.id)
          openPreview(created)
        }
        showToast({ icon: 'check', title: 'Created', description: name })
      } catch (err) {
        if (tab && !tab.closed) tab.close()
        if (err instanceof NewDocumentNameClashError) throw err
        throw new Error(userFriendlyError(err))
      }
    })()
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
      const enc = await encryptFileMetadata(folderKey, folderName)
      const nameEncrypted = serializeEncryptedBlob(enc.nonce, enc.ciphertext)
      const result = await createOwnerFolder({ nameEncrypted, folderId })

      // Move all matching files into it
      await moveOwnerItems({ ids: filesToMove.map((f) => f.id), destinationId: result.id, rows: filesToMove, masterKey: getMasterKey(), viewerId: user?.user_id ?? null })

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
        description: userFriendlyError(err),
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

  // ─── Backups-folder delete guard (task 0838 / 0848) ────────
  // The root folder literally named "Backups" is the device-backup root the
  // desktop/mobile engines write to (Backups/{device}/{category}/). Match by
  // decrypted name AND root position so a user's own folder called "Backups"
  // nested elsewhere is unaffected.
  //
  // The pure logic lives in src/lib/backups-root.ts (extracted for unit tests,
  // task 0848). This wrapper reads the pending-vs-resolved name from component
  // state and forwards it explicitly so the pure function stays testable.
  function isBackupsRoot(file: DriveFile): boolean {
    // externalDecryptedNames[id] is undefined at runtime when the key is absent
    // (name still pending), even though the Record type says string|null.
    // Cast to include undefined so the pure function's type accepts it.
    const name = externalDecryptedNames[file.id] as string | null | undefined
    return isBackupsRootPure(file, name)
  }

  // Cheap descendant summary from the in-memory sync tree (no network): how many
  // items live under Backups and how many top-level device folders it has.
  function summarizeBackups(backupsId: string): { deviceCount: number; itemCount: number } {
    let itemCount = 0
    let deviceCount = 0
    const queue: string[] = [backupsId]
    const seen = new Set<string>()
    while (queue.length) {
      const parentId = queue.shift() as string
      for (const child of sync.children(parentId)) {
        if (seen.has(child.id) || child.is_trashed) continue
        seen.add(child.id)
        itemCount++
        if (parentId === backupsId && child.is_folder) deviceCount++
        if (child.is_folder) queue.push(child.id)
      }
    }
    return { deviceCount, itemCount }
  }

  function performSingleTrash(file: DriveFile) {
    const trashName = displayName(file)
    setTrashingIds((prev) => new Set(prev).add(file.id))
    setTimeout(async () => {
      try {
        await deleteFile(file.id)
        showToast({ icon: 'trash', title: 'Moved to trash', description: trashName })
        unindexFile(file.id)
        // A trashed folder must not linger in Quick Access (task 0837).
        if (file.is_folder) unpinFolders([file.id])
        fetchFiles()
      } catch (err) {
        showToast({ icon: 'trash', title: 'Failed to trash', description: userFriendlyError(err), danger: true })
      } finally {
        setTrashingIds((prev) => { const next = new Set(prev); next.delete(file.id); return next })
      }
    }, 200)
  }

  function handleFolderOpen(folder: DriveFile) {
    // Idempotent: a row's single-click + double-click can both fire open, which
    // would append a duplicate breadcrumb (same id → React duplicate-key) and
    // push a redundant history entry. If we're already in this folder, no-op.
    if (currentParentId === folder.id) return
    // The URL is the source of truth for the current folder (task 0839): pushing
    // /?folder=<id> gives the browser Back button a history entry per level and
    // makes the location copy-pasteable. Set the ref so the ?folder= effect
    // treats this as already-resolved and keeps the optimistic breadcrumb below
    // instead of re-walking the chain.
    lastResolvedFolderRef.current = folder.id
    setBreadcrumbs((prev) =>
      prev[prev.length - 1]?.id === folder.id
        ? prev
        : [...prev, { id: folder.id, name: externalDecryptedNames[folder.id] ?? 'Folder' }],
    )
    navigate(`/?folder=${folder.id}`)
  }

  function handleBreadcrumbNav(index: number) {
    const next = breadcrumbs.slice(0, index + 1)
    const target = next[next.length - 1]
    lastResolvedFolderRef.current = target.id
    setBreadcrumbs(next)
    navigate(target.id ? `/?folder=${target.id}` : '/')
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
      nameEncrypted: file.name_encrypted,
      writeTarget: file,
      noteEncrypted: file.note_encrypted ?? null,
    }
  }

  async function handleToggleStar(fileId: string) {
    try {
      const result = await toggleStar(fileId)
      // Mirror into the sync tree too: the drive re-derives its rows from the
      // tree on every tree change (refreshFromSync), so a star recorded only
      // in `files` is reverted by the next re-derive (task 1577).
      sync.setNodeStarred(fileId, result.is_starred)
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
        description: userFriendlyError(err),
        danger: true,
      })
    }
  }

  return {
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
  }
}
