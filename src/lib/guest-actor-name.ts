/**
 * Task 2237b — the guest's display name.
 *
 * The name is encrypted with the folder key and kept in this browser only; the
 * server stores the ciphertext next to each contribution so the owner's
 * activity view can show who added what. It never leaves this device in
 * plaintext.
 */
import { encryptFilename, readNameMetadata, serializeEncryptedBlob } from './crypto'

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
 * Sealed through core's name writer, so core's name reader opens it and the
 * generic chunk decrypt is never used for a name.
 */
export async function encryptActorName(folderKey: Uint8Array, name: string): Promise<string> {
  const encrypted = await encryptFilename(folderKey, name)
  return serializeEncryptedBlob(encrypted.nonce, encrypted.ciphertext)
}

export async function decryptActorName(
  folderKey: Uint8Array,
  b64: string,
): Promise<string | null> {
  try {
    const meta = await readNameMetadata(folderKey, b64)
    return meta.name
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
  const encrypted = await encryptActorName(folderKey, name)
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
  const name = await decryptActorName(folderKey, stored)
  return name ?? ''
}
