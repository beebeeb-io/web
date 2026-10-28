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
  deriveKeys,
  encryptChunk,
  decryptChunk,
  fromBase64,
  generateShareToken,
  toBase64,
  toBase64url,
  unwrapKeyFromShare,
  wrapKeyForShare,
} from './crypto'
import { FolderNotAvailableError, resolveFolderLink } from './folder-link-public'
import { extractShareKeyToken } from './share-key'
import type { FolderAccessLevel, Proof } from './folder-link-types'

export const LINK_PASSPHRASE_SALT_LABEL = 'beebeeb-folder-link-passphrase-v1'

const SECRET_BYTES = 32

/** 32 random bytes; the link secret that never reaches the server. */
export function generateLinkKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
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

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

/**
 * Argon2id stretch of the passphrase. NEVER used alone as a key: it is always
 * combined with `K_c` through `linkUnwrapKey`.
 */
export async function deriveLinkPassphraseKey(
  passphrase: string,
  token: string,
): Promise<Uint8Array> {
  const saltInput = new TextEncoder().encode(token + LINK_PASSPHRASE_SALT_LABEL)
  const salt = (await sha256(saltInput)).slice(0, 16)
  const { masterKey } = await deriveKeys(passphrase, salt)
  return masterKey
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

export async function ownerWrappedFolderKey(
  masterKey: Uint8Array,
  folderKey: Uint8Array,
): Promise<string> {
  return toBase64(await wrapKeyForShare(masterKey, folderKey))
}

export async function ownerWrappedLinkToken(
  masterKey: Uint8Array,
  token: string,
): Promise<string> {
  return toBase64(await wrapKeyForShare(masterKey, new TextEncoder().encode(token)))
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
