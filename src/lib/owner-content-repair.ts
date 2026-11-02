// ─── SF-0002: opening a repaired owner version ──────
// An iOS Files-app owner file whose name legitimately repaired to a newer key
// convention has content written under that key. A reader holding the owner's
// ordinary key cannot open chunk 0; core can name the key THAT frame needs, and
// only this file decides when that is allowed. Lifted out of
// encrypted-download.ts unchanged (move only).

import { ownerRepairContentKey, deriveFileKey, startDecryptStream } from './crypto'
import { isOwnerRepairReadOnly, markOwnerRepairReadOnly, ownerRepairKeyFor } from './owner-repair'
import type { FileContentRef } from './encrypted-download'

export /**
 * SF-0002: a version's first frame did not authenticate under the key the
 * caller has. Ask core for the owner key of THAT frame (the caller passes the
 * master key only when it holds one). A key that resolves as `upper_repair`
 * also marks the file read-only for the rest of this session. Null when the
 * frame is not a repaired row, so the caller rethrows the original error.
 *
 * Which keys may take the fallback (round 2, W6): any OWNER key of the row,
 * whichever one the caller resolved: the owner's string derivation, or the key
 * the owner NAME repair resolved for this row (key-context caches only keys
 * core derived from the master key). A shared-folder or other foreign key is
 * never switched to an owner key (SF-0002 review).
 *
 * Which answers are taken:
 * - `upper_repair`: always (that version is read-only; the row is marked);
 * - `string`/`binary`: only for a row that is ALREADY read-only, i.e. a split
 *   row whose name resolved as `upper_repair` and whose content is ordinary.
 *   Opening it is a read of a read-only row. A writable row is never switched
 *   to another write-capable key, which recovery never does.
 */
async function contentKeyFromFrame(
  masterKey: Uint8Array | undefined,
  fileKey: Uint8Array,
  content: FileContentRef,
  firstChunkFrame: Uint8Array,
): Promise<Uint8Array | null> {
  if (!masterKey) return null
  const nameRepaired = sameKey(ownerRepairKeyFor(content.fileId), fileKey)
  if (!nameRepaired && !(await isOwnerDerivedKey(masterKey, content.fileId, fileKey))) return null
  try {
    const repair = await ownerRepairContentKey(masterKey, content.fileId, firstChunkFrame)
    if (!(repair.key instanceof Uint8Array)) return null
    if (repair.convention === 'upper_repair') {
      markOwnerRepairReadOnly(content.fileId)
      return repair.key
    }
    const ordinary = repair.convention === 'string' || repair.convention === 'binary'
    if (ordinary && nameRepaired && isOwnerRepairReadOnly(content.fileId)) return repair.key
    repair.key.fill(0)
    return null
  } catch {
    return null
  }
}

export type ContentDecryptor = Awaited<ReturnType<typeof startDecryptStream>>

/**
 * SF-0002: push chunk 0; when it does not authenticate, retry it ONCE under the
 * owner repair key of that frame (see contentKeyFromFrame). Chunk 0 only: every
 * later frame keeps the key chunk 0 proved. Both readers below use this, and so
 * does the LD-0001 stream setup (contract 5.1).
 *
 * `pushFrame` transfers its frame to the crypto worker (Comlink.transfer), so
 * the caller's copy is detached afterwards: a copy of chunk 0 is kept for the
 * repair whenever a master key is held (round 2: without it the repair read an
 * empty frame and never opened anything in a browser). The repaired key is
 * wiped as soon as it has seeded the new decryptor (round 2, W7).
 *
 * Returns the decryptor to keep reading with (a new one after a repair; the
 * old one is disposed) and chunk 0's plaintext.
 */
export async function pushHeadWithRepair(
  decryptor: ContentDecryptor,
  frame: Uint8Array,
  fileKey: Uint8Array,
  content: FileContentRef,
  masterKey: Uint8Array | undefined,
): Promise<{ decryptor: ContentDecryptor; plaintext: Uint8Array }> {
  const head = masterKey ? frame.slice() : null
  try {
    return { decryptor, plaintext: await decryptor.pushFrame(frame) }
  } catch (err) {
    const repaired = head ? await contentKeyFromFrame(masterKey, fileKey, content, head) : null
    if (!head || !repaired) throw err
    let next: ContentDecryptor
    try {
      // Round 3 (X3): everything from the dispose on sits inside the wipe, so a
      // rejecting dispose (or start) never leaves the repaired key in memory.
      await decryptor.dispose()
      next = await startDecryptStream(repaired, content.fileId, content.pin)
    } finally {
      repaired.fill(0)
    }
    try {
      return { decryptor: next, plaintext: await next.pushFrame(head) }
    } catch (retryErr) {
      await next.dispose()
      throw retryErr
    }
  }
}

/** Constant-time equality of two keys; false when either is missing. */
function sameKey(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Does this key equal the owner's ordinary (string-convention) derivation? */
async function isOwnerDerivedKey(masterKey: Uint8Array, fileId: string, key: Uint8Array): Promise<boolean> {
  const derived = await deriveFileKey(masterKey, fileId)
  try {
    return sameKey(derived, key)
  } finally {
    derived.fill(0)
  }
}
