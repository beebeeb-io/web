/**
 * Task 2237b — minting a live folder link, token and keys in one place.
 *
 * The server stores a link's `wrapped_folder_key` but never sees the key that
 * opens it. This module is the only place a folder link's token, link key
 * (K_c) and folder-key custodian are brought together, so the order stays
 * fixed: make sure the folder's key exists and is published to the owner,
 * THEN mint the link.
 *
 * The folder key is minted at RANDOM (decision L1, plan C review): its one
 * source is the server's custody record (`shared_folders.owner_wrapped_folder_key`),
 * read before anything is minted, so every client and every reload opens the
 * same key. It is never derived from the master key. A link's
 * `owner_wrapped_key` is `wrap(master_key, K_c)` (decision L2, spec §6), so the
 * owner can copy the link again later (`rebuildFolderLinkUrl`).
 *
 * Decisions L6, L6a and L7: the custody record is sealed by core's
 * `wrapFolderCustody`; the link's share id is proposed here, so both owner
 * copies are sealed under it by core; and every child key (the root's own name
 * key included) is an L7 wrap bound to (root, item, kind). Nothing here seals
 * a key by hand.
 *
 * Every link keeps `#key=K_c`. A passphrase link does not replace K_c: its
 * unwrap key is `combine_folder_link_key(K_c, argon2id(passphrase, salt))`,
 * computed by core, and the fragment still carries K_c. Anyone with the URL
 * but not the passphrase can therefore not open the folder, and anyone with
 * the passphrase but not the URL cannot either.
 */
