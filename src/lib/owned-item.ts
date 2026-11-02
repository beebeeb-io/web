/**
 * Contract 2275 — the id class and the owner key resolver, as core calls.
 *
 * Nothing in this module decides an id class, mints an id, resolves a key or
 * compares a wrap: every one of those answers comes from core (wasm), and this
 * file only adapts the values so they can cross the worker boundary and be
 * unit-tested in process. In the app the default `ownedItem` port hops to the
 * crypto worker (src/lib/crypto.ts), whose methods are thin pass-throughs to
 * the same exports. Tests build the same ops over the committed wasm build.
 *
 * Spec: docs/superpowers/specs/2026-10-29-2275-owner-items-under-collusion-design.md
 *   L12 — the id class decides the key path; F ids are UUID v8, canonical
 *         lowercase, minted by core; O ids never use a wrap and F ids never
 *         derive from the master.
 *   L13 — creates mint their id with `NewItemId` and propose it; the tag makes
 *         an interrupted session resumable and a substituted id unsealable.
 *   L14 — a wrap comparison is core's `childWrapMatches`.
 */
import type * as Wasm from 'beebeeb-wasm'
import {
  childWrapMatchesWorker,
  isForeignItemIdWorker,
  mintItemIdWorker,
  resolveOwnedItemWorker,
  resolveRequestRowWorker,
  resumeItemIdWorker,
  type ResolveRequestRowArgs,
} from './crypto'

/** L12: an F id is UUID v8 (version nibble 8). */
export const FOREIGN_ID_VERSION = 8

export type IdClass = 'owner' | 'foreign'

/** A minted (or resumed) `NewItemId`, as plain data. */
export interface NewItemIdHandle {
  idText: string
  tag: Uint8Array
  idClass: IdClass
}

/** L12/§6: where a row's key came from. Upper repair is read-only. */
export type KeyOrigin =
  | 'derived'
  | 'derived_binary'
  | 'derived_upper_repair'
  | 'owner_wrap'
  | 'folder_wrap'

export interface ResolvedName {
  name?: string
  mimeType?: string | null
  plaintext?: string
  chunkFormat: number
}

/** L13: the resolved row's write target. Null = the row is not writable here. */
export interface ResolvedWriteTarget {
  itemId: string
  pin: number
}

export interface ResolvedOwnedItem {
  key: Uint8Array
  contentKey: Uint8Array | null
  origin: KeyOrigin
  name: ResolvedName | null
  writeTarget: ResolvedWriteTarget | null
}

/** Everything core needs to resolve one owner-side row (L12). */
export interface ResolveOwnedArgs {
  masterKey: Uint8Array
  itemId: string
  /** 1 = file, 2 = folder. */
  kind: number
  /** The L8 owner wrap, when the server has one. O ids ignore it. */
  ownerWrap?: Uint8Array | null
  nameEncrypted: string
  sharedFolderId?: string | null
  folderKey?: Uint8Array | null
  /** The L7 folder wrap of this item under its shared root. */
  folderWrap?: Uint8Array | null
  firstChunkFrame?: Uint8Array | null
}

/** The core calls this module adapts. */
export type OwnedItemWasm = Pick<
  typeof Wasm,
  | 'newOwnerItemId'
  | 'newForeignItemId'
  | 'resumeNewItemId'
  | 'isForeignItemId'
  | 'resolveOwnedKey'
  | 'childWrapMatches'
  | 'resolveRequestRow'
>

export interface OwnedItemOps {
  /** Mint a new item id of the requested class (L12/L13). */
  mint(masterKey: Uint8Array, idClass: IdClass): Promise<NewItemIdHandle>
  /** Re-open a persisted (id, tag) pair; refuses an id/tag mismatch (L13). */
  resume(masterKey: Uint8Array, idText: string, tag: Uint8Array): Promise<NewItemIdHandle>
  /**
   * The id class, per core. Throws when the text is not a canonical id at all:
   * L12's "not_canonical" is a refusal, never a default.
   */
  isForeign(itemId: string): Promise<boolean>
  /** Resolve an owner-side row's key, name, and write target (L12/L13). */
  resolve(args: ResolveOwnedArgs): Promise<ResolvedOwnedItem>
  /** L14: does this L7 wrap open to exactly the expected key? */
  childWrapMatches(
    folderKey: Uint8Array,
    sharedFolderId: string,
    itemId: string,
    kind: number,
    wrapped: Uint8Array,
    expectedKey: Uint8Array,
  ): Promise<boolean>
  /**
   * L13's request-row resolver: name key is derived-or-C (derived first), the
   * content key stays C. Read-only — request rows have no write target.
   */
  resolveRequestRow(args: ResolveRequestRowArgs): Promise<ResolvedRequestRow>
}

