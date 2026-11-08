// Web wrapper for the shared file list (moved to @beebeeb/shared/drive-ui, desktop v2 B01): the host
// below carries web's keys, API, pins and share popover; the list itself behaves as before.
import { useMemo, useRef } from 'react'
import { FileList as SharedFileList, timeAgo, type FileListHost, type FileListProps as SharedProps } from '@beebeeb/shared/drive-ui'
import { displayNameFrom, useDecryptedNames } from './file-list/use-decrypted-names'
import { useFileThumbnails } from './file-list/use-file-thumbnails'
import { needsOwnership, classifyItemIds, isForeignItemById } from '../lib/owner-adoption'
import { useKeys } from '../lib/key-context'
import { readFileMetadata } from '../lib/crypto'
import { renameOwnerRow } from '../lib/owner-rename'
import { contentKeyBytes } from '../lib/request-row'
import { ownerWriteRefusal } from '../lib/owner-write-guard'
import { onDecrypted } from '../lib/decrypt-events'
import { setPreference } from '../lib/api'
import { useDriveData } from '../lib/drive-data-context'
import { SharePopover } from './share-popover'
import { useToast } from './toast'
import type { IconName } from '@beebeeb/shared'

/** Relative age ("3h ago"); lives in the shared drive-ui format module. */
export { timeAgo }

/**
 * True when the row was added by a different account than the viewer — a member
 * upload into a shared folder (task 2237b). Such rows carry no usable
 * master-key derivation for the viewer, so their names open through the
 * folder-key wrap instead.
 */
export function addedBySomeoneElse(
  file: { uploaded_by?: string | null; acted_via_share_id?: string | null },
  viewerId: string | null,
): boolean {
  return viewerId !== null && needsOwnership(file, viewerId)
}

export type FileListProps = Omit<SharedProps, 'host'>

export function FileList(props: FileListProps) {
  const keys = useKeys()
  const { showToast } = useToast()
  const { pinnedFolderIds } = useDriveData()
  // Read through a ref so the host keeps one identity while keys, toast and pins change.
  const live = useRef({ keys, showToast })
  live.current = { keys, showToast }

  const host = useMemo<FileListHost>(
    () => ({
      isUnlocked: false, // replaced per render below
      useDecryptedNames,
      displayNameFrom,
      useThumbnails: useFileThumbnails,
      onDecrypted,
      pinnedFolderIds: [],
      async setPinnedFolderIds(ids) {
        await setPreference('pinned_folders', { folder_ids: ids })
        window.dispatchEvent(new Event('beebeeb:pins-changed'))
      },
      async renameFile(file, newName) {
        const k = live.current.keys
        await renameOwnerRow({
          fileId: file.id,
          file,
          newName,
          viewerId: null,
          residentUserId: k.getResidentUserId(),
          masterKey: k.getMasterKey(),
          getFileKey: async () => contentKeyBytes(await k.getFileKeyForFile(file, { plaintextChunk: true })),
          getFileKeyForFile: (f) => k.getFileKeyForFile(f, { plaintextChunk: true }),
          readName: readFileMetadata,
          sealRequestRename: k.sealRequestRename,
        })
      },
      renameFailureMessage: (err) => ownerWriteRefusal(err),
      classifyItemIds: async (ids) => { await classifyItemIds(ids) },
      isForeign: isForeignItemById,
      notify: (n) => live.current.showToast({ ...n, icon: n.icon as IconName | undefined } as Parameters<typeof showToast>[0]),
      renderSharePopover: ({ fileId, anchorRect, onClose }) => (
        <SharePopover fileId={fileId} anchorRect={anchorRect} onClose={onClose} onRevoked={() => {}} />
      ),
    }),
    [],
  )
  // The two per-render values ride on a thin object that shares the stable members.
  const liveHost = useMemo(
    () => ({ ...host, isUnlocked: keys.isUnlocked, pinnedFolderIds }),
    [host, keys.isUnlocked, pinnedFolderIds],
  )
  return <SharedFileList host={liveHost} {...props} />
}
