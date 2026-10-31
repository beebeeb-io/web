/**
 * L13 (contract 2275) / SF-0001 — a write is sealed under the id the CLIENT
 * chose, never under an id offered in an answer.
 *
 * An owner's file key is derived from the file id. If the server answers a
 * create (or a replace) with a different id, sealing content, a name or a
 * thumbnail under that echoed id hands the key to whoever already holds the
 * key derived from it (a file link, a share, a member's folder wrap). So every
 * answer that names an item — init, create, completion — is compared with the
 * id this client proposed, and any difference aborts before the first seal.
 *
 * The comparison runs inside the request primitives that receive the proposed
 * id (api.ts `createFolder`, `initUpload`, `completeUpload`), so every caller
 * is covered once. Core's `NewItemId`/`WriteTarget` take over these checks in
 * T1/T5; until then this is the client-side check the plan allows.
 */

/** The plain sentence shown when an init or a create answers another item. */
export const SERVER_CHANGED_ITEM_ID_MESSAGE =
  'The server answered with a different item. Nothing was uploaded under it.'

/**
 * The sentence for a COMPLETION that answers another item. The bytes already
 * went up under this client's own id, so the file may exist; the resume record
 * is kept so the next run of this file continues that id instead of uploading
 * a second copy.
 */
export const SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE =
  'The server answered with a different item after the upload. ' +
  'The file may already be on the server, so check your files before you upload it again.'

/** Which answer named another item: an init or create, or a completion. */
export type ItemIdEchoStage = 'create' | 'complete'

/** A create or write answered with an id other than the one this client chose. */
export class ServerChangedItemIdError extends Error {
  readonly code = 'server_changed_item_id'
  readonly stage: ItemIdEchoStage

  constructor(stage: ItemIdEchoStage = 'create') {
    super(stage === 'complete' ? SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE : SERVER_CHANGED_ITEM_ID_MESSAGE)
    this.name = 'ServerChangedItemIdError'
    this.stage = stage
  }
}

/**
 * Abort unless `echoedId` is exactly the id this client chose (byte for byte:
 * an upper-cased echo is another id). Called BEFORE anything is sealed,
 * renamed, published, moved or used as a destination under the answer.
 */
export function assertEchoedItemId(
  chosenId: string,
  echoedId: string | null | undefined,
  stage: ItemIdEchoStage = 'create',
): void {
  if (echoedId !== chosenId) throw new ServerChangedItemIdError(stage)
}

export function isServerChangedItemIdError(err: unknown): err is ServerChangedItemIdError {
  return err instanceof ServerChangedItemIdError
}
