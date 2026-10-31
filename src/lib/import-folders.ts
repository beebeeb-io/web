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
 * A failed create (the server answered with another id, or refused) stops that
 * folder and everything under it for the rest of the run: each file under it
 * fails with that error, before it is downloaded, and nothing is uploaded
 * under a parent this run did not create. There is no fallback to a guessed
 * parent id.
 *
 * Re-running an import does not create a second folder of the same name
 * (SF-0001 round 3): before minting, the parent's existing child folders are
 * read once per run, and a live folder whose name AUTHENTICATES under this
 * user's key for its id and equals the provider name exactly is reused (the
 * oldest, if there are several). A plaintext legacy name, a name sealed under
 * another key, a trashed folder or a file of that name is never reused.
 *
 * A TRANSIENT failure (no connection, 5xx, 429) is not kept for the run
 * (SF-0001 round 3): that file fails with it, and the next file under the
 * folder tries the create again, under the SAME id this run minted for it
 * (no other client holds it). createOwnerFolder itself already retries a
 * dropped connection under that id.
 */
import { createOwnerFolder } from './owner-upload-key'
import { deriveFileKey, encryptFilename, readNameMetadata, serializeEncryptedBlob, zeroize } from './crypto'
import { listAllFiles } from './api'
import { encryptedUpload } from './encrypted-upload'
import { errorRetryable } from './user-friendly-error'

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
  // Keyed by the normalised path ('/A/B'). The promise is kept unless it
  // rejects with a transient error: any other rejection keeps the subtree
  // stopped for the whole run.
  const byPath = new Map<string, Promise<string>>()
  // Each folder's id, minted ONCE per run, so a retry proposes the same id.
  const mintedFor = new Map<string, string>()
  // Per parent ('' = the root): this run's view of its child folders, by
  // authenticated name. Read once; folders this run creates are added to it.
  const childFolders = new Map<string, Promise<Map<string, string>>>()

  function childrenOf(parentId: string | undefined): Promise<Map<string, string>> {
    const parentKey = parentId ?? ''
    let pending = childFolders.get(parentKey)
    if (!pending) {
      const reading = readChildFolders(parentId)
      pending = reading
      childFolders.set(parentKey, reading)
      // A failed listing is read again next time.
      reading.catch(() => {
        if (childFolders.get(parentKey) === reading) childFolders.delete(parentKey)
      })
    }
    return pending
  }

  async function readChildFolders(parentId: string | undefined): Promise<Map<string, string>> {
    const byName = new Map<string, string>()
    const folders = (await listAllFiles(parentId))
      .filter((row) => row.is_folder && !row.is_trashed && row.name_encrypted.startsWith('{'))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    for (const row of folders) {
      const nameKey = await deriveFileKey(masterKey, row.id)
      try {
        const { name } = await readNameMetadata(nameKey, row.name_encrypted)
        if (!byName.has(name)) byName.set(name, row.id)
      } catch {
        // Not sealed under this user's key for its id: never reused.
      } finally {
        zeroize(nameKey)
      }
    }
    return byName
  }

  async function create(key: string, parts: string[]): Promise<string> {
    // A parent that failed rejects here with its own error; it was reported
    // when IT failed, so this folder reports nothing of its own.
    const parentId = parts.length > 1 ? await ensure(parts.slice(0, -1).join('/')) : undefined
    const name = parts[parts.length - 1]
    try {
      // A folder of this name already under this parent: reuse it.
      const siblings = await childrenOf(parentId)
      const existing = siblings.get(name)
      if (existing !== undefined) return existing

      let folderId = mintedFor.get(key)
      if (folderId === undefined) {
        folderId = mintId()
        mintedFor.set(key, folderId)
      }
      const nameKey = await deriveFileKey(masterKey, folderId)
      try {
        const sealed = await encryptFilename(nameKey, name)
        // Inside a shared folder its name-key wrap is published too.
        // It aborts unless the answer names `folderId` (L13 echo check).
        const folder = await createOwnerFolder({
          nameEncrypted: serializeEncryptedBlob(sealed.nonce, sealed.ciphertext),
          parentId,
          folderId,
          nameKey,
          masterKey,
        })
        siblings.set(name, folder.id)
        return folder.id
      } finally {
        zeroize(nameKey)
      }
    } catch (error) {
      if (errorRetryable(error)) {
        // Transient: not a stopped folder (ensure() lets the next file retry).
        // Read the parent again then: the lost attempt may have landed, and
        // the retry should find it rather than collide with it.
        childFolders.delete(parentId ?? '')
      } else {
        options.onFolderFailed?.(key, error)
      }
      throw error
    }
  }

  function ensure(folderPath: string): Promise<string | undefined> {
    const parts = folderPath.split('/').filter(Boolean)
    if (parts.length === 0) return Promise.resolve(undefined)
    const key = '/' + parts.join('/')
    let pending = byPath.get(key)
    if (!pending) {
      const attempt = create(key, parts)
      pending = attempt
      byPath.set(key, attempt)
      // Every caller still sees the rejection. A transient one is forgotten,
      // so the next file under this folder tries again (same minted id); any
      // other rejection stays, and keeps the subtree stopped for the run.
      attempt.catch((error: unknown) => {
        if (errorRetryable(error) && byPath.get(key) === attempt) byPath.delete(key)
      })
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
