// ─── Owner read-repair (SF-0002) ─────────────────────
//
// An older iOS File Provider sealed some owner rows under the file id in
// UPPERCASE (the id the device had in hand), while every other client derives
// under the canonical lowercase id. Core 064c622 gives the owner a way back in
// (`owner_file_key_for_name` / `owner_file_key_for_content`) without re-keying
// or rewriting anything: this client may READ such a row, never change it.
//
// This module holds the two helpers and the process-wide read-only marks. The
// rule (workspace lead's ruling, read-only recovery):
//   1. names: try the key this client already derives first; only when that
//      fails for an owner row, ask core for the name-repair key;
//   2. content, per version: try the existing key first; only when the first
//      frame does not authenticate, ask core for the content-repair key of
//      that frame;
//   3. a row whose NAME or ANY version resolved as `upper_repair` is read-only
//      here: no rename, no new version/replace, no note or thumbnail write.
//      The message below is the honest explanation shown to the person.

import type * as Wasm from 'beebeeb-wasm'

/** Shown whenever a write is refused on a repaired read-only row. */
export const OWNER_REPAIR_READ_ONLY =
  'This file was saved by an older version of the iOS app. You can open and download it. To change it, save a copy.'

/** Core's `OwnerKeyConvention`, as the WASM boundary spells it. */
export type OwnerRepairConvention = 'string' | 'binary' | 'upper_repair'

export interface OwnerRepairKey {
  fileKey: Uint8Array
  convention: OwnerRepairConvention
}

/** The slice of beebeeb-wasm these helpers use (a Pick, so tests can pass a fake). */
export type OwnerRepairWasm = Pick<typeof Wasm, 'ownerFileKeyForName' | 'ownerFileKeyForContent'>

function opened(raw: unknown): OwnerRepairKey | null {
  const r = raw as { key?: unknown; convention?: unknown } | null
  if (!r || !(r.key instanceof Uint8Array) || typeof r.convention !== 'string') return null
  return { fileKey: r.key, convention: r.convention as OwnerRepairConvention }
}

/**
 * The key for an OWNER row whose name will not open under this client's own
 * derivation. Callers must try the ordinary key first; core itself tries the
 * string, binary and uppercase conventions and authenticates the name, so a
 * not-repairable row (a foreign row, a plaintext name) returns null.
 */
export function ownerRepairNameKeyWith(
  wasm: OwnerRepairWasm,
  masterKey: Uint8Array,
  fileId: string,
  nameEncrypted: string,
): OwnerRepairKey | null {
  try {
    return opened(wasm.ownerFileKeyForName(masterKey, fileId, nameEncrypted))
  } catch {
    return null
  }
}

/**
 * The key for one VERSION whose first frame does not authenticate under the
 * key this client has. `firstChunkFrame` is that version's chunk 0 exactly as
 * it came off the wire (v1 legacy frame or v2 frame 0); core decides.
 */
export function ownerRepairContentKeyWith(
  wasm: OwnerRepairWasm,
  masterKey: Uint8Array,
  fileId: string,
  firstChunkFrame: Uint8Array,
): OwnerRepairKey | null {
  try {
    return opened(wasm.ownerFileKeyForContent(masterKey, fileId, firstChunkFrame))
  } catch {
    return null
  }
}

// ── Read-only marks and repaired keys ─────────────────
// One drive session per tab; a mark only ever names a UUID the server issued
// for this account. Cleared on lock (see key-context).

const readOnlyIds = new Set<string>()
const repairedKeys = new Map<string, Uint8Array>()

/** Remember that this row resolved as upper_repair: it is read-only here. */
export function markOwnerRepairReadOnly(fileId: string): void {
  readOnlyIds.add(fileId)
}

export function isOwnerRepairReadOnly(fileId: string): boolean {
  return readOnlyIds.has(fileId)
}

/** Drop every mark and cached key (vault lock / account change). */
export function clearOwnerRepairReadOnly(): void {
  readOnlyIds.clear()
  for (const key of repairedKeys.values()) key.fill(0)
  repairedKeys.clear()
}

/**
 * Cache the key a repair resolved (copy, caller keeps ownership of its array),
 * and mark the row read-only when the convention is `upper_repair`.
 */
export function rememberOwnerRepairKey(fileId: string, repair: OwnerRepairKey): void {
  repairedKeys.set(fileId, new Uint8Array(repair.fileKey))
  if (repair.convention === 'upper_repair') markOwnerRepairReadOnly(fileId)
}

/** The repaired key already resolved for this row, if any (caller must not mutate it). */
export function ownerRepairKeyFor(fileId: string): Uint8Array | undefined {
  return repairedKeys.get(fileId)
}

/**
 * Refuse a change to a read-only repaired row, in the exact words the person
 * sees. Every write path calls this before it touches the server.
 */
export function assertOwnerRepairWritable(fileId: string): void {
  if (isOwnerRepairReadOnly(fileId)) throw new Error(OWNER_REPAIR_READ_ONLY)
}
