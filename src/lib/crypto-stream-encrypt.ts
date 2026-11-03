// ─── Streaming encryption (core's ChunkEncryptor) ───
// The WASM encryptor is a pointer into the worker's linear memory, so it
// cannot cross Comlink directly: the worker keeps it in a registry and hands
// back an opaque numeric handle, and `StreamingEncryptor` mirrors that handle
// on the main thread. Lifted out of crypto.ts unchanged (move only).

import * as Comlink from 'comlink'
import type { ContentPin } from './content-crypto'
import { withProxy } from './crypto'

//
// The web client adopts the same streaming primitive as CLI/desktop/mobile via
// the WASM `WasmChunkEncryptor`. Because the encryptor instance is a pointer
// into the worker's linear memory, it CANNOT be proxied directly through
// Comlink — instead the worker keeps it in a registry and hands back an opaque
// numeric handle. `StreamingEncryptor` below mirrors that handle on the main
// thread: every method round-trips the handle to the worker, and the WASM
// instance itself never crosses the boundary.

export interface ChunkEncryptorSummary {
  chunk_count: number
  total_plaintext: number
  total_ciphertext: number
  chunk_size_bytes: number
}

export type ChunkProfile = 'desktop' | 'web' | 'mobile' | 'backup'

/**
 * Main-thread proxy over a worker-owned `WasmChunkEncryptor`.
 *
 * One handle = one file, single consumer. Push plaintext slices in order via
 * `pushChunk`, then call `finish()` exactly once to run the integrity guard
 * and get the summary. On an aborted/failed upload, call `dispose()` to free
 * the worker-side instance. After `finish()` the handle is already gone, so a
 * follow-up `dispose()` is a harmless no-op.
 */
export class StreamingEncryptor {
  #handle: number
  #consumed = false

  constructor(handle: number) {
    this.#handle = handle
  }

  /**
   * Replace / new version of an EXISTING file only (core 1908 checklist item
   * 4): write in the format the file's recorded pin requires. `pin` MUST come
   * from `readFileMetadata` of the file being replaced; a brand-new file never
   * calls this (it would create a v2 file before the gated switch). Call before
   * the first `pushChunk`. Returns the format now written (1 = v1, 2 = v2).
   */
  async applyRecordedPin(pin: ContentPin): Promise<number> {
    return withProxy((p) => p.encryptorApplyRecordedPin(this.#handle, pin))
  }

  /** The chunk format this encryptor writes: 1 = v1, 2 = v2. Record it with the session. */
  async format(): Promise<number> {
    return withProxy((p) => p.encryptorFormat(this.#handle))
  }

  /**
   * Core's resume rule (1908 checklist item 7): may this NEW encryptor
   * continue an interrupted session whose frames are in `storedFormat`
   * (undefined when the resume record does not say)? `'continue'` only for a
   * v1 session resumed by a v1 writer; otherwise `'restart'`: abandon the old
   * session, init a fresh one and upload from chunk 0, never PUT to the old
   * session again (a v2 writer's version id differs from the stored frames').
   */
  async resumePolicy(storedFormat: number | undefined): Promise<'continue' | 'restart'> {
    return withProxy((p) => p.encryptorResumePolicy(this.#handle, storedFormat))
  }

  /**
   * Encrypt one plaintext slice and return the full wire frame
   * (`nonce || ciphertext || tag`) ready to PUT. The plaintext buffer is
   * transferred to the worker (zero-copy) — do not reuse it afterward.
   */
  async pushChunk(plaintext: Uint8Array): Promise<Uint8Array> {
    return withProxy((p) =>
      p.encryptorPushChunk(this.#handle, Comlink.transfer(plaintext, [plaintext.buffer])),
    )
  }

  /**
   * Run the core integrity guard and return the summary. Consumes the handle.
   * Throws if the source shrank (fewer chunks/bytes than the plan).
   */
  async finish(): Promise<ChunkEncryptorSummary> {
    this.#consumed = true
    return withProxy((p) => p.encryptorFinish(this.#handle))
  }

  /**
   * Best-effort release for aborted/failed uploads. Never throws; safe to call
   * after `finish()` (the handle is already gone on the worker side).
   */
  async dispose(): Promise<void> {
    if (this.#consumed) return
    this.#consumed = true
    try {
      await withProxy((p) => p.encryptorDispose(this.#handle))
    } catch (err) {
      console.warn('[crypto] encryptor dispose failed', err)
    }
  }
}

/**
 * Start a streaming encryptor whose chunk plan is derived from `fileSize` +
 * `profile` (the client ladder). Use when the chunk size was NOT overridden by
 * the server. The per-file key is derived inside core from `masterKey` +
 * `fileId` — pass the SAME `fileId` the key will later be derived from.
 */
export async function startEncryptedStream(
  masterKey: Uint8Array,
  fileId: string,
  fileSize: number,
  profile: ChunkProfile = 'web',
): Promise<StreamingEncryptor> {
  const handle = await withProxy((p) => p.createEncryptor(masterKey, fileId, fileSize, profile))
  return new StreamingEncryptor(handle)
}

/**
 * Start a streaming encryptor for a NEW row, sealed under the `NewItemId` this
 * client minted (L13). Core re-checks the tag inside the worker.
 */
export async function startEncryptedStreamForNewItem(
  masterKey: Uint8Array,
  newItemId: { idText: string; tag: Uint8Array },
  fileSize: number,
  profile: ChunkProfile = 'web',
): Promise<StreamingEncryptor> {
  const handle = await withProxy((p) =>
    p.createEncryptorForNewItem(masterKey, newItemId.idText, newItemId.tag, fileSize, profile),
  )
  return new StreamingEncryptor(handle)
}

/**
 * Start a streaming encryptor with an explicit, server-dictated chunk size.
 * Use when the v2 upload-init response overrode `chunk_size` so the client plan
 * cannot diverge from what the server expects.
 */
export async function startEncryptedStreamWithChunkSize(
  masterKey: Uint8Array,
  fileId: string,
  fileSize: number,
  chunkSizeBytes: number,
): Promise<StreamingEncryptor> {
  const handle = await withProxy((p) =>
    p.createEncryptorWithChunkSize(masterKey, fileId, fileSize, chunkSizeBytes),
  )
  return new StreamingEncryptor(handle)
}
