// Mounts web's DriveSource above every Drive page (desktop v2 B01). One source for the session; it reads
// the current keys through a ref, so a lock or unlock does not replace it.
// Side-effect imports: web registers its size formatter, preview predicate and custody proofs with the shared UI.
import '../lib/format'
import '../lib/preview'
import '../lib/display-markers'
import { useMemo, useRef, type ReactNode } from 'react'
import { DriveSourceProvider } from '@beebeeb/shared/drive-ui'
import { createWebDriveSource } from '../lib/drive-source-web'
import { createNamedOwnerFolder } from '../lib/new-folder'
import { renameOwnerRow } from '../lib/owner-rename'
import { readFileMetadata, encryptFilename } from '../lib/crypto'
import { contentKeyBytes } from '../lib/request-row'
import { getFile } from '../lib/api'
import { useKeys } from '../lib/key-context'

export function WebDriveSourceProvider({ children }: { children: ReactNode }) {
  const keys = useKeys()
  const live = useRef(keys)
  live.current = keys

  const source = useMemo(
    () =>
      createWebDriveSource({
        keys: () => live.current,
        renameRow: (file, newName) => {
          const k = live.current
          return renameOwnerRow({
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
        async createNamedFolder(parentId, name) {
          const k = live.current
          const created = await createNamedOwnerFolder({
            name,
            parentId: parentId ?? undefined,
            vaultReady: k.isUnlocked && k.cryptoReady,
            getFileKey: (id) => k.getFileKey(id),
            getMasterKey: k.getMasterKey,
            seal: encryptFilename,
          })
          return getFile(created.id)
        },
      }),
    [],
  )
  return <DriveSourceProvider source={source}>{children}</DriveSourceProvider>
}
