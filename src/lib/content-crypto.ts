// ─── File content + note crypto (core chunk format v2, task 1908 / 1943) ─────
//
// Core 1908 binds every file-content frame to its file, its upload and its
// position (chunk format v2) and gives names, thumbnails and notes their own
// subkeys. A reader must know which format a file's content is in, and it must
// learn that from the file's AUTHENTICATED metadata, never from the server:
// `decrypt_file_metadata` returns the file's "pin" (`chunk_format`, 0 =
// unrecorded, 2 = v2) and every content reader of that file takes it.
//
// These are the ONLY web functions that open file content and notes. They are
// plain functions over the beebeeb-wasm module: the crypto worker runs them
// (`createContentOps(await ensureWasm())`, src/workers/crypto.worker.ts) and
// unit tests run the very same functions over the committed WASM build
// (`initSync`), so a test exercises the code the worker runs. Only the Comlink
// hop between the main thread and the worker is not in that path.
//
// Not here, on purpose: the generic `decrypt_chunk(fileKey, nonce, ct)`. It has
// no position and opens only v1 frames; it stays for key unwrapping
// (`decryptChunk` in crypto.ts) and must never open file content again.

import type * as Wasm from 'beebeeb-wasm'

/** The slice of the beebeeb-wasm module these ops use. */
export type ContentWasm = Pick<
  typeof Wasm,
  | 'WasmChunkDecryptor'
  | 'decrypt_chunk_frame'
  | 'decrypt_file_metadata_with_key'
  | 'decrypt_name_metadata_with_key'
  | 'encrypt_note_for'
  | 'decrypt_note'
>

/** Core `ExpectedChunkFormat::Unrecorded`: the metadata records no format (every file written before the v2 switch). */
export const PIN_UNRECORDED = 0
/** Core `ExpectedChunkFormat::V2`: every upload of this file id is chunk format v2. */
export const PIN_V2 = 2
/** A file's chunk-format pin, as read from its authenticated metadata. */
export type ContentPin = typeof PIN_UNRECORDED | typeof PIN_V2

/** Accept only the two pin codes core defines; anything else is an error, never a guess. */
export function toContentPin(code: unknown): ContentPin {
  if (code === PIN_UNRECORDED || code === PIN_V2) return code
  throw new Error(`unknown chunk-format pin ${String(code)}`)
}

/**
 * A file's authenticated metadata (and so its pin) could not be read: a
 * plaintext name, a name that does not open under this file's key, or a format
 * this core does not know. Its content is then not opened, and no new version
 * or note is written for it: falling back to "unrecorded" would let a server
 * that swapped the name re-enable format detection (task 1908, P1-B).
 */
export class UnverifiedFileMetadataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'UnverifiedFileMetadataError'
  }
}

/** A file's (or folder's) decrypted metadata plus the pin its content readers need. */
export interface PinnedMetadata {
  name: string
  mimeType: string | null
  pin: ContentPin
}

/** What `WasmChunkDecryptor.finish()` returns. */
export interface DecryptSummary {
  chunk_count: number
  /** 1 = v1, 2 = v2. */
  format: number
}

function pinnedFrom(raw: unknown): PinnedMetadata {
  const m = raw as { name?: unknown; mime_type?: unknown; chunk_format?: unknown } | null
  if (!m || typeof m.name !== 'string') throw new Error('metadata reader returned no name')
  return {
    name: m.name,
    mimeType: typeof m.mime_type === 'string' ? m.mime_type : null,
    pin: toContentPin(m.chunk_format),
  }
}

/**
 * The content and note operations, bound to one WASM instance. A
 * `WasmChunkDecryptor` is a pointer into that instance's linear memory, so it
 * never leaves it: callers hold an opaque numeric handle (the same pattern as
 * the worker's `WasmChunkEncryptor` registry).
 */
