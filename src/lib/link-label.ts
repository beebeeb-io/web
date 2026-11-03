/**
 * L16 (2275 T5.7) — link labels.
 *
 * A link's label ("Family WhatsApp") is sealed under the OWNER's master key and
 * bound to the share id, so only a device that already holds the master key can
 * read it. Members and guests never get a label they could mistake for a proven
 * identity; the activity view only shows what the owner's own devices sealed.
 *
 * The wrap format is core's (`wrapLinkLabel` / `unwrapLinkLabel`); this module
 * only carries base64 across the API boundary.
 */
import { fromBase64, toBase64, unwrapLinkLabel, wrapLinkLabel } from './crypto'

/** Seal a label: base64 of core's wrap under (master key, share id). */
export async function encryptLinkLabel(
  masterKey: Uint8Array,
  shareId: string,
  label: string,
): Promise<string> {
  return toBase64(await wrapLinkLabel(masterKey, shareId, label))
}

/** Open a label; null when it will not open (wrong key, id or a legacy value). */
export async function decryptLinkLabel(
  masterKey: Uint8Array,
  shareId: string,
  wrappedB64: string | null | undefined,
): Promise<string | null> {
  if (!wrappedB64) return null
  try {
    return await unwrapLinkLabel(masterKey, shareId, fromBase64(wrappedB64))
  } catch {
    return null
  }
}
