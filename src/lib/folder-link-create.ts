/**
 * Task 2237b — minting a live folder link, token and keys in one place.
 *
 * The server stores a link's `wrapped_folder_key` but never sees the key that
 * opens it. This module is the only place a folder link's token, link key
 * (K_c) and folder-key custodian are brought together, so the order stays
 * fixed: make sure the folder's key exists and is published to the owner,
 * THEN mint the link.
 *
 * Every link keeps `#key=K_c`. A passphrase link does not replace K_c: its
 * unwrap key is `combine_folder_link_key(K_c, argon2id(passphrase, salt))`,
 * computed by core, and the fragment still carries K_c. Anyone with the URL
 * but not the passphrase can therefore not open the folder, and anyone with
 * the passphrase but not the URL cannot either.
 */
import {
  createFolderLink,
  getSharedFolder,
  registerSharedFolderKey,
  type SharedFolderInfo,
} from './api'
import { deriveFileKey, fromBase64, toBase64 } from './crypto'
import {
  decryptOwnerFolderKey,
  encryptAllChildrenKeys,
  encryptOwnerFolderKey,
  findExistingFolderKey,
} from './folder-share-crypto'
import { encryptActorName } from './guest-actor-name'
import {
  linkErrorCode,
  type CreateFolderLinkRequest,
  type FolderAccessLevel,
  type FolderLinkErrorCode,
} from './folder-link-types'
import { buildFullShareLink } from './share-full-link'
import {
  deriveLinkPassphraseKey,
  generateFolderLinkToken,
  generateLinkKey,
  linkKeyFragment,
  linkUnwrapKey,
  ownerWrappedFolderKey,
  ownerWrappedLinkToken,
  wrapFolderKeyForLink,
} from './shared-folder-link-crypto'

/** The server's per-folder link ceiling (surfaced before the request). */
export const MAX_FOLDER_LINKS = 20

export interface CreateFolderLinkInput {
  folderId: string
  masterKey: Uint8Array
  accessLevel: FolderAccessLevel
  label: string | null
  expiresInHours: number | null
  capBytes: number | null
  passphrase: string | null
  maxOpens: number | null
}

export interface CreatedFolderLink {
  id: string
  token: string
  url: string
  level: FolderAccessLevel
  passphraseProtected: boolean
  keyVersion: number
}

/** Every effect `createFolderLinkWithKeys` needs, injectable for tests. */
export interface CreateFolderLinkPorts {
  getSharedFolder: (folderId: string) => Promise<SharedFolderInfo>
  decryptOwnerFolderKey: typeof decryptOwnerFolderKey
  encryptOwnerFolderKey: typeof encryptOwnerFolderKey
  findExistingFolderKey: typeof findExistingFolderKey
  /** The folder's own deterministic key — the one its name and children use. */
  deriveFileKey: typeof deriveFileKey
  /** Wrap every child key in the subtree under the folder key. */
  encryptAllChildrenKeys: typeof encryptAllChildrenKeys
  registerSharedFolderKey: typeof registerSharedFolderKey
  createFolderLink: typeof createFolderLink
  /** A fresh 32-byte link token, URL-safe base64 with no padding. */
  generateShareToken: () => Promise<string>
  generateLinkKey: typeof generateLinkKey
  deriveLinkPassphraseKey: typeof deriveLinkPassphraseKey
  linkUnwrapKey: typeof linkUnwrapKey
  wrapFolderKeyForLink: typeof wrapFolderKeyForLink
  ownerWrappedFolderKey: typeof ownerWrappedFolderKey
  ownerWrappedLinkToken: typeof ownerWrappedLinkToken
  encryptLabel: (folderKey: Uint8Array, label: string) => Promise<string>
  fromBase64: typeof fromBase64
  toBase64: typeof toBase64
  origin: () => string
}

function browserOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location
  return loc?.origin ?? 'https://app.beebeeb.io'
}

