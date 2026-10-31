/**
 * L13 (contract 2275, SF-0001) — the folder tree an import recreates, and the
 * per-file step of the import worker (settings/import.tsx).
 *
 * Every folder is created under a v4 id THIS run mints. It is never derived
 * from the provider path: a hash of the path is the same for every account and
 * every run (and is not a v4), so it is not an id this client chose for this
 * folder. A run-local `path -> minted id` map makes every file of one folder
 * land in the same folder.
 *
 * A failed create (the server answered with another id, refused, or could not
 * be reached) stops that folder and everything under it for the rest of the
 * run: each file under it fails with that error, before it is downloaded, and
 * nothing is uploaded under a parent this run did not create. There is no
 * fallback to a guessed parent id.
 */
import { createOwnerFolder } from './owner-upload-key'
import { deriveFileKey, encryptFilename, serializeEncryptedBlob, zeroize } from './crypto'
import { encryptedUpload } from './encrypted-upload'

export interface ImportFolderTree {
  /**
   * The id of the folder at `folderPath`, created (with its parents) on first
   * use in this run; `undefined` for the root. Rejects with the create's error
   * for a folder whose create failed, and for every folder under it.
   */
  ensure(folderPath: string): Promise<string | undefined>
}

export interface ImportFolderTreeOptions {
  /** Mints each folder's id; a fresh v4 by default. */
  mintId?: () => string
  /**
   * Called ONCE for a folder whose create failed (not again for the folders
   * and files under it), so the import can say which folder stopped and why.
   */
  onFolderFailed?: (folderPath: string, error: unknown) => void
}

/** One tree per import run: a new run mints new ids for the same paths. */
export function createImportFolderTree(
  masterKey: Uint8Array,
  options: ImportFolderTreeOptions = {},
): ImportFolderTree {
  const mintId = options.mintId ?? (() => crypto.randomUUID())
  // Keyed by the normalised path ('/A/B'). The promise is kept whatever it
  // settles to: a rejected one keeps the subtree stopped for the whole run.
  const byPath = new Map<string, Promise<string>>()

  async function create(key: string, parts: string[]): Promise<string> {
    // A parent that failed rejects here with its own error; it was reported
    // when IT failed, so this folder reports nothing of its own.
    const parentId = parts.length > 1 ? await ensure(parts.slice(0, -1).join('/')) : undefined
    const folderId = mintId()
    try {
      const nameKey = await deriveFileKey(masterKey, folderId)
      try {
        const sealed = await encryptFilename(nameKey, parts[parts.length - 1])
        // Inside a shared folder its name-key wrap is published too.
        // It aborts unless the answer names `folderId` (L13 echo check).
        const folder = await createOwnerFolder({
          nameEncrypted: serializeEncryptedBlob(sealed.nonce, sealed.ciphertext),
          parentId,
          folderId,
          nameKey,
          masterKey,
        })
        return folder.id
      } finally {
        zeroize(nameKey)
      }
    } catch (error) {
      options.onFolderFailed?.(key, error)
      throw error
    }
  }

  function ensure(folderPath: string): Promise<string | undefined> {
    const parts = folderPath.split('/').filter(Boolean)
    if (parts.length === 0) return Promise.resolve(undefined)
    const key = '/' + parts.join('/')
    let pending = byPath.get(key)
    if (!pending) {
      pending = create(key, parts)
      // Every caller still sees the rejection; this only keeps a folder no
      // file asked for again from reporting an unhandled one.
      pending.catch(() => {})
      byPath.set(key, pending)
    }
    return pending
  }

  return { ensure }
}

/**
 * Import one provider file into its folder: the folder first (a stopped
 * subtree fails here, before the download), then download, seal and upload
 * under an id minted for this file.
 */
export async function importFileInto(args: {
  folders: ImportFolderTree
  parentPath: string
  name: string
  masterKey: Uint8Array
  download: (signal: AbortSignal) => Promise<Blob>
  signal: AbortSignal
  onStatus: (status: 'downloading' | 'encrypting' | 'uploading') => void
  onBytes: (bytes: number) => void
}): Promise<void> {
  const parentId = await args.folders.ensure(args.parentPath)
  args.onStatus('downloading')
  const blob = await args.download(args.signal)
  args.onBytes(blob.size)

  args.onStatus('encrypting')
  const fileId = crypto.randomUUID()
  const fileKey = await deriveFileKey(args.masterKey, fileId)
  try {
    args.onStatus('uploading')
    const file = new File([blob], args.name, { type: blob.type || 'application/octet-stream' })
    await encryptedUpload(file, fileId, fileKey, args.masterKey, parentId, (p) => {
      if (p.stage === 'Uploading' && p.bytesUploaded) args.onBytes(p.bytesUploaded)
    }, undefined, undefined, args.signal)
  } finally {
    zeroize(fileKey)
  }
}
