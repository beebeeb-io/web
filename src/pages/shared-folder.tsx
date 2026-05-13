import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { BBButton } from '@beebeeb/shared'
import { Breadcrumb, type BreadcrumbItem } from '../components/breadcrumb'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import { SharedFolderBanner } from '../components/shared-folder-banner'
import { SharedRowSkeleton } from '@beebeeb/shared'
import { useToast } from '../components/toast'
import {
  listSharedFolderFiles,
  getFolderKeys,
  getFolderMembers,
  getIncomingInvites,
  type DriveFile,
  type ShareInvite,
} from '../lib/api'
import { useKeys } from '../lib/key-context'
import { decryptFilename, fromBase64, parseEncryptedBlob, zeroize } from '../lib/crypto'
import { decryptFolderKey, decryptChildFileKey } from '../lib/folder-share-crypto'
import { encryptedDownload } from '../lib/encrypted-download'
import { formatBytes } from '../lib/format'


export function SharedFolder() {
  const { folderId } = useParams<{ folderId: string }>()
  const [searchParams] = useSearchParams()
  const inviteId = searchParams.get('invite')
  const { isUnlocked, getMasterKey } = useKeys()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [files, setFiles] = useState<DriveFile[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [folderKeyCache, setFolderKeyCache] = useState<Uint8Array | null>(null)
  const [fileKeysMap, setFileKeysMap] = useState<Record<string, string>>({})
  const [invite, setInvite] = useState<ShareInvite | null>(null)
  const [memberCount, setMemberCount] = useState(0)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isOwner] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([])
  const [currentParent, setCurrentParent] = useState<string | undefined>(undefined)

  const fetchInvite = useCallback(async () => {
    if (!inviteId) return null
    const invites = await getIncomingInvites()
    return invites.find(i => i.id === inviteId) ?? null
  }, [inviteId])

  const decryptFolderKeyFromInvite = useCallback(async (inv: ShareInvite): Promise<Uint8Array | null> => {
    if (!inv.sender_public_key || !inv.encrypted_folder_key) return null
    return decryptFolderKey(
      getMasterKey(),
      fromBase64(inv.sender_public_key),
      inv.file_id,
      fromBase64(inv.encrypted_folder_key),
    )
  }, [getMasterKey])

  const loadFiles = useCallback(async (parentId?: string) => {
    if (!folderId || !inviteId) return
    setLoading(true)
    try {
      let inv = invite
      if (!inv) {
        inv = await fetchInvite()
        if (inv) setInvite(inv)
      }

      let fk = folderKeyCache
      if (!fk && inv) {
        fk = await decryptFolderKeyFromInvite(inv)
        if (fk) setFolderKeyCache(fk)
      }

      const [fileList, keys, members] = await Promise.all([
        listSharedFolderFiles(folderId, parentId),
        getFolderKeys(inviteId),
        getFolderMembers(folderId).catch(() => ({ members: [], owner_id: '' })),
      ])

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
        for (const file of fileList) {
          try {
            const encKey = keysMap[file.id]
            if (encKey && file.name_encrypted) {
              const fileKey = await decryptChildFileKey(fk, encKey)
              const { nonce, ciphertext: ct } = parseEncryptedBlob(file.name_encrypted)
              names[file.id] = await decryptFilename(fileKey, nonce, ct)
              zeroize(fileKey)
            } else {
              names[file.id] = file.name_encrypted ?? 'Encrypted file'
            }
          } catch {
            names[file.id] = file.name_encrypted ?? 'Encrypted file'
          }
        }
        setDecryptedNames(names)
      }
    } catch (e) {
      showToast({ icon: 'x', title: 'Failed to load', description: e instanceof Error ? e.message : 'Could not load shared folder.', danger: true })
    } finally {
      setLoading(false)
    }
  }, [folderId, inviteId, invite, folderKeyCache, fetchInvite, decryptFolderKeyFromInvite, showToast])

  useEffect(() => {
    if (isUnlocked && folderId && inviteId) {
      loadFiles(currentParent)
    }
  }, [isUnlocked, folderId, inviteId, currentParent])

  function navigateToSubfolder(file: DriveFile) {
    if (!file.is_folder) return
    setBreadcrumbs(prev => [...prev, { id: file.id, name: decryptedNames[file.id] ?? 'Folder' }])
    setCurrentParent(file.id)
  }

  function navigateToBreadcrumb(index: number) {
    if (index < 0) {
      setBreadcrumbs([])
      setCurrentParent(undefined)
    } else {
      const crumb = breadcrumbs[index]
      setBreadcrumbs(prev => prev.slice(0, index + 1))
      setCurrentParent(crumb.id)
    }
  }

  async function handleDownload(file: DriveFile) {
    if (!folderKeyCache) return
    try {
      const encKey = fileKeysMap[file.id]
      if (!encKey) throw new Error('No key for this file')
      const fileKey = await decryptChildFileKey(folderKeyCache, encKey)
      await encryptedDownload(
        file.id,
        fileKey,
        file.name_encrypted ?? '',
        file.mime_type ?? 'application/octet-stream',
        file.chunk_count ?? 1,
        file.size_bytes ?? 0,
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

  return (
    <DriveLayout>
      <SharedFolderBanner
        ownerEmail={ownerEmail}
        memberCount={memberCount}
        isOwner={isOwner}
      />

      {/* Breadcrumbs */}
      <div className="px-5 py-2.5 border-b border-line">
        <Breadcrumb
          items={[
            { id: null, name: invite ? (decryptedNames[folderId!] ?? 'Shared folder') : 'Shared folder' },
            ...breadcrumbs,
          ] satisfies BreadcrumbItem[]}
          onNavigate={(index) => navigateToBreadcrumb(index - 1)}
        />
      </div>

      {loading ? (
        <div>{Array.from({ length: 6 }, (_, i) => <SharedRowSkeleton key={i} />)}</div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center py-20">
          <div
            className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--color-amber-bg)', border: '1.5px dashed var(--color-line-2)' }}
          >
            <Icon name="folder" size={24} className="text-amber-deep" />
          </div>
          <div className="text-[15px] font-semibold text-ink mb-1">Empty folder</div>
          <div className="text-[13px] text-ink-3">No files in this folder yet</div>
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

          <div className="flex-1 overflow-y-auto">
            {files.map((file, i, arr) => (
              <div
                key={file.id}
                className="group hover:bg-paper-2 transition-colors cursor-pointer"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1.4fr 1fr 100px 80px',
                  gap: 14,
                  padding: '11px 18px',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
                }}
                onClick={() => file.is_folder && navigateToSubfolder(file)}
              >
                <Icon
                  name={file.is_folder ? 'folder' : 'file'}
                  size={14}
                  className={file.is_folder ? 'text-amber-deep self-center' : 'text-ink-2 self-center'}
                />
                <span className="text-[13px] font-medium truncate self-center">
                  {decryptedNames[file.id] ?? file.name_encrypted ?? 'Encrypted'}
                </span>
                <span className="text-[11px] text-ink-3 self-center font-mono truncate">
                  {file.is_folder ? 'Folder' : (file.mime_type ?? '--')}
                </span>
                <span className="font-mono text-[11px] text-ink-3 self-center">
                  {file.is_folder ? '--' : formatBytes(file.size_bytes)}
                </span>
                <div className="flex justify-end self-center">
                  {!file.is_folder && (
                    <BBButton
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDownload(file)
                      }}
                    >
                      <Icon name="download" size={13} />
                    </BBButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Status bar */}
      <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3 mt-auto">
        <span className="font-mono">{files.length} item{files.length !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span className="flex items-center gap-1.5">
          <Icon name="shield" size={12} className="text-amber-deep" />
          End-to-end encrypted
        </span>
      </div>
    </DriveLayout>
  )
}
