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

/** A create or write answered with an id other than the one this client chose. */
export class ServerChangedItemIdError extends Error {
  readonly code = 'server_changed_item_id'

  constructor() {
    super(SERVER_CHANGED_ITEM_ID_MESSAGE)
    this.name = 'ServerChangedItemIdError'
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

export function isServerChangedItemIdError(err: unknown): err is ServerChangedItemIdError {
  return err instanceof ServerChangedItemIdError
}
