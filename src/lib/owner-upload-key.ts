/**
 * Task 2237b — an owner upload into an already-shared folder.
 *
 * Members and guests open a file through its wrap in `shared_folder_keys`
 * (file key sealed under the shared root's folder key). Files that existed when
 * the folder was shared got theirs at share time; a file the owner adds later
 * needs one too, including in a folder shared only through links, which has no
 * invite to hang it on (`POST /shared-folders/:id/keys`, owner only,
 * insert-only).
 */
import { ApiError, createFolder, getFile, publishSharedFolderKeys, updateFile, type DriveFile } from './api'
import { collectAllChildItems, sealChildKey } from './folder-share-crypto'
import { adoptForeignTreeBeforeMove, assertNoSeenCustodyAbove, folderKeyForRoot, folderWrapFormat, needsOwnership, sharedRootFor } from './owner-adoption'
import { zeroize } from './crypto'
import { ownedItem, type KeyOrigin } from './owned-item'
import { sharedFoldersEnabled } from './use-feature-flag'
import { withNetworkRetry } from './net-retry'
import { canPublishAnchored, deferPublish, localStorageQueue } from './publish-anchor'

/**
 * Publish the wrap of an item the owner just added under its shared root: a
 * file's content key, or a new folder's own name key. No-op outside a shared
 * folder, and for a folder without a custody record (L7b: a flag-off
 * invite-only share, whose route answers 404 anyway). With custody the wrap is
 * L7, bound to (root, this item, file or folder).
 */
export async function publishOwnerUploadKey(
  masterKey: Uint8Array,
  parentId: string,
  fileId: string,
  fileKey: Uint8Array,
  isFolder = false,
): Promise<void> {
  // rv-web198c P2-1: with the flag off there is nothing to publish to, and the
  // walk below must not run (or fail) after an upload already committed.
  // rv-web198d N2: except under a folder this client has seen with custody,
  // where "off" must fail loudly, never skip. This runs AFTER the write
  // committed, so an unanswered flag read reads as off here (final review P2:
  // a committed upload must not be reported failed for it); the strict read
  // is for the decisions made before a write (invite build, approval).
  if (!(await sharedFoldersEnabled())) {
    await assertNoSeenCustodyAbove(parentId)
    return
  }
  const root = await sharedRootFor(parentId, parentId)
  if (!root) return
  if ((await folderWrapFormat(root, parentId)) !== 'l7') return
  const folderKey = await folderKeyForRoot(masterKey, root)
  if (!folderKey) throw new Error('The shared folder key is not available on this device.')
  try {
    await publishSharedFolderKeys(root, [{
      file_id: fileId,
      encrypted_file_key: await sealChildKey(folderKey, { rootId: root, itemId: fileId, isFolder }, fileKey),
    }])
  } catch (error) {
    // A server without the route (405) or without the custody row (404) cannot
    // take the wrap; the upload itself succeeded and the owner can open it.
    // Any other failure is real and fails the upload, like an invite's wrap.
    if (error instanceof ApiError && (error.status === 405 || error.status === 404)) {
      console.warn('[upload] shared-folder key not published', { status: error.status })
      return
    }
    throw error
  } finally {
    zeroize(folderKey)
  }
}

/**
 * Create a folder the owner names, and publish its name-key wrap when it lands
 * inside a shared folder. Without that wrap a guest or member cannot read the
 * new folder's name (its name is sealed under its own key, derived from the
 * owner's master key). `nameKey` is that key; without it nothing is published.
 * `nameEncrypted` is always the sealed name: no site sends a plain one (a
 * folder named in the UI goes through new-folder.ts, which refuses while the
 * vault is locked).
 */
