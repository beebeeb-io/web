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
import type { DecryptorPort, StreamingDecryptor } from '../../src/lib/crypto'
import { mockModuleScoped } from './scoped-module-mock'

let initialised = false

/** Initialise the committed WASM build once per process and return the module. */
export function loadWasm(): typeof wasm {
  if (!initialised) {
    const wasmPath = fileURLToPath(
      new URL('../../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
    )
    wasm.initSync({ module: readFileSync(wasmPath) })
    initialised = true
  }
  return wasm
}

/** The worker's decryptor calls, in process (what Comlink carries in the app). */
export function inProcessPort(ops: ContentOps): DecryptorPort {
  return {
    decryptorPushFrame: async (handle, frame) => ops.decryptorPushFrame(handle, frame),
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
}

export async function installWasmCryptoMirror(): Promise<WasmCryptoMirror> {
  const w = loadWasm()
  const ops = createContentOps(w)
  const mirror: WasmCryptoMirror = { wasm: w, ops, decryptStreams: [], fileMetadataReads: [] }

  await mockModuleScoped('../../src/lib/crypto', import.meta.dir, (real) => {
    const RealDecryptor = real.StreamingDecryptor as new (
      handle: number,
      port: DecryptorPort,
    ) => StreamingDecryptor
    return {
      readFileMetadata: async (fileKey: Uint8Array, nameEncrypted: string) => {
        mirror.fileMetadataReads.push(nameEncrypted)
        return ops.readFileMetadata(fileKey, nameEncrypted)
      },
      readNameMetadata: async (fileKey: Uint8Array, nameEncrypted: string) =>
        ops.readNameMetadata(fileKey, nameEncrypted),
      startDecryptStream: async (fileKey: Uint8Array, fileId: string, pin: ContentPin) => {
        mirror.decryptStreams.push({ fileId, pin })
        return new RealDecryptor(ops.createDecryptor(fileKey, fileId, pin), inProcessPort(ops))
      },
      encryptNoteFor: async (fileKey: Uint8Array, text: string, pin: ContentPin) =>
        ops.encryptNoteFor(fileKey, text, pin),
      decryptNote: async (fileKey: Uint8Array, noteEncrypted: string) => ops.decryptNote(fileKey, noteEncrypted),
      ownerRepairNameKey: async (masterKey: Uint8Array, fileId: string, nameEncrypted: string) =>
        w.ownerFileKeyForName(masterKey, fileId, nameEncrypted),
      ownerRepairContentKey: async (masterKey: Uint8Array, fileId: string, firstChunkFrame: Uint8Array) =>
        w.ownerFileKeyForContent(masterKey, fileId, firstChunkFrame),
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
