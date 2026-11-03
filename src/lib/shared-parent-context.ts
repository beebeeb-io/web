/**
 * SF-0001 round 5, F7 — the upload context for a paused upload whose parent
 * is inside a folder shared TO this user (a member's upload).
 *
 * A member's upload must record the file key wrapped under the shared
 * folder's key (`SharedFolderUploadContext`), or the owner and the other
 * members cannot open the file. A resume record keeps only the parent id, so
 * the Drive banner asks here before restarting it:
 *
 * - `own`: the parent is not inside a folder shared with this user (an own
 *   folder, an own shared folder, or no parent). The owner path applies.
 * - `member`: it is, under an approved incoming folder-share invite; the
 *   context is rebuilt exactly as the shared-folder page builds it (the wrap
 *   format from the folder's custody record, the key from the invite).
 * - It throws when it cannot answer: the walk up the parents failed
 *   (`SharedParentCheckFailedError`), or the folder's key cannot be resolved
 *   (`SharedParentKeyUnavailableError`). The caller then uploads NOTHING:
 *   never an unwrapped file in a shared folder.
 */
import { getFile, getFolderKeys, getIncomingInvites } from './api'
import { memberFolderCustody, type FolderWrapFormat } from './folder-share-crypto'
import { resolveRecipientFolderKey } from './recipient-folder-key'
import { markCustodySeen } from './custody-memory'
import type { SharedFolderUploadContext } from './encrypted-upload'

/** Shown when the shared folder's key is not available (nothing is uploaded). */
export const SHARED_PARENT_KEY_UNAVAILABLE_COPY =
  "This paused upload goes into a folder shared with you, but that folder's key isn't available here, " +
  "so it was not restarted: without it, the folder's owner and members couldn't open the file. " +
  'Dismiss it from your paused uploads.'

/** Shown when the folder a paused upload goes into could not be checked (nothing is uploaded). */
export const SHARED_PARENT_CHECK_FAILED_COPY =
  "We couldn't check the folder this paused upload goes into, so it was not restarted. " +
  'Try again, or dismiss it from your paused uploads.'

export class SharedParentKeyUnavailableError extends Error {
  constructor() {
    super(SHARED_PARENT_KEY_UNAVAILABLE_COPY)
    this.name = 'SharedParentKeyUnavailableError'
  }
}

export class SharedParentCheckFailedError extends Error {
  readonly cause: unknown
  constructor(cause: unknown) {
    super(SHARED_PARENT_CHECK_FAILED_COPY)
    this.name = 'SharedParentCheckFailedError'
    this.cause = cause
  }
}

/** The sentence the Drive banner shows for a failed resolve. */
export function sharedParentFailureMessage(err: unknown): string {
  return err instanceof SharedParentKeyUnavailableError ? SHARED_PARENT_KEY_UNAVAILABLE_COPY : SHARED_PARENT_CHECK_FAILED_COPY
}

export type ParentUploadContext =
  | { kind: 'own' }
  | { kind: 'member'; context: SharedFolderUploadContext }

export interface SharedParentPorts {
  getIncomingInvites: typeof getIncomingInvites
  getFile: (id: string) => Promise<{ id: string; parent_id: string | null }>
  getFolderKeys: typeof getFolderKeys
  memberFolderCustody: (folderId: string, fromFolderId: string) => Promise<{ shared: unknown | null; flagOn: boolean }>
  resolveRecipientFolderKey: typeof resolveRecipientFolderKey
  markCustodySeen: (folderId: string) => void
}

const REAL_PORTS: SharedParentPorts = {
  getIncomingInvites,
  getFile,
  getFolderKeys,
  memberFolderCustody,
  resolveRecipientFolderKey,
  markCustodySeen,
}

/** A folder tree is never this deep; a longer chain is a loop or a bad answer. */
const MAX_DEPTH = 64

export async function resolveParentUploadContext(
  parentId: string | null | undefined,
  masterKey: Uint8Array,
  ports: SharedParentPorts = REAL_PORTS,
): Promise<ParentUploadContext> {
  if (!parentId) return { kind: 'own' }

  let invites
  try {
    invites = (await ports.getIncomingInvites()).filter((i) => i.is_folder_share && i.status === 'approved')
  } catch (err) {
    throw new SharedParentCheckFailedError(err)
  }
  if (invites.length === 0) return { kind: 'own' }
  const byRoot = new Map(invites.map((i) => [i.file_id, i]))

  // Walk up from the parent to the first folder shared with this user. An
  // own folder's chain ends at its root (parent null) without a match. A
  // failed lookup is no answer: it is never read as "own".
  let current: string | null = parentId
  let root: string | null = null
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (byRoot.has(current)) {
      root = current
      break
    }
    try {
      current = (await ports.getFile(current)).parent_id ?? null
    } catch (err) {
      throw new SharedParentCheckFailedError(err)
    }
  }
  if (current && !root) throw new SharedParentCheckFailedError(new Error('folder chain too deep'))
  if (!root) return { kind: 'own' }

  const invite = byRoot.get(root)!
  let format: FolderWrapFormat
  let folderKeys
  try {
    // The format is never guessed (L7b), as on the shared-folder page.
    const { shared } = await ports.memberFolderCustody(root, parentId)
    format = shared ? 'l7' : 'legacy_invite'
    folderKeys = await ports.getFolderKeys(invite.id)
  } catch (err) {
    throw new SharedParentCheckFailedError(err)
  }
  const resolved = await ports.resolveRecipientFolderKey(invite, masterKey, folderKeys, format)
  if (resolved.status !== 'ok') throw new SharedParentKeyUnavailableError()
  // L7d: recorded before the key is used.
  if (format === 'l7') ports.markCustodySeen(root)
  return {
    kind: 'member',
    context: { folderKey: resolved.folderKey, format, sharedFolderId: root, inviteId: invite.id },
  }
}