export const REAL_FOLDER_LINK_PORTS: CreateFolderLinkPorts = {
  getSharedFolder,
  decryptOwnerFolderKey,
  encryptOwnerFolderKey,
  findExistingFolderKey,
  deriveFileKey,
  encryptAllChildrenKeys,
  registerSharedFolderKey,
  createFolderLink,
  generateShareToken: async () => generateFolderLinkToken(),
  generateLinkKey,
  deriveLinkPassphraseKey,
  linkUnwrapKey,
  wrapFolderKeyForLink,
  ownerWrappedFolderKey,
  ownerWrappedLinkToken,
  encryptLabel: encryptActorName,
  fromBase64,
  toBase64,
  origin: browserOrigin,
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

function isNotFound(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status
  return status === 404 || errorCode(err) === 'not_found'
}

async function tryReadCustody(
  folderId: string,
  ports: CreateFolderLinkPorts,
): Promise<SharedFolderInfo | null> {
  try {
    return await ports.getSharedFolder(folderId)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/**
 * The folder key, guaranteed to have an owner wrap on the server.
 *
 * Order matters: a folder that already has custody is opened from the stored
 * owner wrap (never re-minted — a second, different key would lock out every
 * member and every existing link). Only a folder with no custody at all walks
 * the invite fallback and then mints one.
 */
async function ensureOwnerFolderKey(
  folderId: string,
  masterKey: Uint8Array,
  ports: CreateFolderLinkPorts,
): Promise<Uint8Array> {
  const info = await tryReadCustody(folderId, ports)
  if (info?.owner_wrapped_folder_key) {
    return ports.decryptOwnerFolderKey(
      masterKey,
      folderId,
      ports.fromBase64(info.owner_wrapped_folder_key),
    )
  }

  // No custody row yet: an active folder invite still carries the key that
  // members hold, so reuse it rather than minting a fresh one.
  const existing = await ports.findExistingFolderKey(masterKey, folderId)
  if (existing) return existing.folderKey

  // No custody and no invite: this is an ordinary folder of the owner's own
  // drive, whose key IS deriveFileKey(masterKey, folderId) — the key its name
  // and every child file key already derive from. Minting a random key here
  // would publish a key that opens nothing the owner already stored.
  const folderKey = await ports.deriveFileKey(masterKey, folderId)
  const wrapped = ports.toBase64(await ports.encryptOwnerFolderKey(masterKey, folderId, folderKey))
  try {
    await ports.registerSharedFolderKey(folderId, {
      owner_wrapped_folder_key: wrapped,
      key_version: 1,
    })
    return folderKey
  } catch (err) {
    // Someone registered a key between our read and our write: their key is
    // the truth. Re-read and open it; never overwrite.
    if (errorCode(err) !== 'key_version_conflict') throw err
    const reread = await tryReadCustody(folderId, ports)
    if (!reread?.owner_wrapped_folder_key) throw err
    return ports.decryptOwnerFolderKey(
      masterKey,
      folderId,
      ports.fromBase64(reread.owner_wrapped_folder_key),
    )
  }
}

export async function createFolderLinkWithKeys(
  input: CreateFolderLinkInput,
  ports: CreateFolderLinkPorts = REAL_FOLDER_LINK_PORTS,
): Promise<CreatedFolderLink> {
  const folderKey = await ensureOwnerFolderKey(input.folderId, input.masterKey, ports)
  try {
    const token = await ports.generateShareToken()

    // K_c is the link secret in the fragment, for protected links too.
    const kc = ports.generateLinkKey()
    const passphrase = input.passphrase?.trim() ? input.passphrase.trim() : null
    const stretch = passphrase ? await ports.deriveLinkPassphraseKey(passphrase, token) : null
    // The guest opens every link through the same core combiner, with no
    // stretch for a plain link — so the owner must wrap under that same key.
    const unwrapKey = await ports.linkUnwrapKey(kc, stretch)
    const wrappedFolderKey = await ports.wrapFolderKeyForLink(folderKey, unwrapKey)

    const body: CreateFolderLinkRequest = {
      folder_id: input.folderId,
      token,
      access_level: input.accessLevel,
      wrapped_folder_key: wrappedFolderKey,
      owner_wrapped_key: await ports.ownerWrappedFolderKey(input.masterKey, folderKey),
      owner_wrapped_token: await ports.ownerWrappedLinkToken(input.masterKey, token),
    }
    // A guest can only read names and bytes for files whose key the owner has
    // published under this folder key. Publishing happens once per subtree;
    // the server keeps the first wrap and ignores later ones.
    const folderKeys = await ports.encryptAllChildrenKeys(input.masterKey, folderKey, input.folderId)
    if (folderKeys.length > 0) body.folder_keys = folderKeys
    if (input.label) body.label_encrypted = await ports.encryptLabel(folderKey, input.label)
    if (input.expiresInHours !== null) body.expires_in_hours = input.expiresInHours
    if (input.maxOpens !== null) body.max_opens = input.maxOpens
    if (input.capBytes !== null) body.cap_bytes = input.capBytes
    if (passphrase) body.passphrase = passphrase

    const created = await ports.createFolderLink(body)

    return {
      id: created.id,
      token,
      url: buildFullShareLink(ports.origin(), token, linkKeyFragment(kc), 'f'),
      level: created.access_level ?? input.accessLevel,
      passphraseProtected: passphrase !== null,
      keyVersion: created.key_version,
    }
  } finally {
    folderKey.fill(0)
  }
}

/**
 * The one place a link action's refusal becomes user-facing copy. Returns null
 * when the server did not send a folder-link code, so the caller keeps its own
 * generic error handling.
 */
export function folderLinkActionError(
  err: unknown,
): { code: FolderLinkErrorCode | 'unknown'; message: string } | null {
  const code = linkErrorCode(err)
  if (code === 'unknown') return null
  const message =
    typeof (err as { message?: unknown })?.message === 'string'
      ? (err as { message: string }).message
      : ''
  return { code, message }
}
