// Web wrapper for the shared move dialog (moved to @beebeeb/shared/drive-ui, desktop v2 B01):
// supplies the folder listing, name decryption and folder creation from the browser's keys and API.
import { useMemo, useRef } from 'react'
import { MoveModal as SharedMoveModal, type MoveModalHost, type MoveModalProps } from '@beebeeb/shared/drive-ui'
import { listFiles } from '../lib/api'
import { createNamedOwnerFolder, folderCreateFailureToast } from '../lib/new-folder'
import { useToast } from './toast'
import { useKeys } from '../lib/key-context'
import { decryptFileMetadata, encryptFilename } from '../lib/crypto'

export function MoveModal(props: Omit<MoveModalProps, 'host'>) {
  const keys = useKeys()
  const { showToast } = useToast()
  // The host is read through a ref so its identity stays stable while keys and toast change.
  const live = useRef({ keys, showToast })
  live.current = { keys, showToast }

  const host = useMemo<MoveModalHost>(
    () => ({
      async listFolders(parentId) {
        const files = (await listFiles(parentId ?? undefined, false)).filter((f) => f.is_folder)
        const { keys: k } = live.current
        return Promise.all(
          files.map(async (f) => {
            if (!k.isUnlocked) return { id: f.id, name: f.name_encrypted }
            try {
              const fileKey = await k.getFileKey(f.id)
              const { name } = await decryptFileMetadata(fileKey, f.name_encrypted)
              return { id: f.id, name }
            } catch {
              return { id: f.id, name: f.name_encrypted }
            }
          }),
        )
      },
      async newFolder(parentId, name) {
        const { keys: k } = live.current
        const created = await createNamedOwnerFolder({
          name,
          parentId: parentId ?? undefined,
          vaultReady: k.isUnlocked && k.cryptoReady,
          getFileKey: (id) => k.getFileKey(id),
          getMasterKey: k.getMasterKey,
          seal: encryptFilename,
        })
        return { id: created.id, name }
      },
      onCreateFailed: (err) => live.current.showToast(folderCreateFailureToast(err)),
    }),
    [],
  )
  return <SharedMoveModal host={host} {...props} />
}