export async function createOwnerFolder(args: {
  nameEncrypted: string
  parentId?: string
  folderId: string
  nameKey?: Uint8Array
  masterKey?: Uint8Array
}): Promise<DriveFile> {
  // L13 (contract 2275, SF-0001): the folder's name is sealed under the key
  // derived from the id THIS client chose. createFolder throws on an answer
  // with any other id — before a wrap is published here, and before the
  // caller indexes, moves items into, or navigates to the answer.
  // A dropped connection is retried under the SAME id (SF-0001 round 3): it
  // was minted for this folder, so no other client holds it. The changed-id
  // abort and every HTTP error are not retried.
  let created: DriveFile
  try {
    created = await withNetworkRetry(() => createFolder(args.nameEncrypted, args.parentId, args.folderId))
  } catch (err) {
    // POST /files/folder is a plain INSERT: a create whose earlier attempt
    // (in this call, or in an earlier call with the same minted id, as the
    // import makes) DID commit answers 500 or 409 on the primary key, and a
    // connection that stayed down leaves it unknown. On any such failure the
    // row under this client-minted id is looked up (SF-0001 rounds 4-5): if it
    // is exactly the folder this client sent (`folderThatLanded`: the same
    // sealed name byte for byte, a live folder, the same parent), it IS this
    // folder, and the create goes on below, the name-key wrap included.
    // Otherwise the error stands.
    const maybeLanded = err instanceof ApiError && (err.status === 0 || err.status === 409 || err.status >= 500)
    const landed = maybeLanded ? await folderThatLanded(args) : null
    if (!landed) throw err
    created = landed
  }
  if (args.parentId && args.nameKey && args.masterKey) {
    await publishOwnerUploadKey(args.masterKey, args.parentId, created.id, args.nameKey, true)
  }
  return created
}

/**
 * The folder this client's earlier attempt created under `args.folderId`, if
 * the row there is EXACTLY what it sent (SF-0001 round 5): byte for byte the
 * sealed name it sent (core seals with a fresh nonce, so nobody else holds
 * that string; a plaintext legacy name, or any other sealing, is not it), a
 * live folder, under the parent it asked for. Needs no key. Null for
 * anything else, including a lookup that fails: the create's own error is
 * what the caller then surfaces.
 */
async function folderThatLanded(args: {
  nameEncrypted: string
  parentId?: string
  folderId: string
}): Promise<DriveFile | null> {
  let row: DriveFile
  try {
    row = await getFile(args.folderId)
  } catch {
    return null
  }
  if (row.id !== args.folderId || !row.is_folder || row.is_trashed) return null
  if ((row.parent_id ?? undefined) !== args.parentId) return null
  if (row.name_encrypted !== args.nameEncrypted) return null
  return row
}

/** The server takes at most this many key rows per publish call. */
const PUBLISH_BATCH = 1000

/** Thrown after the move itself succeeded, when its wraps could not be published. */
export const MOVED_BUT_UNPUBLISHED = "Moved, but it isn't readable in the shared folder yet. Try moving it again."

/** A moved row: enough to know its kind, who added it, and its sealed name. */
export type MovableRow = Pick<DriveFile, 'id'> &
  Partial<
    Pick<
      DriveFile,
      'is_folder' | 'uploaded_by' | 'acted_via_share_id' | 'name_encrypted' | 'owner_wrapped_file_key'
    >
  >

/**
 * rv-web198c P2-5: move items (the drive's "copy" is a move too) and, when the
 * destination is inside a custody folder, publish the wrap of every moved item
 * and everything under it, as an upload or a folder create does. Without it a
 * moved-in item stayed unreadable to the folder's guests and members.
 *
 * Only rows the resolver proves are sealed: an O row's derived key must
 * authenticate its name, and an F row keeps the wrap it already has (the
 * resolver key), never a derived key that is not its key. The one route that
 * moves a row in the web client: a guard test pins it.
 *
 * L15 (2275): a move is a share-time event only when the picker showed the
 * shared root `R` for the chosen destination; `pickerRootId` carries that
 * answer. When the caller omits it, this client's own custody proof for `R`
 * stands in for the marker (the picker marks shared roots from that proof).
 */
