import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { Breadcrumb, type BreadcrumbItem } from '../components/breadcrumb'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import { SharedFolderBanner } from '../components/shared-folder-banner'
import { MemberActions } from '../components/folder-share/member-actions'
import { RenameDialog } from '../components/rename-dialog'
import { SharedRowSkeleton } from '@beebeeb/shared'
import { useToast } from '../components/toast'
import {
  listSharedFolderFiles,
  getFolderKeys,
  getFolderMembers,
  getIncomingInvites,
  getMyProfile,
  getSharedFolder,
  type DriveFile,
  type ShareInvite,
} from '../lib/api'
import { parseFolderAccessLevel, type FolderAccessLevel } from '../lib/folder-link-types'
import type { MemberContext } from '../lib/member-write'
import { memberRename, memberTrash, memberUploadFiles, writeErrorAction } from '../lib/member-write'
import { useKeys } from '../lib/key-context'
import { useAuth } from '../lib/auth-context'
import { decryptFileMetadata, zeroize } from '../lib/crypto'
import { memberFolderCustody, openFolderChild, type FolderWrapFormat } from '../lib/folder-share-crypto'
import { markCustodySeen } from '../lib/custody-memory'
import { sharedFoldersEnabled } from '../lib/use-feature-flag'
import { resolveRecipientFolderKey } from '../lib/recipient-folder-key'
import { encryptedDownload } from '../lib/encrypted-download'
import { formatBytes } from '../lib/format'

/**
 * The level a member page may offer. Custody is authoritative when the folder
 * has one; a legacy invite predates it, so its `permission` is the next best
 * evidence and the server still makes the final call on every write.
 *
 * With shared folders off the page is the one main has: read only, whatever
 * the invite's permission (rv-web198d P2-1). An `add` invite must not bring
 * member writes to a flag-off account.
 */
export function memberAccessLevel(
  shared: { access_level: string } | null,
  invite: { permission?: string } | null,
  sharedFoldersOn: boolean,
): FolderAccessLevel {
  if (shared) return parseFolderAccessLevel(shared.access_level)
  if (!sharedFoldersOn) return 'view'
  return parseFolderAccessLevel(invite?.permission)
}

export interface SharedFolderRow {
  file: DriveFile
  name: string
  mime: string | null
}

export interface UploadRow {
  name: string
  percent: number
}

export interface SharedFolderScreenProps {
  role: 'owner' | 'member'
  level: FolderAccessLevel
  displayName: string | null
  ownerEmail: string
  memberCount: number
  keyMissing: boolean
  loading: boolean
  rows: SharedFolderRow[]
  selectedId: string | null
  progress: UploadRow[]
  breadcrumbs: { id: string; name: string }[]
  rootName: string
  errorMessage: string | null
  onUpload: (files: File[]) => void
  onRename: () => void
  onDelete: () => void
  onSelect: (id: string) => void
  onNavigate: (file: DriveFile) => void
  onBreadcrumb: (index: number) => void
  onDownload: (row: SharedFolderRow) => void
}

/**
 * The presentational half of the page: everything that differs by level lives
 * here, so the markup can be asserted without a DOM.
 */
