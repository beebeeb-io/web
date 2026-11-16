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
 * Core's `NewItemId`/`WriteTarget` take over these checks in T1/T5; until then
 * this is the client-side check the plan allows.
 */

/** The plain sentence shown when the abort fires. */
export const SERVER_CHANGED_ITEM_ID_MESSAGE =
  'The server answered with a different item. Nothing was uploaded under it.'

/**
 * The plain sentence shown when a COMPLETION answered with another id. The
 * chunks are already on the server at that point, so this must not promise
 * that nothing was written — and it longer than the "looks user friendly"
 * heuristic accepts, so `userFriendlyError` carries an explicit branch.
 */
export const SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE =
  'The server answered with a different item when finishing the upload. The file may exist on the server — check your drive before uploading it again.'

/** A create or write answered with an id other than the one this client chose. */
export class ServerChangedItemIdError extends Error {
  readonly code: string = 'server_changed_item_id'

  constructor() {
    super(SERVER_CHANGED_ITEM_ID_MESSAGE)
    this.name = 'ServerChangedItemIdError'
  }
}

/**
 * A completion answered with another id, AFTER every chunk was already PUT.
 * Kept a subclass so the upload error boundary still recognises the abort
 * family; the message is the honest one above.
 */
export class ServerChangedItemIdAfterUploadError extends ServerChangedItemIdError {
  readonly code: string = 'server_changed_item_id_after_upload'

  constructor() {
    super()
    this.name = 'ServerChangedItemIdAfterUploadError'
    this.message = SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE
  }
}

/**
 * Abort unless `echoedId` is exactly the id this client chose. Called BEFORE
 * anything is sealed, renamed, published, moved or used as a destination under
 * the answer.
 */
export function assertEchoedItemId(chosenId: string, echoedId: string | null | undefined): void {
  if (echoedId !== chosenId) throw new ServerChangedItemIdError()
}

/**
 * Same check for a COMPLETION answer: the content is already on the server, so
 * the error says the file may exist there instead of claiming nothing was
 * written.
 */
export function assertEchoedItemIdAfterUpload(
  chosenId: string,
  echoedId: string | null | undefined,
): void {
  if (echoedId !== chosenId) throw new ServerChangedItemIdAfterUploadError()
}

export function isServerChangedItemIdError(err: unknown): err is ServerChangedItemIdError {
  return err instanceof ServerChangedItemIdError
}