export async function moveOwnerItems(args: {
  ids: string[]
  destinationId: string | null
  /** The listed rows by id, for their kind, uploader and sealed name. */
  rows?: ReadonlyMap<string, MovableRow> | MovableRow[]
  masterKey?: Uint8Array
  viewerId?: string | null
  /** The shared root the picker showed for the destination, or null. */
  pickerRootId?: string | null
}): Promise<void> {
  // L12 (2275): moving out of a shared root adopts every F item it takes along
  // FIRST, and a failed adoption refuses the move entirely (before any update).
  if (args.masterKey) await adoptBeforeLeavingRoot(args)
  await Promise.all(args.ids.map((id) => updateFile(id, { parent_id: args.destinationId })))
  if (!args.destinationId || !args.masterKey) return
  try {
    await publishMovedItems({
      masterKey: args.masterKey,
      destinationId: args.destinationId,
      ids: args.ids,
      rows: args.rows,
      viewerId: args.viewerId ?? null,
      pickerRootId: args.pickerRootId,
    })
  } catch (error) {
    console.warn('[move] shared-folder keys not published after a move', {
      status: error instanceof ApiError ? error.status : undefined,
    })
    throw new Error(MOVED_BUT_UNPUBLISHED)
  }
}

/** The source root an item is leaving, when the move crosses a root boundary. */
async function adoptBeforeLeavingRoot(args: {
  ids: string[]
  destinationId: string | null
  masterKey?: Uint8Array
}): Promise<void> {
  if (!args.masterKey) return
  // Only with the flag reading ON: an unanswered read must not add requests
  // (rv-web198e P3), and with it off there is no custody to adopt out of.
  if (!(await sharedFoldersEnabled())) return
  const destinationRoot = args.destinationId ? await sharedRootFor(args.destinationId, args.destinationId) : null
  for (const id of args.ids) {
    const source = await sharedRootFor(null, id)
    if (!source || source === destinationRoot) continue
    await adoptForeignTreeBeforeMove({ masterKey: args.masterKey, rootId: source, itemIds: [id] })
  }
}

/**
 * L15 (2275) publish-or-defer for an anchored create. The destination must
 * have a proven custody root and an L7 format; only this tab's own click trail
 * may publish. Otherwise the (item, parent, root) is deferred for 7 days and
 * nothing is sent now.
 */
export async function publishOrDeferOwnerUpload(args: {
  masterKey: Uint8Array
  parentId: string
  fileId: string
  fileKey: Uint8Array
  isFolder?: boolean
}): Promise<'published' | 'deferred' | 'not_published'> {
  const { masterKey, parentId, fileId, fileKey, isFolder = false } = args
  if (!(await sharedFoldersEnabled())) return 'not_published'
  const root = await sharedRootFor(parentId, parentId)
  if (!root) return 'not_published'
  if ((await folderWrapFormat(root, parentId)) !== 'l7') return 'not_published'
  if (!(await destinationProven(parentId, root))) return deferOwnerCreate(fileId, parentId, root)
  if (canPublishAnchored(parentId, root)) {
    await publishOwnerUploadKey(masterKey, parentId, fileId, fileKey, isFolder)
    return 'published'
  }
  return deferOwnerCreate(fileId, parentId, root)
}

/** Pin a deferral for (item, parent, root); 7 days, dropped with the item. */
function deferOwnerCreate(fileId: string, parentId: string, root: string): 'deferred' {
  const store = localStorageQueue()
  if (store) deferPublish(store, { id: fileId, parentId, rootId: root, at: Date.now(), own: true })
  return 'deferred'
}

/**
 * L15(b)2 / A26: the destination must be proven. `R` itself is (its custody
 * record is the proof); any other folder is proven only by an L7 wrap whose
 * name authenticates under its own key — never by a plaintext name, which
 * stays unproven until the folder is renamed under its derived key. An
 * unreadable destination is not proven either.
 */
async function destinationProven(parentId: string, root: string): Promise<boolean> {
  if (parentId === root) return true
  try {
    const row = await getFile(parentId)
    // Core's own rule (resolve_owned_key): a sealed name is a `{` envelope; a
    // plaintext name has no owner key convention to prove it with.
    return row.is_folder && row.name_encrypted.startsWith('{')
  } catch {
    return false
  }
}

