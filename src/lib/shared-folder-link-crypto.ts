/**
 * Task 2237b — link key custody.
 *
 * Every folder link carries `K_c` in its own URL fragment (`#key=...`). The
 * server stores one wrap per link: `wrap(linkUnwrapKey(K_c, stretch), folderKey)`
 * where `stretch` is the passphrase derivation for a protected link and null
 * for a plain one. This module is the ONLY place that unwrap key is built, and
 * the only place the passphrase stretching exists.
 */
import {
  combineFolderLinkKey,
  deriveFolderLinkPassphraseStretch,
  encryptChunk,
  decryptChunk,
  fromBase64,
  generateShareToken,
  toBase64,
  toBase64url,
  unwrapKeyFromShare,
  unwrapLinkOwnerKey,
  unwrapLinkOwnerToken,
  wrapKeyForShare,
  wrapLinkOwnerKey,
  wrapLinkOwnerToken,
} from './crypto'
import { FolderNotAvailableError, resolveFolderLink } from './folder-link-public'
import { extractShareKeyToken } from './share-key'
import type { FolderAccessLevel, Proof } from './folder-link-types'
import { buildFullShareLink } from './share-full-link'
import { normalizeLinkPassphrase } from './link-passphrase'

export { EmptyLinkPassphraseError, normalizeLinkPassphrase } from './link-passphrase'

export const LINK_PASSPHRASE_SALT_LABEL = 'beebeeb-folder-link-passphrase-v1'

const SECRET_BYTES = 32

/** 32 random bytes; the link secret that never reaches the server. */
export function generateLinkKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
}

/**
 * The link's own token: 32 random bytes, URL-safe base64 with no padding.
 *
 * `generateShareToken()` is the 20-byte file-share shape (27 chars) and the
 * folder-link route rejects it with 400 — a folder link guards a whole tree,
 * so the route pins 32 bytes (found by the Task 17 browser run).
 */
export function generateFolderLinkToken(): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)))
}

/** The `#key=` fragment value (base64url, no padding). */
export function linkKeyFragment(linkKey: Uint8Array): string {
  return toBase64url(linkKey)
}

/** Extract a 32-byte link key from a hash / URL / bare fragment value. */
export function readLinkKeyFragment(hash: string): Uint8Array | null {
  const candidate = extractShareKeyToken(hash)
  if (!candidate) return null
  // `fromBase64` is `atob`: normalise base64url to standard first.
  const standard = candidate.replace(/-/g, '+').replace(/_/g, '/')
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4)
  try {
    const bytes = fromBase64(padded)
    return bytes.length === SECRET_BYTES ? bytes : null
  } catch {
    return null
  }
}

/**
 * Argon2id stretch of the passphrase, in core (decision L6): NFC, the
 * token-bound salt SHA-256(token || LINK_PASSPHRASE_SALT_LABEL)[..16] and the
 * cost all live there. NEVER used alone as a key: it is always combined with
 * `K_c` through `linkUnwrapKey`. A blank passphrase is refused here first, so
 * whitespace never quietly stands in for one.
 */
export async function deriveLinkPassphraseKey(
  rawPassphrase: string,
  token: string,
): Promise<Uint8Array> {
  return deriveFolderLinkPassphraseStretch(normalizeLinkPassphrase(rawPassphrase), token)
}

/** `combine_folder_link_key(K_c, stretch)` via core (wasm). */
export async function linkUnwrapKey(
  kc: Uint8Array,
  passphraseStretch: Uint8Array | null,
): Promise<Uint8Array> {
  return combineFolderLinkKey(kc, passphraseStretch)
}

export async function wrapFolderKeyForLink(
  folderKey: Uint8Array,
  linkKey: Uint8Array,
): Promise<string> {
  return toBase64(await wrapKeyForShare(linkKey, folderKey))
}

export async function unwrapFolderKeyFromLink(
  wrappedB64: string,
  linkKey: Uint8Array,
): Promise<Uint8Array> {
  return unwrapKeyFromShare(linkKey, fromBase64(wrappedB64))
}

/**
 * A link's `owner_wrapped_key` (decision L2, spec §6): the link secret K_c
 * sealed to the owner's master key, so the owner can copy the link again later
 * (`rebuildFolderLinkUrl`). It is NOT the folder key; the folder key's only
 * owner copy is the custody record.
 *
 * Decision L6/L6a: sealed by core under a purpose key bound to the link's
 * share id (`"beebeeb-link-owner-key-v1" || share_id`), which the client
 * proposes at create time. It opens for no other link and as nothing else.
 */