export function SharedFolderScreen({
  role,
  level,
  displayName,
  ownerEmail,
  memberCount,
  keyMissing,
  loading,
  rows,
  selectedId,
  progress,
  breadcrumbs,
  rootName,
  errorMessage,
  onUpload,
  onRename,
  onDelete,
  onSelect,
  onNavigate,
  onBreadcrumb,
  onDownload,
}: SharedFolderScreenProps) {
  const isOwner = role === 'owner'
  const editable = level === 'edit'
  return (
    <DriveLayout>
      <SharedFolderBanner ownerEmail={ownerEmail} memberCount={memberCount} isOwner={isOwner} />

      {!isOwner && displayName && (
        <div
          className="px-5 py-1.5 border-b border-line flex items-center gap-2 text-[12px] text-ink-2"
          data-testid="shared-folder-editing-as"
        >
          <Icon name="users" size={12} className="text-ink-3" />
          You're editing as {displayName}
        </div>
      )}

      <div className="px-5 py-2.5 border-b border-line flex items-center gap-2">
        <Breadcrumb
          items={[
            { id: null, name: rootName },
            ...breadcrumbs,
          ] satisfies BreadcrumbItem[]}
          onNavigate={(index) => onBreadcrumb(index - 1)}
        />
        <div className="ml-auto">
          <MemberActions
            level={level}
            onUpload={onUpload}
            onRename={onRename}
            onDelete={onDelete}
            hasSelection={selectedId !== null}
          />
        </div>
      </div>

      {errorMessage && (
        <div className="px-5 py-2 text-[12px] text-red border-b border-line" role="alert">
          {errorMessage}
        </div>
      )}

      {progress.length > 0 && (
        <div data-testid="member-upload-progress" className="px-5 py-2 border-b border-line flex flex-col gap-1.5">
          {progress.map((row) => (
            <div key={row.name} className="flex items-center gap-3 text-[12px] text-ink-2">
              <Icon name="upload" size={12} className="text-ink-3" />
              <span className="truncate flex-1">{row.name}</span>
              <span className="font-mono text-[11px] text-ink-3">{row.percent}%</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div>{Array.from({ length: 6 }, (_, i) => <SharedRowSkeleton key={i} />)}</div>
      ) : keyMissing ? (
        <div
          className="flex flex-col items-center justify-center h-full text-center py-20 px-6"
          data-testid="shared-folder-key-missing"
        >
          <div className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center bg-paper-2 border border-line">
            <Icon name="lock" size={24} className="text-ink-2" />
          </div>
          <div className="text-[15px] font-semibold text-ink mb-1">This folder can't be opened</div>
          <div className="text-[13px] text-ink-3 max-w-[380px]">
            The key for this folder was not stored correctly when it was shared, so we can't decrypt
            it. {ownerEmail ? <span className="font-mono">{ownerEmail}</span> : 'The owner'} needs to
            share it with you again.
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center py-20">
          <div
            className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--color-amber-bg)', border: '1.5px dashed var(--color-line-2)' }}
          >
            <Icon name="folder" size={24} className="text-amber-deep" />
          </div>
          <div className="text-[15px] font-semibold text-ink mb-1">Empty folder</div>
          <div className="text-[13px] text-ink-3">
            {level === 'view' ? 'No files in this folder yet' : 'Drop files here, or use Upload.'}
          </div>
        </div>
      ) : (
        <>
          {/* Column header */}
          <div
            className="px-[18px] py-2.5 border-b border-line bg-paper-2"
            style={{
              display: 'grid',
              gridTemplateColumns: '32px 1.4fr 1fr 100px 80px',
              gap: 14,
            }}
          >
            <span />
            <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Type</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
            <span />
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {rows.map((row, i, arr) => (
              <div
                key={row.file.id}
                className={`group transition-colors cursor-pointer ${
                  selectedId === row.file.id ? 'bg-amber-bg/40' : 'hover:bg-paper-2'
                }`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1.4fr 1fr 100px 80px',
                  gap: 14,
                  padding: '11px 18px',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
                }}
                onClick={() => {
                  onSelect(row.file.id)
                  if (row.file.is_folder) onNavigate(row.file)
                }}
              >
                <Icon
                  name={row.file.is_folder ? 'folder' : 'file'}
                  size={14}
                  className={row.file.is_folder ? 'text-amber-deep self-center' : 'text-ink-2 self-center'}
                />
                <span className="text-[13px] font-medium truncate self-center">{row.name}</span>
                <span className="text-[11px] text-ink-3 self-center font-mono truncate">
                  {row.file.is_folder ? 'Folder' : (row.mime ?? row.file.mime_type ?? '--')}
                </span>
                <span className="font-mono text-[11px] text-ink-3 self-center">
                  {row.file.is_folder ? '--' : formatBytes(row.file.size_bytes)}
                </span>
                <div className="flex justify-end self-center">
                  {!row.file.is_folder && (
                    <BBButton
                      size="sm"
                      variant="ghost"
                      aria-label="Download"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDownload(row)
                      }}
                    >
                      <Icon name="download" size={13} />
                    </BBButton>
                  )}
                </div>
              </div>
            ))}
          </div>
          {editable && selectedId && (
            <div className="px-5 py-1.5 border-t border-line text-[11px] text-ink-3">
              Selected: {rows.find((r) => r.file.id === selectedId)?.name ?? 'item'}
            </div>
          )}
        </>
      )}

      {/* Status bar */}
      <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3 mt-auto">
        <span className="font-mono">{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span className="flex items-center gap-1.5">
          <Icon name="shield" size={12} className="text-amber-deep" />
          End-to-end encrypted
        </span>
      </div>
    </DriveLayout>
  )
}

