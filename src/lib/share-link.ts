import type { MyShare } from '@beebeeb/shared'
import { fromBase64, toBase64url, unwrapKeyFromShare, initCrypto } from './crypto'

/**
 * Rebuild a full, working recipient link for one of the OWNER's shares.
 *
 * The share's decryption key K_c and its raw token are both zero-knowledge — the
 * server stores only ciphertext, and the raw token is SHA-256-hashed at rest. So
 * the ONLY way to re-copy a working `/s/<token>#key=<K_c>` link after creation is
 * to unwrap the owner-wrapped pair under the owner's master key (0709 A+).
 *
 * Returns null — graceful absence — when:
 *   - the vault is locked (no master key in memory), or
 *   - the share predates 0709 A+ (either wrapped field is null/absent).
 * Callers fall back to the honest "the key for this link isn't stored" UX rather
 * than ever copying a keyless or wrong-key link. Never throws.
 */
const KEY_BYTES = 32

export interface ShareLinkContext {
  isUnlocked: boolean
  getMasterKey: () => Uint8Array
  /** Defaults to window.location.origin. */
  origin?: string
}

/**
 * Synchronous, crypto-free check of whether buildShareLink COULD produce a
 * working link right now — i.e. the owner-wrapped pair is present and the vault
 * is unlocked. Use it for the render decision (show a Copy button vs the honest
 * "key not stored" note); call buildShareLink() for the actual link.
 */
export function canRebuildShareLink(
  share: Pick<MyShare, 'owner_wrapped_key' | 'owner_wrapped_token'>,
  isUnlocked: boolean,
): boolean {
  return isUnlocked && !!share.owner_wrapped_key && !!share.owner_wrapped_token
}

export async function buildShareLink(share: MyShare, ctx: ShareLinkContext): Promise<string | null> {
  if (!ctx.isUnlocked) return null
  if (!share.owner_wrapped_key || !share.owner_wrapped_token) return null

  try {
    await initCrypto()
    const masterKey = ctx.getMasterKey()

    // K_c — the per-share client key. Must be exactly 32 bytes.
    const kc = await unwrapKeyFromShare(masterKey, fromBase64(share.owner_wrapped_key))
    if (kc.length !== KEY_BYTES) return null

    // The raw token (variable-length UTF-8 — do NOT length-assert it).
    const tokenBytes = await unwrapKeyFromShare(masterKey, fromBase64(share.owner_wrapped_token))
    const token = new TextDecoder().decode(tokenBytes)
    if (!token) return null

    const origin = ctx.origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
    // Matches ShareDialog: #key carries base64url(K_c), URL-encoded.
    return `${origin}/s/${token}#key=${encodeURIComponent(toBase64url(kc))}`
  } catch {
    return null
  }
}
