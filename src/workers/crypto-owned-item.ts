/**
 * Owner-side core calls of the crypto worker (contract 2275 L12/L13/L14 and
 * SF-0002's read-repair). Extracted from crypto.worker.ts to keep that file
 * under the size ratchet; every method is still a thin pass-through to core.
 *
 * The worker spreads `ownedItemWorkerOps(...)` into its Comlink surface, so the
 * call shapes on the main thread (`src/lib/crypto.ts`) are unchanged.
 */
import type * as WasmTypes from 'beebeeb-wasm'
import {
  resolveRequestRowWith,
  sealRequestRenameWith,
  type RequestRenameTarget,
  type RequestSeal,
} from '../lib/request-row'

export interface OwnedItemWorkerOps {
  ownerRepairNameKey(
    masterKey: Uint8Array,
    fileId: string,
    nameEncrypted: string,
  ): Promise<{ key: Uint8Array; convention: string }>
  ownerRepairContentKey(
    masterKey: Uint8Array,
    fileId: string,
    firstChunkFrame: Uint8Array,
  ): Promise<{ key: Uint8Array; convention: string }>
  mintItemId(masterKey: Uint8Array, foreign: boolean): Promise<{ idText: string; tag: Uint8Array }>
  resumeItemId(masterKey: Uint8Array, itemId: string, tag: Uint8Array): Promise<{ idText: string; tag: Uint8Array }>
  isForeignItemId(itemId: string): Promise<boolean>
  resolveOwnedItem(args: {
    masterKey: Uint8Array
    itemId: string
    kind: number
    ownerWrap?: Uint8Array | null
    nameEncrypted: string
    sharedFolderId?: string | null
    folderKey?: Uint8Array | null
    folderWrap?: Uint8Array | null
    firstChunkFrame?: Uint8Array | null
  }): Promise<{
    key: Uint8Array
    contentKey: Uint8Array | null
    origin: string
    name: { name?: string; mimeType?: string | null; plaintext?: string; chunkFormat: number } | null
    writeTarget: { itemId: string; pin: number } | null
  }>
  childWrapMatches(
    folderKey: Uint8Array,
    sharedFolderId: string,
    itemId: string,
    kind: number,
    wrapped: Uint8Array,
    expectedKey: Uint8Array,
  ): Promise<boolean>
  resolveRequestRow(
    masterKey: Uint8Array,
    itemId: string,
    requestWrapContext: Uint8Array,
    wrappedRequestPrivate: Uint8Array,
    wrapNonce: Uint8Array,
    senderEphemeralPubkey: Uint8Array,
    wrappedContentKey: Uint8Array,
    nameEncrypted: string,
  ): Promise<{
    /** Worker handle of the decrypt-only `WasmRequestContentReader`. */
    handle: number
    fileId: string
    chunkFormat: number
    nameOrigin: string
    name: string | null
    mimeType: string | null
    seal: RequestSeal
    renameTarget: RequestRenameTarget | null
  }>
  /** §15: the only request-row rename path (string convention, never C). */
  sealRequestRename(
    masterKey: Uint8Array,
    itemId: string,
    pin: number,
    filename: string,
    mimeType: string | null,
  ): Promise<string>
  /** L12: mint a guest (F-class) item id from core. */
  mintGuestItemId(): Promise<string>
  createEncryptorForNewItem(
    masterKey: Uint8Array,
    itemId: string,
    tag: Uint8Array,
    fileSize: number,
    profile: string,
  ): Promise<number>
}

type Wasm = typeof WasmTypes