export async function ownerWrappedLinkKey(
  masterKey: Uint8Array,
  shareId: string,
  linkKey: Uint8Array,
): Promise<string> {
  return toBase64(await wrapLinkOwnerKey(masterKey, shareId, linkKey))
}

/** A link's `owner_wrapped_token`, bound to its share id (`"beebeeb-link-owner-token-v1" || share_id`). */
export async function ownerWrappedLinkToken(
  masterKey: Uint8Array,
  shareId: string,
  token: string,
): Promise<string> {
  return toBase64(await wrapLinkOwnerToken(masterKey, shareId, new TextEncoder().encode(token)))
}

/**
 * Rebuild a link's full URL from the owner's wrapped copies of its token and
 * K_c, after the panel that created it is long closed. Null when the link has
 * no owner copies, or they do not open with this master key (never a link
 * without its key, never a wrong one).
 */
export async function rebuildFolderLinkUrl(
  link: {
    /** The share id both owner copies are bound to (L6a). */
    id: string
    owner_wrapped_key: string | null
    owner_wrapped_token: string | null
    wrapped_folder_key?: string | null
    passphrase_protected?: boolean
  },
  masterKey: Uint8Array,
  origin: string,
): Promise<string | null> {
  if (!link.owner_wrapped_key || !link.owner_wrapped_token) return null
  let linkKey: Uint8Array | null = null
  try {
    linkKey = await unwrapLinkOwnerKey(masterKey, link.id, fromBase64(link.owner_wrapped_key))
    if (linkKey.length !== SECRET_BYTES) return null
    // A plain link can be proven before it is handed out: its K_c must open
    // the link's own folder-key wrap. (A passphrase link needs the passphrase
    // too, which the owner's device does not keep.)
    if (!link.passphrase_protected && link.wrapped_folder_key) {
      const opened = await unwrapFolderKeyFromLink(link.wrapped_folder_key, await linkUnwrapKey(linkKey, null))
      opened.fill(0)
    }
    const token = new TextDecoder().decode(
      await unwrapLinkOwnerToken(masterKey, link.id, fromBase64(link.owner_wrapped_token)),
    )
    if (!token) return null
    return buildFullShareLink(origin, token, linkKeyFragment(linkKey), 'f')
  } catch {
    return null
  } finally {
    linkKey?.fill(0)
  }
}

export interface FolderKeyResolution {
  folderKey: Uint8Array
  keyVersion: number
  level: FolderAccessLevel
}

export type FolderKeyResult =
  | { kind: 'unlocked'; value: FolderKeyResolution }
  | { kind: 'passphrase_required' }
  | { kind: 'not_available' }
  | { kind: 'update_required' }

/**
 * Resolve a link to its folder key.
 *
 * `passphraseStretch` is the Argon2id output when the page has just verified a
 * passphrase. A passphrase link without a proof reports `passphrase_required`
 * before any key work, and an expired proof is cleared here.
 */
export async function resolveGuestFolderKey(
  token: string,
  proof: Proof | null,
  passphraseStretch: Uint8Array | null = null,
): Promise<FolderKeyResult> {
  const kc = readLinkKeyFragment(globalThis.location?.hash ?? '')
  if (!kc) return { kind: 'not_available' }

  let effectiveProof = proof
  if (proof && proof.expiresAt < Date.now()) {
    try {
      sessionStorage.removeItem(`beebeeb.folderLink.proof.${token}`)
    } catch {
      // ignore
    }
    effectiveProof = null
  }

  let resolved: Awaited<ReturnType<typeof resolveFolderLink>>
  try {
    resolved = await resolveFolderLink(token, effectiveProof)
  } catch (err) {
    if (err instanceof FolderNotAvailableError) return { kind: 'not_available' }
    throw err
  }
  if (resolved.kind === 'passphrase_required') return { kind: 'passphrase_required' }

  const root = resolved.root
  // A reload intentionally re-prompts: the opened key lives only in page memory.
  try { sessionStorage.removeItem('beebeeb.folderLink.key.' + token) } catch { /* unavailable */ }
  if (root.passphrase_protected && !passphraseStretch) return { kind: 'passphrase_required' }
  try {
    const folderKey = await unwrapFolderKeyFromLink(
      root.wrapped_folder_key,
      await linkUnwrapKey(kc, passphraseStretch),
    )
    return {
      kind: 'unlocked',
      value: { folderKey, keyVersion: root.key_version, level: root.access_level },
    }
  } catch {
    return { kind: 'not_available' }
  }
}

// `generateShareToken` and `encryptChunk`/`decryptChunk` are re-exported here
// for the guest upload lane, which must not reach into crypto.ts directly.
export { generateShareToken, encryptChunk, decryptChunk }