/** The dual key structure a request row needs (L13). */
export interface ResolvedRequestRow {
  contentKey: Uint8Array
  nameKey: Uint8Array
  nameOrigin: string
  name: ResolvedName | null
}

function handle(value: { idText: string; tag: Uint8Array }, idClass: IdClass): NewItemIdHandle {
  return { idText: value.idText, tag: Uint8Array.from(value.tag), idClass }
}

/** Build the ops over any wasm module (tests pass the committed build). */
export function createOwnedItemOps(wasm: OwnedItemWasm): OwnedItemOps {
  return {
    async mint(masterKey, idClass) {
      const minted =
        idClass === 'foreign' ? wasm.newForeignItemId(masterKey) : wasm.newOwnerItemId(masterKey)
      return handle(minted, idClass)
    },
    async resume(masterKey, idText, tag) {
      const resumed = wasm.resumeNewItemId(masterKey, idText, tag)
      // The class is core's answer for the resumed text, never assumed.
      return handle(resumed, wasm.isForeignItemId(idText) ? 'foreign' : 'owner')
    },
    async isForeign(itemId) {
      return wasm.isForeignItemId(itemId)
    },
    async resolve(args) {
      const resolved = wasm.resolveOwnedKey(
        args.masterKey,
        args.itemId,
        args.kind,
        args.ownerWrap ?? null,
        args.nameEncrypted,
        args.sharedFolderId ?? null,
        args.folderKey ?? null,
        args.folderWrap ?? null,
        args.firstChunkFrame ?? null,
      ) as {
        key: Uint8Array
        contentKey?: Uint8Array | null
        origin: KeyOrigin
        name?: ResolvedName
        writeTarget?: { itemId: string; pin: number } | null
      }
      return {
        key: resolved.key,
        contentKey: resolved.contentKey ?? null,
        origin: resolved.origin,
        name: resolved.name ?? null,
        writeTarget: resolved.writeTarget ?? null,
      }
    },
    async childWrapMatches(folderKey, sharedFolderId, itemId, kind, wrapped, expectedKey) {
      return wasm.childWrapMatches(folderKey, sharedFolderId, itemId, kind, wrapped, expectedKey)
    },
    async resolveRequestRow(args) {
      const resolved = wasm.resolveRequestRow(
        args.masterKey,
        args.itemId,
        args.requestId,
        args.wrappedRequestPrivate,
        args.wrapNonce,
        args.senderEphemeralPubkey,
        args.wrappedContentKey,
        args.nameEncrypted,
      ) as {
        contentKey: Uint8Array
        nameKey: Uint8Array
        nameOrigin: string
        name?: ResolvedName
      }
      return {
        contentKey: resolved.contentKey,
        nameKey: resolved.nameKey,
        nameOrigin: resolved.nameOrigin,
        name: resolved.name ?? null,
      }
    },
  }
}

/**
 * The app's port: the same ops, with each answer produced in the crypto
 * worker. Deliberately holds no wasm instance of its own — the main thread
 * never runs these calls.
 */
export const ownedItem: OwnedItemOps = {
  async mint(masterKey, idClass) {
    const minted = await mintItemIdWorker(masterKey, idClass === 'foreign')
    return { ...minted, idClass }
  },
  async resume(masterKey, idText, tag) {
    const resumed = await resumeItemIdWorker(masterKey, idText, tag)
    return { ...resumed, idClass: (await isForeignItemIdWorker(resumed.idText)) ? 'foreign' : 'owner' }
  },
  isForeign: (itemId) => isForeignItemIdWorker(itemId),
  async resolve(args) {
    const resolved = await resolveOwnedItemWorker(args)
    return { ...resolved, origin: resolved.origin as KeyOrigin }
  },
  childWrapMatches: (folderKey, sharedFolderId, itemId, kind, wrapped, expectedKey) =>
    childWrapMatchesWorker(folderKey, sharedFolderId, itemId, kind, wrapped, expectedKey),
  resolveRequestRow: (args) => resolveRequestRowWorker(args),
}

/** Convenience: the id class, or null when core says the text is not canonical. */
export async function idClassOrNull(itemId: string): Promise<IdClass | null> {
  try {
    return (await ownedItem.isForeign(itemId)) ? 'foreign' : 'owner'
  } catch {
    return null
  }
}