export function SharedFolder() {
  const { folderId } = useParams<{ folderId: string }>()
  const [searchParams] = useSearchParams()
  const inviteId = searchParams.get('invite')
  const { isUnlocked, getMasterKey } = useKeys()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [files, setFiles] = useState<DriveFile[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [decryptedMimes, setDecryptedMimes] = useState<Record<string, string>>({})
  const [folderKeyCache, setFolderKeyCache] = useState<Uint8Array | null>(null)
  // True when no stored key blob opens this folder for us (legacy invites
  // approved with the wrong key): say so instead of listing 'Encrypted file'.
  const [keyMissing, setKeyMissing] = useState(false)
  const [fileKeysMap, setFileKeysMap] = useState<Record<string, string>>({})
  // L7b: the folder's wrap format, from its custody record (read with the key).
  const [wrapFormat, setWrapFormat] = useState<FolderWrapFormat | null>(null)
  const [invite, setInvite] = useState<ShareInvite | null>(null)
  const [memberCount, setMemberCount] = useState(0)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [role, setRole] = useState<'owner' | 'member'>('member')
  const [level, setLevel] = useState<FolderAccessLevel>('view')
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([])
  const [currentParent, setCurrentParent] = useState<string | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [progress, setProgress] = useState<UploadRow[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<DriveFile | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DriveFile | null>(null)

  const fetchInvite = useCallback(async () => {
    if (!inviteId) return null
    const invites = await getIncomingInvites()
    return invites.find(i => i.id === inviteId) ?? null
  }, [inviteId])

  // The signed-in member's own name for the editing strip. A profile without a
  // display name falls back to the account's email local part.
  useEffect(() => {
    let live = true
    getMyProfile()
      .then((p) => {
        if (!live) return
        setDisplayName(p.display_name ?? p.username ?? null)
      })
      .catch(() => {
        if (!live) return
        setDisplayName(user?.email ? user.email.split('@')[0] : null)
      })
    return () => {
      live = false
    }
  }, [user?.email])

  const loadFiles = useCallback(async (parentId?: string) => {
    if (!folderId || !inviteId) return
    setLoading(true)
    try {
      let inv = invite
      if (!inv) {
        inv = await fetchInvite()
        if (inv) setInvite(inv)
      }

      const [fileList, keys, members, { shared, flagOn }] = await Promise.all([
        listSharedFolderFiles(folderId, parentId),
        getFolderKeys(inviteId),
        getFolderMembers(folderId).catch(() => ({ members: [], owner_id: '' })),
        // The format is never guessed (L7b), and legacy only when neither this
        // folder nor any ancestor was seen with custody (L7c/L7d).
        memberFolderCustody(folderId, parentId ?? folderId),
      ])
      const format: FolderWrapFormat = shared ? 'l7' : 'legacy_invite'
      setWrapFormat(format)

      if (shared) {
        setRole(shared.role)
        setLevel(parseFolderAccessLevel(shared.access_level))
      } else if (inv) {
        // A legacy folder invite predates the custody row, so the custody route
        // 404s; the invite itself carries the grant the server enforces (and
        // with the flag off, the page stays read only).
        setLevel(memberAccessLevel(null, inv, flagOn))
      }

      let fk = folderKeyCache
      if (!fk && inv) {
        const resolved = await resolveRecipientFolderKey(inv, getMasterKey(), keys, format)
        if (resolved.status === 'ok') {
          // L7d: recorded before the key is used; a failed write refuses.
          if (format === 'l7') markCustodySeen(folderId)
          fk = resolved.folderKey
          setFolderKeyCache(fk)
          setKeyMissing(false)
        } else {
          setKeyMissing(true)
        }
      }

      setFiles(fileList)
      setMemberCount(members.members.length)

      const owner = members.members.find(m => m.is_owner)
      if (owner) setOwnerEmail(owner.email)

      const keysMap: Record<string, string> = {}
      for (const k of keys) {
        keysMap[k.file_id] = k.encrypted_file_key
      }
      setFileKeysMap(keysMap)

      if (fk) {
        const names: Record<string, string> = {}
        const mimes: Record<string, string> = {}
        for (const file of fileList) {
          try {
            const encKey = keysMap[file.id]
            if (encKey && file.name_encrypted) {
              const fileKey = await openFolderChild(
                format,
                fk,
                { rootId: folderId, itemId: file.id, isFolder: !!file.is_folder },
                encKey,
              )
              // name_encrypted carries the JSON metadata envelope
              // ({name, mime_type}); decryptFileMetadata unwraps it like the
              // owner's drive does. decryptFilename would show the raw JSON.
              const meta = await decryptFileMetadata(fileKey, file.name_encrypted)
              names[file.id] = meta.name
              if (meta.mimeType) mimes[file.id] = meta.mimeType
              zeroize(fileKey)
            } else {
              names[file.id] = 'Encrypted file'
            }
          } catch {
            names[file.id] = 'Encrypted file'
          }
        }
        setDecryptedNames(names)
        setDecryptedMimes(mimes)
      }
    } catch (e) {
      showToast({ icon: 'x', title: 'Failed to load', description: e instanceof Error ? e.message : 'Could not load shared folder.', danger: true })
    } finally {
      setLoading(false)
    }
  }, [folderId, inviteId, invite, folderKeyCache, fetchInvite, getMasterKey, showToast])

  useEffect(() => {
    if (isUnlocked && folderId && inviteId) {
      loadFiles(currentParent)
    }
  }, [isUnlocked, folderId, inviteId, currentParent])

  const memberContext = useMemo<MemberContext | null>(() => {
    if (!folderId || !inviteId || !folderKeyCache || !wrapFormat) return null
    return {
      folderId,
      inviteId,
      folderKey: folderKeyCache,
      format: wrapFormat,
      level,
      displayName: displayName ?? 'You',
      masterKey: getMasterKey(),
      fileKeys: fileKeysMap,
    }
  }, [folderId, inviteId, folderKeyCache, wrapFormat, level, displayName, getMasterKey, fileKeysMap])

  /**
   * A refused write re-reads the level instead of retrying: the affordance the
   * member no longer has disappears from the same screen.
   */
  const recoverFromWrite = useCallback(async (err: unknown) => {
    if (writeErrorAction(err) === 'refetch' && folderId) {
      setSelectedId(null)
      try {
        const fresh = await getSharedFolder(folderId)
        setRole(fresh.role)
        setLevel(parseFolderAccessLevel(fresh.access_level))
      } catch {
        setLevel(memberAccessLevel(null, invite, await sharedFoldersEnabled()))
      }
      setActionError("You don't have permission to change this folder.")
      return
    }
    setActionError(err instanceof Error ? err.message : 'That change did not go through.')
  }, [folderId, invite])

  const handleUpload = useCallback(async (picked: File[]) => {
    if (!memberContext || picked.length === 0) return
    setActionError(null)
    setProgress(picked.map((f) => ({ name: f.name, percent: 0 })))
    try {
      const result = await memberUploadFiles(
        memberContext,
        currentParent ?? null,
        picked,
        (name, p) => {
          const percent =
            p.stage === 'Done' ? 100 : Math.max(0, Math.min(99, Math.round(p.progress ?? 0)))
          setProgress((prev) => prev.map((row) => (row.name === name ? { ...row, percent } : row)))
        },
      )
      if (result.added > 0) {
        showToast({
          icon: 'check',
          title: 'Uploaded',
          description: `${result.added} file${result.added !== 1 ? 's' : ''} added to this folder.`,
        })
        await loadFiles(currentParent)
      }
      if (result.failed > 0) {
        setActionError(`${result.failed} file${result.failed !== 1 ? 's' : ''} could not be uploaded.`)
      }
    } catch (err) {
      await recoverFromWrite(err)
    } finally {
      setProgress([])
    }
  }, [memberContext, currentParent, loadFiles, recoverFromWrite, showToast])

  const handleRenameConfirm = useCallback(async (newName: string) => {
    if (!memberContext || !renameTarget) return
    setActionError(null)
    try {
      await memberRename(memberContext, renameTarget, newName)
      await loadFiles(currentParent)
      showToast({ icon: 'check', title: 'Renamed', description: `Renamed to "${newName}".` })
    } catch (err) {
      await recoverFromWrite(err)
    } finally {
      setRenameTarget(null)
    }
  }, [memberContext, renameTarget, loadFiles, currentParent, recoverFromWrite, showToast])

  const handleDeleteConfirm = useCallback(async () => {
    if (!memberContext || !confirmDelete) return
    setActionError(null)
    try {
      await memberTrash(memberContext, confirmDelete)
      setSelectedId(null)
      await loadFiles(currentParent)
      showToast({ icon: 'check', title: 'Moved to Trash', description: 'Restorable for 30 days.' })
    } catch (err) {
      await recoverFromWrite(err)
    } finally {
      setConfirmDelete(null)
    }
  }, [memberContext, confirmDelete, loadFiles, currentParent, recoverFromWrite, showToast])

  function navigateToSubfolder(file: DriveFile) {
    if (!file.is_folder) return
    setBreadcrumbs(prev => [...prev, { id: file.id, name: decryptedNames[file.id] ?? 'Folder' }])
    setSelectedId(null)
    setCurrentParent(file.id)
  }

  function navigateToBreadcrumb(index: number) {
    setSelectedId(null)
    if (index < 0) {
      setBreadcrumbs([])
      setCurrentParent(undefined)
    } else {
      const crumb = breadcrumbs[index]
      setBreadcrumbs(prev => prev.slice(0, index + 1))
      setCurrentParent(crumb.id)
    }
  }

  async function handleDownload(row: SharedFolderRow) {
    if (!folderKeyCache || !wrapFormat || !folderId) return
    try {
      const encKey = fileKeysMap[row.file.id]
      if (!encKey) throw new Error('No key for this file')
      const fileKey = await openFolderChild(
        wrapFormat,
        folderKeyCache,
        { rootId: folderId, itemId: row.file.id, isFolder: false },
        encKey,
      )
      await encryptedDownload(
        row.file.id,
        fileKey,
        row.file.name_encrypted ?? '',
        row.mime ?? row.file.mime_type ?? 'application/octet-stream',
        row.file.chunk_count ?? 1,
        row.file.size_bytes ?? 0,
      )
      zeroize(fileKey)
    } catch (e) {
      showToast({ icon: 'x', title: 'Download failed', description: e instanceof Error ? e.message : 'Could not download.', danger: true })
    }
  }

  if (!folderId || !inviteId) {
    return (
      <DriveLayout>
        <div className="flex items-center justify-center h-full text-ink-3 text-sm">
          Invalid shared folder link
        </div>
      </DriveLayout>
    )
  }

  const rows: SharedFolderRow[] = files.map((file) => ({
    file,
    name: decryptedNames[file.id] ?? 'Encrypted file',
    mime: decryptedMimes[file.id] ?? null,
  }))

  const renameRow = renameTarget
    ? rows.find((r) => r.file.id === renameTarget.id) ?? null
    : null

  return (
    <>
      <SharedFolderScreen
        role={role}
        level={level}
        displayName={displayName}
        ownerEmail={ownerEmail}
        memberCount={memberCount}
        keyMissing={keyMissing}
        loading={loading}
        rows={rows}
        selectedId={selectedId}
        progress={progress}
        breadcrumbs={breadcrumbs}
        rootName={invite ? (decryptedNames[folderId] ?? 'Shared folder') : 'Shared folder'}
        errorMessage={actionError}
        onUpload={handleUpload}
        onRename={() => {
          const target = rows.find((r) => r.file.id === selectedId)
          if (target) setRenameTarget(target.file)
        }}
        onDelete={() => {
          const target = rows.find((r) => r.file.id === selectedId)
          if (target) setConfirmDelete(target.file)
        }}
        onSelect={setSelectedId}
        onNavigate={navigateToSubfolder}
        onBreadcrumb={navigateToBreadcrumb}
        onDownload={handleDownload}
      />

      <RenameDialog
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        currentName={renameRow?.name ?? ''}
        onRename={handleRenameConfirm}
        existingNames={
          new Set(
            rows
              .filter((r) => r.file.id !== renameTarget?.id)
              .map((r) => r.name.toLowerCase()),
          )
        }
      />

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setConfirmDelete(null)}>
          <div className="absolute inset-0 bg-ink/20" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Delete"
            className="relative w-full max-w-[24rem] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-xl py-lg">
              <h3 className="text-sm font-semibold text-ink mb-1">Move to Trash?</h3>
              <p className="text-[13px] text-ink-3">
                The owner can restore it from Trash for 30 days.
              </p>
            </div>
            <div className="px-xl py-md border-t border-line flex justify-end gap-2">
              <BBButton type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                Cancel
              </BBButton>
              <BBButton type="button" variant="amber" size="sm" onClick={handleDeleteConfirm}>
                Move to Trash
              </BBButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
