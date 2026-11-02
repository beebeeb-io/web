// The drive's upload queue, conflict resolution, and progress.
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { mintUploadIdentity } from '../../lib/upload-identity'
import { useToast } from '../../components/toast'
import { useBrowseFiles, type FolderFile } from '../../components/upload-zone'
import type { UploadItem } from '../../components/upload-progress'
import type { DriveFile, StorageUsage } from '../../lib/api'
import type { DedupWarning } from './drive-banners'
import type { useKeys } from '../../lib/key-context'
import type { useSearchIndex } from '../../hooks/use-search-index'
import type { useDriveData } from '../../lib/drive-data-context'
import type { usePlanBlock } from '../../hooks/use-plan-block'
import type { useOnboarding } from '../../lib/onboarding-context'
import type { UploadQuotaLedger, QuotaCheckItem } from '../../lib/upload-quota'
import type { SharedFolderUploadContext } from '../../lib/encrypted-upload'
import type { UploadState } from '../../lib/upload-resume'
import { computeFingerprint, findByFingerprint, planResume, pausedRowCheckFailedMessage, PausedVersionRefusedError, removeUploadState } from '../../lib/upload-resume'
import { hashFile, checkDuplicate, recordUpload } from '../../lib/upload-dedup'
import { encryptedUpload } from '../../lib/encrypted-upload'
import { encryptedDownload } from '../../lib/encrypted-download'
import { createOwnerFolder } from '../../lib/owner-upload-key'
import { encryptFileMetadata, serializeEncryptedBlob } from '../../lib/crypto'
import { getFile } from '../../lib/api'
import { assertCurrentVersionWritable } from '../../lib/owner-write-guard'
import { lookupOwnRow } from '../../lib/stored-row'
import { getUniqueName, type ConflictItem } from '../../components/duplicate-file-dialog'
import { formatBytes } from '../../lib/format'
import { noCardTrialStatus, trialCapShortfallNotice } from '../../lib/no-card-trial'
import { requiredQuotaBytes } from '../../lib/upload-quota'
import { buildNameToFileMap as buildNameToFileMapPure } from '../../lib/name-collision'
import { resolveParentUploadContext, sharedParentFailureMessage } from '../../lib/shared-parent-context'
import { UploadRestartFailedError } from '../../lib/upload-session-reinit'
import { userFriendlyError } from '../../lib/user-friendly-error'
import { inferMimeFromName } from '../../lib/mime-from-name'
import { getRemainingBytes } from '../../components/quota-warning'

export type ResolvedUpload = { file: File; replaceFileId?: string; finalName?: string; conflictCreated?: boolean }

export interface PendingConflictUpload {
  conflicts: ConflictItem[]
  autoVersioned: ResolvedUpload[]
  nonConflicting: File[]
  allFiles: File[]
}

export interface DriveUploadsParams {
  keys: ReturnType<typeof useKeys>
  search: ReturnType<typeof useSearchIndex>
  driveData: ReturnType<typeof useDriveData>
  files: DriveFile[]
  setFiles: Dispatch<SetStateAction<DriveFile[]>>
  uploads: UploadItem[]
  setUploads: Dispatch<SetStateAction<UploadItem[]>>
  pausedUploads: UploadState[]
  setPausedUploads: Dispatch<SetStateAction<UploadState[]>>
  uploadAbortRef: MutableRefObject<Map<string, AbortController>>
  uploadFilesRef: MutableRefObject<Map<string, File>>
  quotaLedgerRef: MutableRefObject<UploadQuotaLedger>
  pendingConflict: PendingConflictUpload | null
  setPendingConflict: Dispatch<SetStateAction<PendingConflictUpload | null>>
  setDedupWarning: Dispatch<SetStateAction<DedupWarning | null>>
  setRecentlyUploaded: Dispatch<SetStateAction<Set<string>>>
  markTourStepDone: (id: string, opts?: { hideBoard?: boolean }) => void
  fetchFiles: () => Promise<void>
  storageUsage: StorageUsage | null
  breadcrumbs: { id: string | null; name: string }[]
  currentParentId: string | undefined
  externalDecryptedNames: Record<string, string | null>
  blockUpload: ReturnType<typeof usePlanBlock>['blockUpload']
  handlePlanError: ReturnType<typeof usePlanBlock>['handlePlanError']
  refreshOnboarding: ReturnType<typeof useOnboarding>['refresh']
}

