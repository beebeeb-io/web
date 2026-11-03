/**
 * Contract 2275 — where a web editor's save lands (L13, A9b).
 *
 * A request row's CONTENT stays sealed under the request content key C,
 * reached through the request keypair. That row is not the owner's to version:
 * editing its content in a web editor must mint a NEW owner item and save the
 * edit there, leaving the request row and its content key untouched — never a
 * new version under the request row's id and never under C. Every other save
 * keeps the row's own id and replaces its current version.
 *
 * Spec: docs/superpowers/specs/2026-10-29-2275-owner-items-under-collusion-design.md
 *   L13 — request-row content edit / save-as-new is a new O item, never under
 *         C; only the NAME may move to the string convention (A9).
 */
import type { DriveFile } from './api'
import { isRequestUpload } from './file-request-crypto'
import { ownedItem, type NewItemIdHandle } from './owned-item'

/** The fields a save decision reads. Anything else stays with the editor. */
export type SaveTargetFile = Pick<
  DriveFile,
  'id' | 'name_encrypted' | 'file_request_id' | 'sender_ephemeral_pubkey' | 'wrapped_content_key'
>

export interface SaveTargetArgs {
  file: SaveTargetFile
  /** The id the editor asked to save under; undefined means "Keep Both". */
  targetFileId?: string
  masterKey: Uint8Array
  /** Test seam: mint through any NewItemId source. Defaults to the app port. */
  mint?: (masterKey: Uint8Array) => Promise<NewItemIdHandle>
}

export interface SaveTarget {
  /** The id the upload seals under. */
  uploadFileId: string
  /** Present only when a new owner id was minted (L13 tag included). */
  newItemId?: { idText: string; tag: Uint8Array }
  /** Present only for a same-row version update: the row's current name. */
  replaceOf?: { nameEncrypted: string }
  /** True when the save lands as a NEW row rather than a version of `file`. */
  isNewItem: boolean
}

/**
 * Decide where one editor save lands.
 *
 * - A save that targets a REQUEST row's own id mints a fresh owner id through
 *   core and lands as a new item (A9b): the request row keeps its content key
 *   C and is never written by the owner's editor.
 * - A save that targets the row's own id on any other row replaces that row's
 *   current version, under its own key.
 * - A save with a different id (or none, "Keep Both") lands as a new row.
 */
export async function saveTargetFor({
  file,
  targetFileId,
  masterKey,
  mint,
}: SaveTargetArgs): Promise<SaveTarget> {
  const mintOwner = mint ?? ((masterKey: Uint8Array) => ownedItem.mint(masterKey, 'owner'))
  if (targetFileId === undefined) {
    // L13: "Keep Both" is a create too, so its id is core's, never a JS v4,
    // and the tag travels with it so the seal can prove nothing substituted it.
    const minted = await mintOwner(masterKey)
    return {
      uploadFileId: minted.idText,
      newItemId: { idText: minted.idText, tag: Uint8Array.from(minted.tag) },
      isNewItem: true,
    }
  }
  const sameFile = targetFileId === file.id
  if (sameFile && isRequestUpload(file)) {
    // A9b: mint in core so the id class, tag and derivation are core's answers.
    // The tag travels with the id so the seal can prove nothing substituted it.
    const minted = await mintOwner(masterKey)
    return {
      uploadFileId: minted.idText,
      newItemId: { idText: minted.idText, tag: Uint8Array.from(minted.tag) },
      isNewItem: true,
    }
  }
  return {
    uploadFileId: targetFileId,
    replaceOf: sameFile ? { nameEncrypted: file.name_encrypted } : undefined,
    isNewItem: targetFileId !== file.id,
  }
}