/** `register` puts a worker-owned encryptor in the registry and returns its handle. */
/** `registerRequestReader` does the same for a §15 request content reader. */
export function ownedItemWorkerOps(
  ensureWasm: () => Promise<Wasm>,
  register: (enc: WasmTypes.WasmChunkEncryptor) => number,
  registerRequestReader: (reader: WasmTypes.WasmRequestContentReader) => number | Promise<number>,
): OwnedItemWorkerOps {
  return {
    // ── SF-0002 owner read-repair ──────────────────────────────────────────
    async ownerRepairNameKey(masterKey, fileId, nameEncrypted) {
      const wasm = await ensureWasm()
      const result = wasm.ownerFileKeyForName(masterKey, fileId, nameEncrypted)
      return { key: result.key as Uint8Array, convention: result.convention as string }
    },

    async ownerRepairContentKey(masterKey, fileId, firstChunkFrame) {
      const wasm = await ensureWasm()
      const result = wasm.ownerFileKeyForContent(masterKey, fileId, firstChunkFrame)
      return { key: result.key as Uint8Array, convention: result.convention as string }
    },

    // ── 2275 L12/L13: the id class, id minting, the resolver ───────────────
    async mintItemId(masterKey, foreign) {
      const wasm = await ensureWasm()
      const minted = foreign ? wasm.newForeignItemId(masterKey) : wasm.newOwnerItemId(masterKey)
      return { idText: minted.idText, tag: Uint8Array.from(minted.tag) }
    },

    async resumeItemId(masterKey, itemId, tag) {
      const wasm = await ensureWasm()
      const resumed = wasm.resumeNewItemId(masterKey, itemId, tag)
      return { idText: resumed.idText, tag: Uint8Array.from(resumed.tag) }
    },

    async isForeignItemId(itemId) {
      return (await ensureWasm()).isForeignItemId(itemId)
    },

    async resolveOwnedItem(args) {
      const wasm = await ensureWasm()
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
        origin: string
        name?: { name?: string; mimeType?: string | null; plaintext?: string; chunkFormat: number }
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

    /** L14: does this wrap open to exactly the expected key? */
    async childWrapMatches(folderKey, sharedFolderId, itemId, kind, wrapped, expectedKey) {
      return (await ensureWasm()).childWrapMatches(folderKey, sharedFolderId, itemId, kind, wrapped, expectedKey)
    },

    /**
     * §15 (2326 = A): one resolver for both seals. Core opens the bound seal
     * or the shipped empty-id seal, names the one it opened, and returns a
     * decrypt-only reader. No content key reaches this side, so a rename can
     * never be sealed under C (`sealRequestRename` is the only path).
     */
    async resolveRequestRow(
      masterKey,
      itemId,
      requestWrapContext,
      wrappedRequestPrivate,
      wrapNonce,
      senderEphemeralPubkey,
      wrappedContentKey,
      nameEncrypted,
    ) {
      const wasm = await ensureWasm()
      const row = resolveRequestRowWith(wasm, {
        masterKey,
        itemId,
        requestWrapContext,
        wrappedRequestPrivate,
        wrapNonce,
        senderEphemeralPubkey,
        wrappedContentKey,
        nameEncrypted,
      })
      return {
        handle: await registerRequestReader(row.content),
        fileId: row.content.fileId,
        chunkFormat: row.content.chunkFormat,
        nameOrigin: row.nameOrigin,
        name: row.name,
        mimeType: row.mimeType,
        seal: row.seal,
        renameTarget: row.renameTarget,
      }
    },

    async sealRequestRename(masterKey, itemId, pin, filename, mimeType) {
      const wasm = await ensureWasm()
      return sealRequestRenameWith(wasm, { masterKey, itemId, pin, filename, mimeType })
    },

    async mintGuestItemId() {
      return (await ensureWasm()).mintGuestItemId()
    },

    /**
     * A push-form encryptor for a NEW row, sealed under the `NewItemId` this
     * client minted (L13). Core re-checks the tag, so an id substituted after
     * minting cannot be sealed under.
     */
    async createEncryptorForNewItem(masterKey, itemId, tag, fileSize, profile) {
      const wasm = await ensureWasm()
      const handle = wasm.resumeNewItemId(masterKey, itemId, tag)
      return register(wasm.WasmChunkEncryptor.forNewItem(handle, BigInt(fileSize), profile))
    },
  }
}