export function createContentOps(wasm: ContentWasm) {
  interface LiveDecryptor {
    decryptor: Wasm.WasmChunkDecryptor
    /** A private copy of the file key, wiped when this decryptor or its reader ends. */
    key: Uint8Array
    /** The id the file was uploaded under (v2 frames bind it). */
    fileId: string
    /** The authenticated pin the decryptor was created under. */
    pin: ContentPin
  }
  interface LiveReader {
    key: Uint8Array
    fileId: string
    versionId: Uint8Array
    /** 1 = v1, 2 = v2. */
    format: number
  }
  const liveDecryptors = new Map<number, LiveDecryptor>()
  const liveReaders = new Map<number, LiveReader>()
  let nextHandle = 1

  function decryptor(handle: number): LiveDecryptor {
    const d = liveDecryptors.get(handle)
    if (!d) throw new Error(`No live decryptor for handle ${handle}`)
    return d
  }

  function reader(handle: number): LiveReader {
    const r = liveReaders.get(handle)
    if (!r) throw new Error(`No live chunk reader for handle ${handle}`)
    return r
  }

  function wipeKey(key: Uint8Array | undefined): void {
    key?.fill(0)
  }

  return {
    /**
     * A streaming decryptor for ONE file's content. `fileId` is the id the file
     * was uploaded under (v2 frames bind it); `pin` comes from `readFileMetadata`
     * of that file. With pin 2 only v2 frames open; with pin 0 chunk 0 decides
     * (v2, else v1) and the format is then locked.
     */
    createDecryptor(fileKey: Uint8Array, fileId: string, pin: ContentPin): number {
      const d = wasm.WasmChunkDecryptor.fromFileKey(fileKey, fileId, toContentPin(pin))
      const handle = nextHandle++
      liveDecryptors.set(handle, { decryptor: d, key: fileKey.slice(), fileId, pin })
      return handle
    },

    /** Open the next wire frame (`nonce || ciphertext || tag`), in order from chunk 0. */
    decryptorPushFrame(handle: number, frame: Uint8Array): Uint8Array {
      return decryptor(handle).decryptor.pushFrame(frame)
    },

    /**
     * End-of-stream check: throws when no frame was opened or a v2 file ended
     * before its last chunk (truncation). Consumes the decryptor either way.
     * Callers must discard every plaintext byte already produced when this, or
     * any `decryptorPushFrame`, throws.
     */
    decryptorFinish(handle: number): DecryptSummary {
      const entry = decryptor(handle)
      // `finish` takes the WASM instance by value: it is gone after this call,
      // whether it returns or throws.
      liveDecryptors.delete(handle)
      try {
        return entry.decryptor.finish() as DecryptSummary
      } finally {
        wipeKey(entry.key)
      }
    },

    /** Free a decryptor that will not be finished (failed or aborted read). Idempotent. */
    decryptorDispose(handle: number): void {
      const entry = liveDecryptors.get(handle)
      if (!entry) return
      liveDecryptors.delete(handle)
      try {
        entry.decryptor.free()
      } catch {
        // Already consumed: nothing to free.
      } finally {
        wipeKey(entry.key)
      }
    },

    /**
     * Turn a decryptor that has opened chunk 0 into a random-access reader
     * handle. The reader owns the key copy, file id, v2 version id and the
     * format chunk 0 established; the decryptor is freed. Nothing in
     * `openChunkAt` takes a key, format or version id from the page.
     *
     * It REFUSES format 1 when the pin says v2 (a downgrade): with a v2 pin,
     * core only ever opens v2 frames, and this is the belt to that suspender.
     */
    createChunkReader(decryptorHandle: number): number {
      const entry = decryptor(decryptorHandle)
      const d = entry.decryptor
      if (d.chunksDecrypted < 1) {
        throw new Error('createChunkReader needs chunk 0 to be pushed first')
      }
      const format = d.format
      if (format !== 1 && format !== 2) {
        throw new Error(`decryptor reports unknown chunk format ${String(format)}`)
      }
      if (entry.pin === PIN_V2 && format === 1) {
        throw new Error('refusing format 1 for a file whose pin says v2')
      }
      const versionId = d.versionId ? d.versionId.slice() : new Uint8Array(0)
      const handle = nextHandle++
      liveReaders.set(handle, {
        key: entry.key,
        fileId: entry.fileId,
        versionId,
        format,
      })
      // The key copy moves to the reader; keep the decryptor entry from wiping
      // it on dispose.
      entry.key = new Uint8Array(0)
      liveDecryptors.delete(decryptorHandle)
      try {
        d.free()
      } catch {
        // Consumed already: nothing to free.
      }
      return handle
    },

    /**
     * Open ONE frame at its own index. The caller passes only the index, the
     * `is_last` flag and the frame; the key, format and version id stay in the
     * worker.
     */
    openChunkAt(handle: number, index: number, isLast: boolean, frame: Uint8Array): Uint8Array {
      const r = reader(handle)
      return wasm.decrypt_chunk_frame(
        r.key,
        r.fileId,
        r.versionId.length ? r.versionId : new Uint8Array(0),
        index,
        isLast,
        r.format,
        frame,
      )
    },

    /** Close a reader and wipe its key copy. Idempotent. */
    closeChunkReader(handle: number): void {
      const r = liveReaders.get(handle)
      if (!r) return
      liveReaders.delete(handle)
      wipeKey(r.key)
    },

    /** Decryptors not yet finished or disposed (the worker never recycles while one is live). */
    liveDecryptorCount(): number {
      return liveDecryptors.size
    },

    /** Random-access readers not yet closed (the worker never recycles while one is live). */
    liveReaderCount(): number {
      return liveReaders.size
    },

    /**
     * The metadata reader for FILES (core `decrypt_file_metadata_with_key`):
     * name subkey first, then the legacy raw key, both envelope shapes. It
     * REFUSES a plaintext `name_encrypted` (a plaintext name carries no
     * authenticated pin) and an unknown recorded format. Every content read,
     * note write and replace of a file takes its pin from here.
     */
    readFileMetadata(fileKey: Uint8Array, nameEncrypted: string): PinnedMetadata {
      return pinnedFrom(wasm.decrypt_file_metadata_with_key(fileKey, nameEncrypted))
    },

    /**
     * The display / folder reader (core `decrypt_name_metadata_with_key`): the
     * same key and envelope matrix, but a plaintext legacy name reads as itself
     * with pin 0. Never use its pin to read file content.
     */
    readNameMetadata(fileKey: Uint8Array, nameEncrypted: string): PinnedMetadata {
      return pinnedFrom(wasm.decrypt_name_metadata_with_key(fileKey, nameEncrypted))
    },

    /**
     * Seal a note of an EXISTING file or folder under the rule of its recorded
     * pin: pin 2 is always sealed under the note subkey; pin 0 follows core's
     * current write rule (the legacy raw key until the gated v2 switch, so web
     * builds not yet on this core still open it). Returns the canonical
     * `EncryptedBlob` JSON stored in `files.note_encrypted`.
     */
    encryptNoteFor(fileKey: Uint8Array, text: string, pin: ContentPin): string {
      return wasm.encrypt_note_for(fileKey, text, toContentPin(pin))
    },

    /** Open a note: the note subkey first, then the legacy raw key (both envelope shapes). Plaintext is refused. */
    decryptNote(fileKey: Uint8Array, noteEncrypted: string): string {
      return wasm.decrypt_note(fileKey, noteEncrypted)
    },
  }
}

export type ContentOps = ReturnType<typeof createContentOps>

/**
 * Replace / new version of an EXISTING file (core checklist item 4): swap the
 * encryptor under `handle` for one that writes the format the file's recorded
 * pin requires (`withRecordedPin` consumes the old instance, so the registry
 * entry is replaced, or removed when the call throws). Returns the format the
 * encryptor now writes (1 = v1, 2 = v2).
 *
 * New-file rule (lead ruling 2026-10-17): this is called ONLY with a pin read
 * from an existing file's authenticated metadata. A brand-new file id never
 * calls it; passing 2 for a new file would create a v2 file before the gated
 * write switch.
 */
export function applyRecordedPinInRegistry(
  registry: Map<number, Wasm.WasmChunkEncryptor>,
  handle: number,
  pin: ContentPin,
): number {
  const enc = registry.get(handle)
  if (!enc) throw new Error(`No live encryptor for handle ${handle}`)
  const code = toContentPin(pin)
  registry.delete(handle)
  const pinned = enc.withRecordedPin(code)
  registry.set(handle, pinned)
  return pinned.format
}