import {
  createFolderLink,
  getSentInvites,
  getSharedFolder,
  registerSharedFolderKey,
  type SharedFolderInfo,
} from './api'
import { deriveFileKey, fromBase64, toBase64, zeroize } from './crypto'
import {
  activeFolderInvites,
  encryptAllChildrenKeys,
  generateFolderKey,
  openFolderCustody,
  sealChildKey,
  sealFolderCustody,
} from './folder-share-crypto'
import { encryptActorName } from './guest-actor-name'
import { forgetSharedFolderCustody } from './owner-adoption'
import {
  linkErrorCode,
  type CreateFolderLinkRequest,
  type FolderAccessLevel,
  type FolderLinkErrorCode,
} from './folder-link-types'
import { buildFullShareLink } from './share-full-link'
import { assertNeverSawCustody, markCustodySeen } from './custody-memory'
import {
  deriveLinkPassphraseKey,
  generateFolderLinkToken,
  generateLinkKey,
  linkKeyFragment,
  linkUnwrapKey,
  normalizeLinkPassphrase,
  ownerWrappedLinkKey,
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
  /** L6: open the folder's custody record. */
  openFolderCustody: typeof openFolderCustody
  /** L6: seal a new custody record. */
  sealFolderCustody: typeof sealFolderCustody
  /**
   * Whether the folder still has active flag-off invites (rv-web198c P1-3).
   * Such a folder is refused until its legacy rows can be upgraded.
   */
  hasActiveLegacyInvites: (folderId: string) => Promise<boolean>
  /** A fresh RANDOM folder key; only when no custody record and no invite exists. */
  generateFolderKey: () => Promise<Uint8Array>
  /** The root folder's own name key (published under the folder key, below). */
  deriveFileKey: typeof deriveFileKey
  /** L7: a child key bound to (root, item, kind). */
  sealChildKey: typeof sealChildKey
  /** Wrap every child key in the subtree under the folder key. */
  encryptAllChildrenKeys: typeof encryptAllChildrenKeys
  registerSharedFolderKey: typeof registerSharedFolderKey
  createFolderLink: typeof createFolderLink
  /** A fresh 32-byte link token, URL-safe base64 with no padding. */
  generateShareToken: () => Promise<string>
  /** The link's share id, a fresh UUIDv4 (L6a). */
  generateLinkId: () => string
  generateLinkKey: typeof generateLinkKey
  deriveLinkPassphraseKey: typeof deriveLinkPassphraseKey
  linkUnwrapKey: typeof linkUnwrapKey
  wrapFolderKeyForLink: typeof wrapFolderKeyForLink
  ownerWrappedLinkKey: typeof ownerWrappedLinkKey
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

// The network and crypto ports resolve their function at call time (not when
// this module first loads), so a module mock registered later always applies.
export const REAL_FOLDER_LINK_PORTS: CreateFolderLinkPorts = {
  getSharedFolder: (...a) => getSharedFolder(...a),
  openFolderCustody: (...a) => openFolderCustody(...a),
  sealFolderCustody: (...a) => sealFolderCustody(...a),
  hasActiveLegacyInvites: async (folderId) => activeFolderInvites(await getSentInvites(), folderId).length > 0,
  generateFolderKey: () => generateFolderKey(),
  deriveFileKey: (...a) => deriveFileKey(...a),
  sealChildKey: (...a) => sealChildKey(...a),
  encryptAllChildrenKeys: (...a) => encryptAllChildrenKeys(...a),
  registerSharedFolderKey: (...a) => registerSharedFolderKey(...a),
  createFolderLink: (...a) => createFolderLink(...a),
  generateShareToken: async () => generateFolderLinkToken(),
  generateLinkId: () => crypto.randomUUID(),
  generateLinkKey,
  deriveLinkPassphraseKey,
  linkUnwrapKey,
  wrapFolderKeyForLink,
  ownerWrappedLinkKey,
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

/** rv-web198c P1-3: shown for a folder that still has flag-off invites. */
export const FOLDER_NEEDS_UPGRADE = 'This folder is shared with an older link format. Upgrade it first.'

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
export async function ensureOwnerFolderKey(
  folderId: string,
  masterKey: Uint8Array,
  ports: CreateFolderLinkPorts = REAL_FOLDER_LINK_PORTS,
): Promise<Uint8Array> {
  const info = await tryReadCustody(folderId, ports)
  if (info?.owner_wrapped_folder_key) {
    const key = await ports.openFolderCustody(
      masterKey,
      folderId,
      ports.fromBase64(info.owner_wrapped_folder_key),
    )
    markCustodySeen(folderId)
    return key
  }
  // L7c: a folder seen with custody before is never re-seeded or re-minted
  // because the server now says "no record".
  assertNeverSawCustody(folderId)

  // No custody row yet. rv-web198c P1-2: custody is NEVER seeded from a
  // legacy invite's owner copy. That copy is opened under the folder-name key,
  // so a server can pass the folder's own name blob off as one, and the name
  // JSON would become the permanent folder key (task [P1] 2255 lands a core
  // verifier with proof of possession; until then nothing is seeded).
  // P1-3: a folder that still has active flag-off invites is refused: custody
  // over its legacy rows would leave every existing child unreadable to its
  // members and guests. Otherwise the folder key is minted at RANDOM
  // (decision L1), never derived from the master key, and registered as the
  // custody record, its one source for every client from then on.
  if (await ports.hasActiveLegacyInvites(folderId)) throw new Error(FOLDER_NEEDS_UPGRADE)
  const folderKey = await ports.generateFolderKey()
  try {
    const wrapped = ports.toBase64(await ports.sealFolderCustody(masterKey, folderId, folderKey))
    await ports.registerSharedFolderKey(folderId, {
      owner_wrapped_folder_key: wrapped,
      key_version: 1,
    })
    // This tab may have cached "not shared" for the folder a moment ago; the
    // next upload into it must publish its wrap (owner-upload-key.ts).
    forgetSharedFolderCustody(folderId)
    markCustodySeen(folderId)
    return folderKey
  } catch (err) {
    // Someone registered a key between our read and our write: their key is
    // the truth. Re-read and open it; never overwrite.
    folderKey.fill(0)
    if (errorCode(err) !== 'key_version_conflict') throw err
    const reread = await tryReadCustody(folderId, ports)
    if (!reread?.owner_wrapped_folder_key) throw err
    forgetSharedFolderCustody(folderId)
    const key = await ports.openFolderCustody(
      masterKey,
      folderId,
      ports.fromBase64(reread.owner_wrapped_folder_key),
    )
    markCustodySeen(folderId)
    return key
  }
}

/** How often a create is re-sealed under a fresh share id after `409 id_taken`. */
export const LINK_ID_ATTEMPTS = 3

function isIdTaken(err: unknown): boolean {
  return errorCode(err) === 'id_taken'
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
    // Empty means "no passphrase"; anything typed is used exactly (NFC), and
    // whitespace-only is refused rather than quietly making a plain link.
    const passphrase = input.passphrase ? normalizeLinkPassphrase(input.passphrase) : null
    const stretch = passphrase ? await ports.deriveLinkPassphraseKey(passphrase, token) : null
    // The guest opens every link through the same core combiner, with no
    // stretch for a plain link — so the owner must wrap under that same key.
    const unwrapKey = await ports.linkUnwrapKey(kc, stretch)
    const wrappedFolderKey = await ports.wrapFolderKeyForLink(folderKey, unwrapKey)
    // rv-web198c P3: the stretch and the combined key are not needed again.
    unwrapKey.fill(0)
    stretch?.fill(0)

    // A guest can only read names and bytes for files whose key the owner has
    // published under this folder key. Publishing happens once per subtree;
    // the server keeps the first wrap and ignores later ones.
    const folderKeys = await ports.encryptAllChildrenKeys(input.masterKey, folderKey, input.folderId, 'l7')
    // The root's own name key, under the folder key too: with a random folder
    // key it is the only way a link or member can read the folder's own name.
    // L7: bound to (root, root, folder).
    const rootNameKey = await ports.deriveFileKey(input.masterKey, input.folderId)
    try {
      folderKeys.unshift({
        file_id: input.folderId,
        encrypted_file_key: await ports.sealChildKey(
          folderKey,
          { rootId: input.folderId, itemId: input.folderId, isFolder: true },
          rootNameKey,
        ),
      })
    } finally {
      zeroize(rootNameKey)
    }
    const labelEncrypted = input.label ? await ports.encryptLabel(folderKey, input.label) : null

    // L6a: the share id is proposed here and both owner copies are sealed under
    // it. A taken id (a UUIDv4 collision) is answered 409 and nothing is
    // stored, so the copies are re-sealed under a fresh id and sent again.
    try {
      for (let attempt = 1; ; attempt += 1) {
        const id = ports.generateLinkId()
        const body: CreateFolderLinkRequest = {
          id,
          folder_id: input.folderId,
          token,
          access_level: input.accessLevel,
          wrapped_folder_key: wrappedFolderKey,
          // L2: the owner's copy of K_c (not of the folder key), so the link can be
          // copied again later from the owner's devices.
          owner_wrapped_key: await ports.ownerWrappedLinkKey(input.masterKey, id, kc),
          owner_wrapped_token: await ports.ownerWrappedLinkToken(input.masterKey, id, token),
          folder_keys: folderKeys,
        }
        if (labelEncrypted) body.label_encrypted = labelEncrypted
        if (input.expiresInHours !== null) body.expires_in_hours = input.expiresInHours
        if (input.maxOpens !== null) body.max_opens = input.maxOpens
        if (input.capBytes !== null) body.cap_bytes = input.capBytes
        if (passphrase) body.passphrase = passphrase

        let created: Awaited<ReturnType<CreateFolderLinkPorts['createFolderLink']>>
        try {
          created = await ports.createFolderLink(body)
        } catch (err) {
          if (isIdTaken(err) && attempt < LINK_ID_ATTEMPTS) continue
          throw err
        }
        // The owner copies are bound to `id`: a server that stored another id
        // would leave a link its owner can never copy again.
        if (created.id !== id) throw new Error('The server stored this link under a different id.')

        return {
          id: created.id,
          token,
          url: buildFullShareLink(ports.origin(), token, linkKeyFragment(kc), 'f'),
          level: created.access_level ?? input.accessLevel,
          passphraseProtected: passphrase !== null,
          keyVersion: created.key_version,
        }
      }
    } finally {
      // K_c lives on only in the URL handed back and in the owner copies.
      kc.fill(0)
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
