/**
 * Task 1943 — run web's REAL download / note / upload code against REAL core
 * crypto under `bun test`.
 *
 * In the app, `src/lib/crypto.ts` sends every content and note operation to the
 * crypto worker, which runs `createContentOps(wasm)` from
 * `src/lib/content-crypto.ts`. The worker itself cannot load under bun (it
 * imports the WASM through a Vite-only `?url` suffix). This helper replaces
 * ONLY the crypto.ts entry points that would cross into the worker with
 * in-process calls into the very same `createContentOps`, over the committed
 * WASM build (`packages/beebeeb-wasm`, initialised with `initSync`). The
 * decryptor proxy is the real `StreamingDecryptor` class, given an in-process
 * port instead of the Comlink one. So a test drives: the caller's code (framing,
 * finish, discard on error, pin plumbing) -> crypto.ts's real proxy class ->
 * the worker's ops -> core. Only the postMessage hop is skipped.
 *
 * Call `await installWasmCryptoMirror()` at the TOP LEVEL of a test file, before
 * importing the module under test (mockModuleScoped attaches its restore to the
 * calling file).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as wasm from 'beebeeb-wasm'
import { createContentOps, type ContentOps, type ContentPin } from '../../src/lib/content-crypto'
import type { DecryptorPort, ResolveOwnedItemArgs, StreamingDecryptor } from '../../src/lib/crypto'
import { decodeEnvelope, encodeEnvelope } from '../../src/lib/metadata-envelope'
import { mockModuleScoped } from './scoped-module-mock'
import { loadCommittedWasm } from './wasm-preload'

/**
 * The committed WASM build, initialised. The instance is made once per process
 * by the test preload (`wasm-preload.ts`, LD-0079), before any module's
 * import-time `init()`; this only makes sure of it and returns the module.
 */
export function loadWasm(): typeof wasm {
  loadCommittedWasm()
  return wasm
}

/**
 * The worker's decryptor calls, in process (what Comlink carries in the app).
 * `transferFrames` models the app's `Comlink.transfer(frame, [frame.buffer])`
 * (crypto.ts workerDecryptorPort): the caller's frame is DETACHED after a push,
 * as in the browser. Off by default (existing suites were written without it);
 * SF-0002 round 2 turns it on, because the repair retry re-reads chunk 0.
 */
export function inProcessPort(ops: ContentOps, transferFrames = false): DecryptorPort {
  return {
    decryptorPushFrame: async (handle, frame) =>
      ops.decryptorPushFrame(handle, transferFrames ? structuredClone(frame, { transfer: [frame.buffer] }) : frame),
    decryptorFinish: async (handle) => ops.decryptorFinish(handle),
    decryptorDispose: async (handle) => ops.decryptorDispose(handle),
  }
}

export interface WasmCryptoMirror {
  wasm: typeof wasm
  ops: ContentOps
  /** Every `startDecryptStream` call: which file id and pin the caller passed. */
  decryptStreams: Array<{ fileId: string; pin: ContentPin }>
  /** Every `readFileMetadata` call's `nameEncrypted` argument. */
  fileMetadataReads: string[]
  /** Every key `ownerRepairContentKey` handed out (SF-0002: callers must zeroize them). */
  contentRepairKeys: Uint8Array[]
}

export async function installWasmCryptoMirror(
  opts: { transferFrames?: boolean } = {},
): Promise<WasmCryptoMirror> {
  const w = loadWasm()
  const ops = createContentOps(w)
  const mirror: WasmCryptoMirror = { wasm: w, ops, decryptStreams: [], fileMetadataReads: [], contentRepairKeys: [] }

  await mockModuleScoped('../../src/lib/crypto', import.meta.dir, (real) => {
    const RealDecryptor = real.StreamingDecryptor as new (
      handle: number,
      port: DecryptorPort,
    ) => StreamingDecryptor
    return {
      deriveFileKey: async (masterKey: Uint8Array, fileId: string) =>
        w.derive_file_key(masterKey, new TextEncoder().encode(fileId)),
      readFileMetadata: async (fileKey: Uint8Array, nameEncrypted: string) => {
        mirror.fileMetadataReads.push(nameEncrypted)
        return ops.readFileMetadata(fileKey, nameEncrypted)
      },
      readNameMetadata: async (fileKey: Uint8Array, nameEncrypted: string) =>
        ops.readNameMetadata(fileKey, nameEncrypted),
      startDecryptStream: async (fileKey: Uint8Array, fileId: string, pin: ContentPin) => {
        mirror.decryptStreams.push({ fileId, pin })
        return new RealDecryptor(ops.createDecryptor(fileKey, fileId, pin), inProcessPort(ops, opts.transferFrames))
      },
      // The envelope writer/reader are worker crossings (W-P3-2); run core's
      // codec in-process so a rename that re-seals a name does not hang.
      serializeEncryptedBlob: async (nonce: Uint8Array, ciphertext: Uint8Array) =>
        encodeEnvelope(w, nonce, ciphertext),
      parseEncryptedBlob: async (payload: string) => decodeEnvelope(w, payload),
      encryptNoteFor: async (fileKey: Uint8Array, text: string, pin: ContentPin) =>
        ops.encryptNoteFor(fileKey, text, pin),
      decryptNote: async (fileKey: Uint8Array, noteEncrypted: string) => ops.decryptNote(fileKey, noteEncrypted),
      // The worker's encryptFilename (a rename seals its new name with it).
      encryptFilename: async (fileKey: Uint8Array, filename: string) => {
        const r = w.encrypt_metadata(fileKey, filename) as { nonce: Uint8Array; ciphertext: Uint8Array }
        return { nonce: r.nonce, ciphertext: r.ciphertext }
      },
      ownerRepairNameKey: async (masterKey: Uint8Array, fileId: string, nameEncrypted: string) =>
        w.ownerFileKeyForName(masterKey, fileId, nameEncrypted),
      ownerRepairContentKey: async (masterKey: Uint8Array, fileId: string, firstChunkFrame: Uint8Array) => {
        const r = w.ownerFileKeyForContent(masterKey, fileId, firstChunkFrame) as { key: Uint8Array; convention: string }
        mirror.contentRepairKeys.push(r.key)
        return r
      },
      // L13: a create's id is minted in core; run newOwnerItemId/newForeignItemId
      // in process so code that mints under bun does not wait on the worker.
      mintItemIdWorker: async (masterKey: Uint8Array, foreign: boolean) =>
        foreign ? w.newForeignItemId(masterKey) : w.newOwnerItemId(masterKey),
      // 2275 L12: key-context resolves an owner row through core, never a local
      // derivation, so the owner resolver crossing is mirrored too.
      resolveOwnedItemWorker: async (args: ResolveOwnedItemArgs) => {
        const r = w.resolveOwnedKey(
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
          name?: unknown
          writeTarget?: unknown
        }
        return {
          key: r.key,
          contentKey: r.contentKey ?? null,
          origin: r.origin,
          name: (r.name ?? null) as never,
          writeTarget: (r.writeTarget ?? null) as never,
        }
      },
    }
  })

  return mirror
}

// ── Vector helpers ────────────────────────────────────────────────────────────

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Vector = Record<string, any>

/** The vendored copy of core's test-vectors/vectors.json (byte-identical; see core-vectors-kat.test.ts). */
export function loadVectors(): Record<string, Vector> {
  const path = fileURLToPath(new URL('../vectors/core-vectors.v13.json', import.meta.url))
  const root = JSON.parse(readFileSync(path, 'utf8')) as { version: number; vectors: Vector[] }
  return Object.fromEntries(root.vectors.map((v) => [v.name as string, v]))
}
