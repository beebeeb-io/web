/**
 * Task 2237b — guest zip downloads.
 *
 * The archive is walked with the link's own routes and decrypted with the
 * folder key; it never calls the owner-only `listFiles`. Packaging reuses the
 * drive packager (`packageZip`) so there is one streaming implementation.
 */
import type { DriveFile } from './api'
import {
  expandDownloadEntries,
  packageZip,
  uniqueZipPath,
  type BulkDownloadOptions,
  type BulkDownloadPorts,
} from './bulk-download'
import { decryptFileMetadata } from './crypto'
import { listFolderItems } from './folder-link-public'
import { decryptChildFileKey } from './folder-share-crypto'
import { fetchGuestDownloadBlob } from './guest-bytes'
import type { Proof, PublicFolderItem } from './folder-link-types'

/** The public listing route's page size. */
export const GUEST_ZIP_PAGE_LIMIT = 200

export interface GuestZipFile {
  path: string
  fileId: string
  sizeBytes: number
  blob: Blob
}

/** One segment under `parentPath`; a name that carries separators keeps only its last segment. */
export function zipPathFor(parentPath: string, name: string): string {
  const parent = parentPath.replace(/[/\\]+$/, '')
  const segment = name.split(/[/\\]/).filter(Boolean).pop() ?? ''
  return parent ? `${parent}/${segment}` : segment
}

function toDriveFile(item: PublicFolderItem): DriveFile {
  return {
    id: item.id,
    name_encrypted: item.name_encrypted,
    mime_type: null,
    size_bytes: item.size_bytes,
    is_folder: item.is_folder,
    is_trashed: false,
    parent_id: item.parent_id,
    chunk_count: item.chunk_count,
    created_at: item.updated_at,
    updated_at: item.updated_at,
  }
}

export interface CollectGuestZipArgs {
  token: string
  folderKey: Uint8Array
  proof: Proof | null
  /** Decrypted name of the shared root folder; the archive's outer folder. */
  rootPath: string
  signal?: AbortSignal
  onProgress?: (done: number, total: number, currentName: string) => void
}

/**
 * Walk the shared tree and decrypt every file into an archive entry.
 * Unreadable folders and files are counted, never fatal: a partial archive is
 * still useful to the person downloading it.
 */
export async function collectGuestZipEntries(
  args: CollectGuestZipArgs,
): Promise<{ files: GuestZipFile[]; errorCount: number }> {
  const { token, folderKey, proof, rootPath, signal, onProgress } = args
  const itemsById = new Map<string, PublicFolderItem>()

  async function listAll(parentId: string | null): Promise<DriveFile[]> {
    const rows: DriveFile[] = []
    let cursor: string | null = null
    do {
      const page = await listFolderItems(
        token,
        { parentId, cursor, limit: GUEST_ZIP_PAGE_LIMIT },
        proof,
      )
      for (const item of page.items) {
        itemsById.set(item.id, item)
        rows.push(toDriveFile(item))
      }
      cursor = page.next_cursor
    } while (cursor)
    return rows
  }

  const ports: BulkDownloadPorts = {
    listChildren: (folderId) => listAll(folderId),
    getFileKey: async (file) => {
      if (file.is_folder) return folderKey
      const item = itemsById.get(file.id)
      if (!item?.wrapped_file_key) throw new Error('This file has no folder key.')
      return decryptChildFileKey(folderKey, item.wrapped_file_key)
    },
    decryptToBlob: async (file, fileKey) => {
      const item = itemsById.get(file.id)
      if (!item) throw new Error('This file is no longer in the listing.')
      const plaintext = await fetchGuestDownloadBlob({ token, item, fileKey, proof, signal })
      const meta = await decryptFileMetadata(fileKey, item.name_encrypted)
      return { plaintext, filename: meta.name }
    },
  }

  let errorCount = 0
  const used = new Set<string>()
  const files: GuestZipFile[] = []

  const rootItems = await listAll(null)
  const entries = await expandDownloadEntries(
    rootItems,
    ports,
    rootPath ? `${rootPath}/` : '',
    () => {
      errorCount += 1
    },
  )

  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) break
    const entry = entries[i]
    onProgress?.(i, entries.length, entry.file.name_encrypted)
    try {
      const fileKey = await ports.getFileKey(entry.file)
      const { plaintext, filename } = await ports.decryptToBlob(entry.file, fileKey)
      const path = uniqueZipPath(zipPathFor(entry.prefix, filename), used)
      files.push({
        path,
        fileId: entry.file.id,
        sizeBytes: entry.file.size_bytes,
        blob: plaintext,
      })
      onProgress?.(i + 1, entries.length, filename)
    } catch {
      errorCount += 1
      onProgress?.(i + 1, entries.length, entry.file.name_encrypted)
    }
  }

  return { files, errorCount }
}

/** Package collected entries with the shared zip packager and start the download. */
export async function downloadGuestZip(
  entries: GuestZipFile[],
  zipFilename: string,
  options: BulkDownloadOptions = {},
): Promise<void> {
  await packageZip(
    entries.map((entry) => ({
      pathFor: () => entry.path,
      fallbackName: entry.path.split('/').pop() ?? entry.path,
      load: async () => ({
        plaintext: entry.blob,
        filename: entry.path.split('/').pop() ?? entry.path,
      }),
    })),
    {
      ...options,
      zipFilename,
      totalEstimatedBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
    },
  )
}
