/**
 * Task 2237b — the guest's display name; L16 (2275 T5.7) envelopes.
 *
 * The name is sealed with the folder key, bound to the shared folder id, and
 * kept in this browser only; the server stores the ciphertext next to each
 * contribution so the owner's activity view can show who added what. It never
 * leaves this device in plaintext. Every byte of the format (sanitising
 * included) is core's `sealFolderActorName` / `openFolderActorName`.
 */
import { openActorName, sealActorName } from './crypto'

export const ACTOR_NAME_STORAGE_PREFIX = 'beebeeb.sharedFolder.actorName.'

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode: the name still applies for this session's uploads.
  }
}

/**
 * L16: sealed through core's folder-actor-name writer, bound to the shared
 * folder id. No client-side sanitising or envelope code.
 */
export async function encryptActorName(
  folderKey: Uint8Array,
  sharedFolderId: string,
  name: string,
): Promise<string> {
  return sealActorName(folderKey, sharedFolderId, name)
}

export async function decryptActorName(
  folderKey: Uint8Array,
  sharedFolderId: string,
  b64: string,
): Promise<string | null> {
  try {
    return await openActorName(folderKey, sharedFolderId, b64)
  } catch {
    return null
  }
}

/** Encrypts and persists the name for this folder; returns the ciphertext. */
export async function storeActorName(
  folderId: string,
  folderKey: Uint8Array,
  name: string,
): Promise<string> {
  const encrypted = await encryptActorName(folderKey, folderId, name)
  storageSet(ACTOR_NAME_STORAGE_PREFIX + folderId, encrypted)
  return encrypted
}

/**
 * A skipped prompt is remembered too: an empty value means "this browser was
 * already asked and chose to stay anonymous", which is different from "never
 * asked" (no value at all).
 */
export function storeActorNameSkipped(folderId: string): void {
  storageSet(ACTOR_NAME_STORAGE_PREFIX + folderId, '')
}

export async function readActorName(
  folderId: string,
  folderKey: Uint8Array,
): Promise<string | null> {
  const stored = storageGet(ACTOR_NAME_STORAGE_PREFIX + folderId)
  if (stored === null) return null
  if (stored === '') return ''
  const name = await decryptActorName(folderKey, folderId, stored)
  return name ?? ''
}

/**
 * The sealed name to send with an upload batch: the stored ciphertext when it
 * still opens under this folder's key, else null (never asked, skipped, or a
 * value left from another key). Every batch carries it, not only the first.
 */
export async function readActorNameCiphertext(
  folderId: string,
  folderKey: Uint8Array,
): Promise<string | null> {
  const stored = storageGet(ACTOR_NAME_STORAGE_PREFIX + folderId)
  if (!stored) return null
  return (await decryptActorName(folderKey, folderId, stored)) !== null ? stored : null
}