/** Origins whose key the resolver proved against the row's own name. */
const PROVEN_ORIGINS: ReadonlySet<KeyOrigin> = new Set(['derived', 'owner_wrap', 'folder_wrap'])

async function publishMovedItems(args: {
  masterKey: Uint8Array
  destinationId: string
  ids: string[]
  rows: ReadonlyMap<string, MovableRow> | MovableRow[] | undefined
  viewerId: string | null
  pickerRootId: string | null | undefined
}): Promise<void> {
  const { masterKey, destinationId, ids, rows, viewerId } = args
  if (!(await sharedFoldersEnabled())) {
    // rv-web198d N2, as for an upload (after the move committed): skip, but
    // never silently under a folder seen with custody.
    await assertNoSeenCustodyAbove(destinationId)
    return
  }
  const root = await sharedRootFor(destinationId, destinationId)
  if (!root) return
  if ((await folderWrapFormat(root, destinationId)) !== 'l7') return
  // L15 (b)3: only a destination the move picker showed inside R. Its answer
  // is the only proof that the user saw R for this destination: a local custody
  // record says no more than that R was seen before, and the root above comes
  // from the server's parent walk. No answer (undefined or null) means the
  // destination was not shown inside a known root, so nothing is published.
  if (args.pickerRootId !== root) return
  const byId: ReadonlyMap<string, MovableRow> = Array.isArray(rows)
    ? new Map(rows.map((row) => [row.id, row]))
    : (rows ?? new Map())

  // The moved rows, then every descendant of a moved folder.
  const items: { id: string; isFolder: boolean; foreign: boolean; nameEncrypted?: string }[] = []
  for (const id of ids) {
    const row = byId.get(id)
    const isFolder = !!row?.is_folder
    // A row the caller did not list is treated as someone else's: never sealed.
    items.push({
      id,
      isFolder,
      foreign: !row || needsOwnership(row, viewerId),
      nameEncrypted: row?.name_encrypted,
    })
    if (isFolder) {
      for (const child of await collectAllChildItems(id)) {
        items.push({
          id: child.id,
          isFolder: child.isFolder,
          foreign: needsOwnership({ acted_via_share_id: child.actedViaShareId, uploaded_by: child.uploadedBy }, viewerId),
          nameEncrypted: child.nameEncrypted,
        })
      }
    }
  }

  const folderKey = await folderKeyForRoot(masterKey, root)
  if (!folderKey) throw new Error('The shared folder key is not available on this device.')
  try {
    const entries: { file_id: string; encrypted_file_key: string }[] = []
    for (const item of items) {
      // A guest or member row keeps its own wrap; it is never re-sealed.
      if (item.foreign) continue
      // A row whose sealed name we do not hold cannot be proven: skip it.
      if (!item.nameEncrypted) continue
      let resolved
      try {
        resolved = await ownedItem.resolve({
          masterKey,
          itemId: item.id,
          kind: item.isFolder ? 2 : 1,
          nameEncrypted: item.nameEncrypted,
          sharedFolderId: root,
          folderKey,
        })
      } catch {
        // Not a row this client can resolve: leave it for "Share N items".
        continue
      }
      try {
        // Only a key the resolver proved against the row's own name is published:
        // a plaintext or binary-convention name is never sealed under a guess.
        if (!PROVEN_ORIGINS.has(resolved.origin)) continue
        entries.push({
          file_id: item.id,
          encrypted_file_key: await sealChildKey(
            folderKey,
            { rootId: root, itemId: item.id, isFolder: item.isFolder },
            resolved.key,
          ),
        })
      } finally {
        zeroize(resolved.key)
        if (resolved.contentKey) zeroize(resolved.contentKey)
      }
    }
    for (let start = 0; start < entries.length; start += PUBLISH_BATCH) {
      await publishSharedFolderKeys(root, entries.slice(start, start + PUBLISH_BATCH))
    }
  } finally {
    zeroize(folderKey)
  }
}
