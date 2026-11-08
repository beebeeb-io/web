// Web's DriveSource (desktop v2 B01): the shared Drive UI reads and acts through this contract; here it is
// backed by today's API client and the browser's keys, exactly the calls the pages made before the move.
// What web has no call for (local copies, a native file manager, photo cursors, Office bytes) throws
// DriveSourceError('unsupported') so a shared component can hide the control from `capabilities`.
import {
  DriveSourceError,
  type BinaryDocument,
  type Crumb,
  type DriveItem,
  type DriveSource,
  type DriveSourceErrorCode,
  type DriveEvent,
  type ItemDetails,
  type Listing,
  type ShareEntry,
  type SortDir,
  type SortKey,
  type StorageSummary,
  type SyncSummary,
  type TextDocument,
  type TrashEntry,
  type VersionEntry,
} from '@beebeeb/shared/drive-ui'
import {
  ApiError,
  bulkTrashFiles,
  getFile,
  getStorageUsage,
  listAllFiles,
  listMyShares,
  listVersions,
  permanentDeleteFile,
  restoreFile,
  restoreVersion,
  updateFile,
  type DriveFile,
} from './api'
import { decryptFileMetadata } from './crypto'
import { contentKeyBytes } from './request-row'
import type { useKeys } from './key-context'

/** The slice of the key context the source needs; web passes `useKeys()`. */
export type WebDriveKeys = Pick<ReturnType<typeof useKeys>, 'getFileKeyForFile' | 'isUnlocked'>

export interface WebDriveSourceDeps {
  /** Always returns the CURRENT keys (a ref read), so the source keeps one identity across lock changes. */
  keys: () => WebDriveKeys
  /** Renames one row with web's owner/request-aware sealing (lib/owner-rename). */
  renameRow: (file: DriveFile, newName: string) => Promise<void>
  /** Creates a folder with web's minted-id sealing (lib/new-folder); throws on refusal. */
  createNamedFolder: (parentId: string | null, name: string) => Promise<DriveFile>
}

function mapError(err: unknown): DriveSourceError {
  if (err instanceof DriveSourceError) return err
  let code: DriveSourceErrorCode = 'failed'
  if (err instanceof ApiError) {
    if (err.status === 404) code = 'not-found'
    else if (err.status === 409) code = 'conflict'
    else if (err.status === 401) code = 'signed-out'
    else if (err.status === 403) code = 'read-only'
    else if (err.status === 413 || err.status === 402) code = 'quota'
  } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    code = 'offline'
  }
  return new DriveSourceError(code)
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw mapError(err)
  }
}

const unsupported = (what: string): never => {
  throw new DriveSourceError('unsupported', what)
}

function sorter(sort?: { key: SortKey; dir: SortDir }) {
  return (a: DriveItem, b: DriveItem): number => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    const dir = sort?.dir === 'desc' ? -1 : 1
    switch (sort?.key ?? 'name') {
      case 'modified':
        return dir * (Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt))
      case 'size':
        return dir * ((a.size ?? 0) - (b.size ?? 0))
      case 'kind':
        return dir * (a.mime ?? '').localeCompare(b.mime ?? '')
      default:
        return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }
  }
}

