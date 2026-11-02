/**
 * Contract 2275, L13 — the id a create proposes.
 *
 * A create's id is minted in core (`newOwnerItemId` / `newForeignItemId`) and
 * persisted with the tag that lets the same session resume it. The file key is
 * core's derivation under that id (also the member's rule for a new foreign
 * item, L12). No site calls `crypto.randomUUID()` for a create.
 */
import { deriveFileKey } from './crypto'
import { ownedItem, type IdClass, type NewItemIdHandle } from './owned-item'

export interface UploadIdentity {
  idText: string
  tag: Uint8Array
  fileKey: Uint8Array
  idClass: IdClass
}

/** Mint a new item id and the key this client writes it under. */
export async function mintUploadIdentity(masterKey: Uint8Array, idClass: IdClass): Promise<UploadIdentity> {
  const minted = await ownedItem.mint(masterKey, idClass)
  return withDerivedKey(masterKey, minted)
}

/**
 * Re-open a persisted create session: core re-checks the tag and the id, so a
 * substituted id cannot be sealed under (L13). The key follows the id, not the
 * other way round.
 */
export async function resumeUploadIdentity(
  masterKey: Uint8Array,
  idText: string,
  tag: Uint8Array,
): Promise<UploadIdentity> {
  const resumed = await ownedItem.resume(masterKey, idText, tag)
  return withDerivedKey(masterKey, resumed)
}

async function withDerivedKey(masterKey: Uint8Array, minted: NewItemIdHandle): Promise<UploadIdentity> {
  return {
    idText: minted.idText,
    tag: minted.tag,
    fileKey: await deriveFileKey(masterKey, minted.idText),
    idClass: minted.idClass,
  }
}