export function useDriveUploads(params: DriveUploadsParams) {
  const {
    keys,
    search,
    driveData,
    files,
    setUploads,
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
  } = params
  const { getFileKey, getMasterKey, getFileKeyForFile, getResidentUserId, isUnlocked, cryptoReady } = keys
  const { indexFile } = search
  const { refreshUsage: refreshDriveUsage } = driveData
  const noCardTrial = noCardTrialStatus(driveData.accountDocument)
  const { showToast } = useToast()
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

      setPausedUploads((prev) => prev.filter((u) => u.fileId !== match.fileId))

      // L13 (SF-0001): only a session this client minted may be resumed. A
      // record from before the marker (its id may be the server's) restarts —
      // never resumed, never left looping on the old id. `planResume` is the
      // same rule encryptedUpload applies: a paused new version of a live row
      // restarts as a version of it with that row's own stored name; one whose
      // row is gone is refused (nothing uploaded); anything else restarts under
      // a fresh id. Its row is not abandoned file-wide (that could end another
      // device's live upload); the server's lease sweep ends the stale session.
      try {
        const recordKey = await getFileKey(match.fileId)
        let plan: Awaited<ReturnType<typeof planResume>>
        try {
          plan = await planResume(match, {
            mintId: () => crypto.randomUUID(),
            lookupRow: (id) => lookupOwnRow(id, recordKey),
          })
        } catch (err) {
          // The row check could not answer (401 / 403 / 410, no connection, a
          // crypto worker error). Nothing was uploaded and the record is KEPT:
          // it goes back on the paused banner, where Dismiss removes it, and
          // the toast says why. Never a "Queued" card that silently loops.
          setUploads((prev) => prev.filter((u) => u.id !== uploadId))
          setPausedUploads((prev) => (prev.some((u) => u.fileId === match.fileId) ? prev : [...prev, match]))
          showToast({ icon: 'upload', title: 'Upload not restarted', description: pausedRowCheckFailedMessage(err), danger: true })
          continue
        }
        if (plan.kind === 'refuse') {
          await removeUploadState(match.fileId)
          setUploads((prev) => prev.filter((u) => u.id !== uploadId))
          showToast({ icon: 'upload', title: 'Upload not restarted', description: userFriendlyError(new PausedVersionRefusedError(plan.reason)), danger: true })
          continue
        }
        // F7 (SF-0001 round 5): a paused upload into a folder shared WITH this
        // user is a member's upload: it must carry that folder's upload
        // context, so the file key is wrapped for the owner and members. When
        // that context cannot be resolved, nothing is uploaded (never an
        // unwrapped file in a shared folder): the record is KEPT, back on the
        // paused banner (Dismiss removes it), and the toast says why.
        let sharedFolderContext: SharedFolderUploadContext | undefined
        try {
          const parent = await resolveParentUploadContext(match.parentId, getMasterKey())
          sharedFolderContext = parent.kind === 'member' ? parent.context : undefined
        } catch (err) {
          setUploads((prev) => prev.filter((u) => u.id !== uploadId))
          setPausedUploads((prev) => (prev.some((u) => u.fileId === match.fileId) ? prev : [...prev, match]))
          showToast({ icon: 'upload', title: 'Upload not restarted', description: sharedParentFailureMessage(err), danger: true })
          continue
        }
        if (plan.kind !== 'resume') {
          showToast({
            icon: 'upload',
            title: 'Upload restarted',
            description: plan.kind === 'restart-version'
              ? `${file.name} was started by an older version, so it uploads again from the start as a new version of the same file.`
              : `${file.name} was started by an older version, so it uploads again as a new file.`,
          })
        }
        const fileKey = plan.fileId === match.fileId ? recordKey : await getFileKey(plan.fileId)
        let resumeStartedAt: number | undefined
        await encryptedUpload(
          file,
          plan.fileId,
          fileKey,
          getMasterKey(),
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
                      storageCountry: p.country ?? undefined,
                      startedAt: resumeStartedAt,
                    }
                  : u,
              ),
            )
          },
          // The record's id while the upload stays on it (a resume, or a
          // legacy replace restarting as a version of its row); none for a
          // fresh id (encryptedUpload then drops the old record as another id's).
          plan.resumeFileId,
          // A member's upload into a folder shared with this user (F7).
          sharedFolderContext,
          undefined,
          // A version restart sends the row's own stored name, byte for byte.
          plan.kind === 'restart-version' ? { replaceOf: plan.replaceOf } : undefined,
        )
        setUploads((prev) => prev.filter((u) => u.id !== uploadId))
        showToast({ icon: 'check', title: plan.kind === 'resume' ? 'Upload resumed' : 'Uploaded', description: file.name })
        fetchFiles()
      } catch (err) {
        // Task 1589: the server swept this paused upload (its lease expired)
        // and a fresh start failed too. encryptedUpload already dropped the
        // dead IndexedDB entry, so the banner will not offer it again — say
        // so plainly and drop the row instead of leaving it "Queued" forever.
        if (err instanceof UploadRestartFailedError) {
          showToast({
            icon: 'upload',
            title: 'Paused upload expired',
            description: `${file.name}: ${userFriendlyError(err)}`,
            danger: true,
          })
          setUploads((prev) => prev.filter((u) => u.id !== uploadId))
          continue
        }
        // Refused inside encryptedUpload (its own row check): the record is
        // already gone, so drop the row too and say why.
        if (err instanceof PausedVersionRefusedError) {
          showToast({ icon: 'upload', title: 'Upload not restarted', description: userFriendlyError(err), danger: true })
          setUploads((prev) => prev.filter((u) => u.id !== uploadId))
          continue
        }
        showToast({
          icon: 'upload',
          title: 'Resume failed',
          description: userFriendlyError(err),
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
  // Delegates to the shared, unit-tested helper (task 1544 finding 3): a
  // decrypted name shared by more than one file is AMBIGUOUS and is left
  // out of the map, rather than silently resolving to whichever file
  // iterated last.
  function buildNameToFileMap(): Map<string, DriveFile> {
    return buildNameToFileMapPure(files, (file) => externalDecryptedNames[file.id])
  }

  function shouldAutoVersionUpload(existingFile: DriveFile, incomingFile: File): boolean {
    const existingName = externalDecryptedNames[existingFile.id] ?? existingFile.name_encrypted
    const existingMime = existingFile.mime_type || inferMimeFromName(existingName)
    const incomingMime = incomingFile.type || inferMimeFromName(incomingFile.name)
    const sameType = !existingMime || !incomingMime || existingMime.toLowerCase() === incomingMime.toLowerCase()
    // Same name + same type → always auto-version (regardless of size).
    // Same name + different type → show dialog (ambiguous intent).
    return sameType
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

    // ─── Quota check (task 1544 findings 1 + 2) ───────────
    // Runs HERE — after conflict/auto-version resolution — so a
    // version-replace (auto-version, or explicit "Replace" from the
    // conflict dialog) is credited the existing file's size, mirroring the
    // server's replace-credit logic (uploads.rs:495-513). A "Keep both"
    // upload gets no credit — it creates a new file, same as the server.
    //
    // Checked against the ledger, not the raw exceedsQuota — storageUsage
    // is React state that only updates after a fetch/refresh completes, so
    // a SECOND call to this function (e.g. the dedup-warning banner's
    // "Upload anyway", which queues the confirmed file directly and routes
    // the rest through handleFilesSelected moments later) would otherwise
    // check against the exact same stale snapshot as the first call and
    // both could pass independently while together exceeding quota
    // (finding 2a). requiredQuotaBytes/the ledger's reserve() also clamp
    // each item's replace-credit to itself, never letting a shrinking
    // replacement fund a sibling upload in the same batch (finding 2b) —
    // doEncryptedUpload below runs once per item, independently.
    const remaining = getRemainingBytes(storageUsage?.used_bytes, storageUsage?.plan_limit_bytes)
    const quotaItems: QuotaCheckItem[] = resolved.map((r) => ({
      sizeBytes: r.file.size,
      replacedSizeBytes: r.replaceFileId
        ? files.find((f) => f.id === r.replaceFileId)?.size_bytes
        : undefined,
    }))
    if (quotaLedgerRef.current.wouldExceed(quotaItems, remaining)) {
      const needed = requiredQuotaBytes(quotaItems)
      const effectiveRemaining = Math.max(0, (remaining ?? 0) - quotaLedgerRef.current.reservedBytes)
      // Task 1757: inside a no-card trial the limit is the trial's cap, and the way past it is
      // to subscribe, so say that instead of the allowance-flavoured generic line.
      const trialNotice = trialCapShortfallNotice(noCardTrial, needed, effectiveRemaining, 'upload')
      showToast(
        trialNotice
          ? { icon: 'shield', ...trialNotice, danger: true }
          : {
              icon: 'shield',
              title: 'Not enough storage',
              description: `This upload needs ${formatBytes(needed)} but you only have ${formatBytes(effectiveRemaining)} remaining.`,
              href: '/billing',
              danger: true,
            },
      )
      return
    }

    // Task 1527: the welcome checklist's "upload" step is done once a file
    // is genuinely enqueued here — not when the picker merely opens (the
    // previous bug marked it done on click, even if the user cancelled).
    // This is the one place every upload path (direct, dedup-resolved,
    // conflict-resolved, auto-versioned, drag-drop) converges before
    // encryption starts, so it covers all of them.
    markTourStepDone('upload')

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
      // Reserve this item's (clamped) quota cost against the ledger NOW,
      // before doEncryptedUpload's async work even starts — release() is
      // called by its success/failure paths below once this specific
      // upload settles (task 1544 finding 2a).
      quotaLedgerRef.current.reserve(uploadId, quotaItems[i])
      // For "Keep both", create a renamed File object so encryptedUpload
      // encrypts the new name (not the original).
      const fileToUpload =
        r.finalName && r.finalName !== r.file.name
          ? new File([r.file], r.finalName, { type: r.file.type })
          : r.file
      uploadFilesRef.current.set(uploadId, fileToUpload)
      doEncryptedUpload(uploadId, fileToUpload, r.replaceFileId, r.conflictCreated === true)
    })
  }

  async function handleFilesSelected(selectedFiles: File[]) {
    if (selectedFiles.length > 0 && blockUpload()) return
    // Quota is checked in queueResolvedUploads, AFTER conflict/auto-version
    // resolution — see task 1544 finding 1. Checking here (before we know
    // which files will replace an existing one) rejects same-size version
    // uploads at 0 remaining quota that the server would allow.

    // ─── Smart duplicate detection (session-based, pre-encryption) ────────
    // Hash each file with SHA-256 and check against files already uploaded
    // this session. We check one duplicate at a time — if the user hits
    // "Skip", we continue checking the rest. "Upload anyway" proceeds for
    // that file and records the hash.
    const toCheck = [...selectedFiles]
    const cleared: File[] = []
    for (const f of toCheck) {
      let hash: string | null
      try {
        hash = await hashFile(f)
      } catch {
        // Hash failed (memory, permissions) — pass through without a check
        cleared.push(f)
        continue
      }
      if (hash === null) {
        // File exceeds DEDUP_HASH_MAX_BYTES — skip the dedup check rather
        // than buffer the whole file into memory (task 1544 finding 4).
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
        return { file: c.newFile, finalName, conflictCreated: true }
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
  async function doEncryptedUpload(uploadId: string, file: File, replaceFileId?: string, conflictCreated = false) {
    if (!isUnlocked || !cryptoReady) {
      showToast({
        icon: 'lock',
        title: 'Vault is locked',
        description: 'Log in again to unlock encryption before uploading.',
        danger: true,
      })
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
      uploadFilesRef.current.delete(uploadId)
      // Never started — nothing to hold reserved (task 1544 finding 2a).
      quotaLedgerRef.current.release(uploadId)
      return
    }

    // Replace mode uses the existing file's ID for versioning; a create
    // proposes the id core minted for it (L13), never a JS-made one.
    const identity = replaceFileId ? null : await mintUploadIdentity(getMasterKey(), 'owner')
    const fileId = replaceFileId ?? identity!.idText
    const fileKey = identity?.fileKey ?? (await getFileKey(fileId))

    const abortController = new AbortController()
    uploadAbortRef.current.set(uploadId, abortController)

    try {
      if (replaceFileId) {
        // SF-0002 review: the row may be read-only from its CONTENT alone; a
        // version gate needs chunk 0 checked, not only a mark set on open.
        const row = files.find((f) => f.id === replaceFileId) ?? (await getFile(replaceFileId))
        await assertCurrentVersionWritable(row, getMasterKey(), {
          viewerId: getResidentUserId(),
          signal: abortController.signal,
        })
      }
      // Replace: the existing file's current name, whose recorded pin decides
      // the format of the new version (task 1943). Read from the listing, or
      // from the server when the row is not loaded here; a new file has none.
      const replaceOf = replaceFileId
        ? {
            nameEncrypted:
              files.find((f) => f.id === replaceFileId)?.name_encrypted
              ?? (await getFile(replaceFileId)).name_encrypted,
          }
        : undefined
      let uploadStartedAt: number | undefined
      const uploadedFile = await encryptedUpload(file, fileId, fileKey, getMasterKey(), currentParentId, (p) => {
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
                  storageCountry: p.country ?? undefined,
                  startedAt: uploadStartedAt,
                }
              : u,
          ),
        )
      }, undefined, undefined, abortController.signal, {
        conflictCreated,
        replaceOf,
        newItemId: identity ? { idText: identity.idText, tag: identity.tag } : undefined,
      })
      const uploadedFileId = uploadedFile.id

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
      // Settled successfully — the refreshDriveUsage()/fetchFiles() calls
      // below will make storageUsage reflect this for real; drop the
      // reservation that stood in for it until now (task 1544 finding 2a).
      quotaLedgerRef.current.release(uploadId)
      setPausedUploads((prev) => prev.filter((u) => u.fileId !== fileId))
      showToast({ icon: 'check', title: 'Uploaded', description: file.name })
      // Notify sidebar badge that a file was uploaded
      window.dispatchEvent(new CustomEvent('beebeeb:file-uploaded'))
      // Record hash for duplicate detection in this session (fire-and-forget).
      // hashFile returns null for files over DEDUP_HASH_MAX_BYTES — nothing
      // to record in that case (task 1544 finding 4).
      hashFile(file)
        .then((hash) => {
          if (hash !== null) recordUpload(hash, file.name)
        })
        .catch(() => {})
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
      // Failed or cancelled — nothing changed server-side, so this
      // reservation must not linger and permanently overcount a future
      // queueResolvedUploads call (task 1544 finding 2a). Covers both
      // branches below.
      quotaLedgerRef.current.release(uploadId)
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Cancelled by user — silently remove from list, drop the cached File
        setUploads((prev) => prev.filter((u) => u.id !== uploadId))
        uploadFilesRef.current.delete(uploadId)
        return
      }
      const errorMessage = userFriendlyError(err)
      // Task 1037 — 409 plan_required / account_lapsed get the plan notice
      // (and the chooser for plan_required), not a generic "Upload failed".
      if (!handlePlanError(err)) {
        showToast({
          icon: 'upload',
          title: 'Upload failed',
          description: errorMessage,
          danger: true,
        })
      }
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
    if (blockUpload()) return
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
    if (folderFiles.length > 0 && blockUpload()) return
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
    // Unlike handleFilesSelected, a folder upload never resolves to a
    // version-replace: every folder and file below gets a fresh UUID (see
    // the creation loop below), so there is no existing file to credit
    // back — a raw totalSize > remaining comparison is correct here (task
    // 1544 finding 1 only applies to handleFilesSelected's conflict/
    // auto-version path).
    const remaining = getRemainingBytes(storageUsage?.used_bytes, storageUsage?.plan_limit_bytes)
    if (remaining !== null) {
      const totalSize = folderFiles.reduce((sum, ff) => sum + ff.file.size, 0)
      if (totalSize > remaining) {
        const trialNotice = trialCapShortfallNotice(noCardTrial, totalSize, remaining, 'folder')
        showToast(
          trialNotice
            ? { icon: 'shield', ...trialNotice, danger: true }
            : {
                icon: 'shield',
                title: 'Not enough storage',
                description: `This folder needs ${formatBytes(totalSize)} but you only have ${formatBytes(remaining)} remaining.`,
                href: '/billing',
                danger: true,
              },
        )
        return
      }
    }

    // Collect all unique folder paths from the file list, sorted by depth (parent first)
    const folderPaths = new Set<string>()
    for (const ff of folderFiles) {
      const parts = ff.relativePath.split('/')
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
        const enc = await encryptFileMetadata(folderKey, folderName)
        const nameEncrypted = await serializeEncryptedBlob(enc.nonce, enc.ciphertext)

        // Inside a shared folder its name-key wrap is published too, so guests
        // and members can read the new folder's name.
        const result = await createOwnerFolder({ nameEncrypted, parentId, folderId, nameKey: folderKey, masterKey: getMasterKey() })
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

        const uploadedFile = await encryptedUpload(ff.file, fileId, fileKey, getMasterKey(), parentId, (p) => {
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
                    storageCountry: p.country ?? undefined,
                  }
                : u,
            ),
          )
        }, undefined, undefined, undefined)

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
      const errorMessage = userFriendlyError(err)
      if (!handlePlanError(err)) {
        showToast({
          icon: 'upload',
          title: 'Folder upload failed',
          description: errorMessage,
          danger: true,
        })
      }
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
      const fileKey = await getFileKeyForFile(file)
      await encryptedDownload(
        file.id,
        fileKey,
        file.name_encrypted,
        file.mime_type ?? undefined,
        file.chunk_count,
        file.size_bytes,
        { masterKey: getMasterKey() },
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

  return {
    handleResumeFile,
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
  }
}