export function createWebDriveSource(deps: WebDriveSourceDeps): DriveSource {
  const listeners = new Set<(event: DriveEvent) => void>()
  const emit = (event: DriveEvent) => listeners.forEach((l) => l(event))
  const trashUndo = new Map<string, string[]>()
  let undoSeq = 0
  const names = new Map<string, string>()

  async function toItems(files: DriveFile[]): Promise<DriveItem[]> {
    const { getFileKeyForFile, isUnlocked } = deps.keys()
    return Promise.all(
      files.map(async (f) => {
        let name = names.get(f.id)
        if (name === undefined) {
          name = 'Encrypted item'
          if (isUnlocked) {
            try {
              const key = contentKeyBytes(await getFileKeyForFile(f))
              name = (await decryptFileMetadata(key, f.name_encrypted)).name
              names.set(f.id, name)
            } catch {
              /* stays the placeholder: a name is never shown as ciphertext */
            }
          }
        }
        const shared = (f.share_count ?? 0) > 0 ? ({ kind: 'link' } as const) : ({ kind: 'none' } as const)
        return {
          id: f.id,
          parentId: f.parent_id,
          name,
          isFolder: f.is_folder,
          size: f.is_folder ? null : f.size_bytes,
          modifiedAt: f.updated_at,
          mime: f.mime_type ?? undefined,
          shared,
          local: null,
          starred: f.is_starred,
          hasThumbnail: !!f.has_thumbnail,
        } satisfies DriveItem
      }),
    )
  }

  async function itemFor(id: string): Promise<DriveItem> {
    return (await toItems([await getFile(id)]))[0]
  }

  async function pathTo(id: string | null): Promise<Crumb[]> {
    const path: Crumb[] = []
    let cursor = id
    while (cursor) {
      const item = await itemFor(cursor)
      path.unshift({ id: item.id, name: item.name })
      cursor = item.parentId
    }
    return [{ id: null, name: 'My files' }, ...path]
  }

  const source: DriveSource = {
    kind: 'web',
    capabilities: { localCopies: false, revealInFileManager: false, office: true, nativePickers: false },

    list: (folderId, sort) =>
      guarded(async (): Promise<Listing> => {
        const files = await listAllFiles(folderId ?? undefined)
        const items = (await toItems(files)).sort(sorter(sort))
        const path = await pathTo(folderId)
        return { folder: path[path.length - 1], path, items, asOf: new Date().toISOString(), stale: false }
      }),
    details: (id) =>
      guarded(async (): Promise<ItemDetails> => {
        const item = await itemFor(id)
        const versions = item.isFolder ? { versions: [] } : await listVersions(id)
        return { item, path: await pathTo(item.parentId), versionCount: versions.versions.length }
      }),
    // Web draws thumbnails through its own decrypting hook; the contract's URL is for desktop.
    thumbnail: async () => null,
    versions: (id) =>
      guarded(async (): Promise<VersionEntry[]> => {
        const list = await listVersions(id)
        return list.versions.map((v) => ({
          id: v.id,
          createdAt: v.created_at,
          size: v.size_bytes,
          current: v.is_current ?? v.version_number === list.current_version,
        }))
      }),
    search: async () => unsupported('search'),
    recent: (limit) =>
      guarded(async () => (await toItems(await listAllFiles(undefined, { recent: true, maxTotal: limit ?? 50 })))),
    shared: () =>
      guarded(async (): Promise<ShareEntry[]> => {
        const shares = await listMyShares()
        const files = await Promise.all(shares.map((s) => getFile(s.file_id).catch(() => null)))
        const rows = files.filter((f): f is DriveFile => !!f)
        const items = await toItems(rows)
        return items.map((item) => ({ item, direction: 'by-me' as const, people: [], hasLink: true }))
      }),
    photos: async () => unsupported('photos'),
    trash: () =>
      guarded(async (): Promise<TrashEntry[]> => {
        const files = await listAllFiles(undefined, { trashed: true })
        const items = await toItems(files)
        return items.map((item, i) => ({ item, trashedAt: files[i].updated_at, originalPath: '' }))
      }),
    storage: () =>
      guarded(async (): Promise<StorageSummary> => {
        const u = (await getStorageUsage()) as unknown as { used_bytes?: number; quota_bytes?: number }
        const usedBytes = u.used_bytes ?? 0
        return { usedBytes, quotaBytes: u.quota_bytes ?? 0, filesBytes: usedBytes, photosBytes: 0, backupsBytes: 0 }
      }),
    sync: async (): Promise<SyncSummary> => ({ phase: 'up-to-date', onDevice: 0, availableOffline: 0, onlineOnly: 0, pending: 0 }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    createFolder: (parentId, name) =>
      guarded(async () => {
        const created = await deps.createNamedFolder(parentId, name)
        names.set(created.id, name)
        const item = await itemFor(created.id)
        emit({ kind: 'changed', folderId: parentId })
        return item
      }),
    rename: (id, name) =>
      guarded(async () => {
        await deps.renameRow(await getFile(id), name)
        names.set(id, name)
        const item = await itemFor(id)
        emit({ kind: 'item', item })
        return item
      }),
    move: (ids, targetId) =>
      guarded(async () => {
        await Promise.all(ids.map((id) => updateFile(id, { parent_id: targetId })))
        emit({ kind: 'changed', folderId: targetId })
      }),
    duplicate: async () => unsupported('duplicate'),
    moveToTrash: (ids) =>
      guarded(async () => {
        await bulkTrashFiles(ids)
        const undoToken = `u${++undoSeq}`
        trashUndo.set(undoToken, ids)
        ids.forEach((id) => emit({ kind: 'removed', id }))
        return { undoToken }
      }),
    undoTrash: (undoToken) =>
      guarded(async () => {
        const ids = trashUndo.get(undoToken)
        if (!ids) throw new DriveSourceError('not-found')
        trashUndo.delete(undoToken)
        await Promise.all(ids.map((id) => restoreFile(id)))
        emit({ kind: 'changed', folderId: null })
      }),
    restoreFromTrash: (ids) =>
      guarded(async () => {
        await Promise.all(ids.map((id) => restoreFile(id)))
        emit({ kind: 'changed', folderId: null })
      }),
    deletePermanently: (ids) =>
      guarded(async () => {
        await Promise.all(ids.map((id) => permanentDeleteFile(id)))
      }),
    restoreVersion: (id, versionId) =>
      guarded(async () => {
        await restoreVersion(id, versionId)
        emit({ kind: 'item', item: await itemFor(id) })
      }),
    // Web uploads run through the upload manager and the browser's file input.
    upload: async () => unsupported('upload'),
    open: async () => unsupported('open'),
    readText: async (): Promise<TextDocument> => unsupported('readText'),
    saveText: async (): Promise<TextDocument> => unsupported('saveText'),
    readBytes: async (): Promise<BinaryDocument> => unsupported('readBytes'),
    saveBytes: async (): Promise<BinaryDocument> => unsupported('saveBytes'),
    setAvailableOffline: async () => unsupported('setAvailableOffline'),
    revealInFileManager: async () => unsupported('revealInFileManager'),
  }
  return source
}
