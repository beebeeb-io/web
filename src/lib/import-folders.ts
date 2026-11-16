/**
 * SF-0001 L13 round 2 (E1) — the folders one import run creates.
 *
 * An import proposes its own id for every folder it creates, exactly like any
 * other owner create: a fresh v4 minted ONCE per folder per run, kept in a
 * run-local `provider path → minted id` map. The old code derived the id from
 * a SHA-256 of the provider path, so the same folder got the same (and
 * wrongly versioned) id for every user and every run — an id nobody minted.
 *
 * A create that fails — including one the server answers with another id
 * (`ServerChangedItemIdError`) — stops that subtree and surfaces the error.
 * Nothing is ever written under a guessed or previously derived parent id, and
 * the failure is remembered for the rest of the run so the same path is not
 * retried (and cannot create a second folder) file after file.
 */
import type { DriveFile } from './api'

export interface ImportFolderCreateArgs {
  nameEncrypted: string
  parentId?: string
  folderId: string
  nameKey: Uint8Array
}

export interface ImportRunDeps {
  masterKey: Uint8Array
  /** Mint a fresh id. Called once per folder per run. */
  mintId(): string
  /** Derive a folder's own key from the id this client chose. */
  deriveKey(folderId: string): Promise<Uint8Array>
  /** Seal the folder name under its own key; returns the wire blob. */
  encryptName(nameKey: Uint8Array, name: string): Promise<string>
  /** Create the folder, echoing the id this client proposed. */
  create(args: ImportFolderCreateArgs): Promise<DriveFile>
  /** The encrypted upload used for one imported item. */
  upload(
    file: File,
    fileId: string,
    fileKey: Uint8Array,
    parentId: string | undefined,
    masterKey: Uint8Array,
    signal?: AbortSignal,
  ): Promise<DriveFile>
}

export interface ImportRun {
  /** The Beebeeb folder for a provider path, created once per run (or undefined for the root). */
  ensureFolderPath(folderPath: string): Promise<string | undefined>
  /** Resolve the item's folder, then upload it into that folder. */
  uploadItem(file: File, folderPath: string, signal?: AbortSignal): Promise<DriveFile>
}

export function createImportRun(deps: ImportRunDeps): ImportRun {
  const folderIds = new Map<string, string>()
  const folderErrors = new Map<string, Error>()

  async function ensureFolderPath(folderPath: string): Promise<string | undefined> {
    if (!folderPath) return undefined
    const known = folderIds.get(folderPath)
    if (known) return known
    const failed = folderErrors.get(folderPath)
    if (failed) throw failed

    try {
      const parts = folderPath.split('/').filter(Boolean)
      const name = parts[parts.length - 1] ?? folderPath
      const parentPath = parts.slice(0, -1).join('/')
      const parentId = parentPath ? await ensureFolderPath(parentPath) : undefined

      // A fresh id per folder, per run: nothing about the provider path may
      // decide the id (it would be identical for every user and every run).
      const folderId = deps.mintId()
      const nameKey = await deps.deriveKey(folderId)
      const nameEncrypted = await deps.encryptName(nameKey, name)
      const created = await deps.create({ nameEncrypted, parentId, folderId, nameKey })
      folderIds.set(folderPath, created.id)
      return created.id
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      // Stop this subtree: the path keeps failing for the rest of the run
      // instead of silently continuing under a guessed parent id.
      folderErrors.set(folderPath, error)
      throw error
    }
  }

  async function uploadItem(file: File, folderPath: string, signal?: AbortSignal): Promise<DriveFile> {
    // Resolved FIRST: a folder that could not be created never gets an init.
    const parentId = await ensureFolderPath(folderPath)
    const fileId = deps.mintId()
    const fileKey = await deps.deriveKey(fileId)
    return deps.upload(file, fileId, fileKey, parentId, deps.masterKey, signal)
  }

  return { ensureFolderPath, uploadItem }
}
