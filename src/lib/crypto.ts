// The crypto facade: named re-exports of the key, chunk, and folder-link primitives.
import * as Comlink from 'comlink'
import type { ContentPin, DecryptSummary, PinnedMetadata } from './content-crypto'
import type { ContentKey } from './request-row'
import { withProxy } from './crypto/service'
import { fromBase64, toBase64, x25519SharedSecret, zeroize } from './crypto/helpers'
import { withCryptoError } from './crypto/errors'
export { __cryptoRestartInternals, initCrypto, withProxy } from './crypto/service'
export { SearchIndexProxy, buildSearchIndex, createSearchIndex, createSharedSearchIndex, searchIndexFromShards, searchIndexSyncPlan, sharedSearchIndexFromShards } from './crypto/search-index'
export type { CoreEncryptedShard, ShardCoordinate, ShardSyncPlan } from './crypto/search-index'
export { FILE_REQUEST_EMPTY_ID, derivePublicFromPrivate, generateRequestKeypair, sealToRequest, unwrapRequestPrivate, wrapRequestPrivate } from './crypto/file-requests'
export type { RequestKeypair } from './crypto/file-requests'
export { decryptTransferBlob, deriveTransferSession, sessionIdToBytes, transferDecrypt, transferDeriveKey, transferDeriveSasBytes, transferEncrypt, transferGenerateKeypair, transferSasToWords } from './crypto/transfers'
export { CHUNK_SIZE, chunkFile, fromBase64, toBase64, x25519SharedSecret, zeroize } from './crypto/helpers'
export { BreachCheckProxy, CeremonyError, CeremonyProxy, createBreachCheck, createSignupCeremony, evaluatePasswordCore } from './crypto/ceremony'
export type { BreachVerdict, CeremonyConfig, PasswordEvaluation } from './crypto/ceremony'
export { CryptoError, cryptoErrorKindOf, withCryptoError } from './crypto/errors'
export type { CryptoErrorKind } from './crypto/errors'
// ─── Key derivation ─────────────────────────────────

/** Derive a master key from a password + salt via Argon2id. */
export async function deriveKeys(
  password: string,
  salt: Uint8Array,
): Promise<{ masterKey: Uint8Array }> {
  const masterKey = await withProxy((p) => p.deriveKeys(password, salt))
  return { masterKey }
}

/** Derive a per-file key from the master key and a file ID string. */
export async function deriveFileKey(
  masterKey: Uint8Array,
  fileId: string,
): Promise<Uint8Array> {
  return withProxy((p) => p.deriveFileKey(masterKey, fileId))
}

// ─── Chunk encryption ───────────────────────────────

export interface EncryptedChunk {
  nonce: Uint8Array
  ciphertext: Uint8Array
}

/** Encrypt a plaintext chunk with AES-256-GCM. */
export async function encryptChunk(
  fileKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<EncryptedChunk> {
  const result = await withProxy((p) => p.encryptChunk(fileKey, plaintext))
  return {
    nonce: result.nonce,
    ciphertext: result.ciphertext,
  }
}

/**
 * Open a blob sealed with `encryptChunk`: generic AES-256-GCM, NO associated
 * data. For KEY UNWRAPPING only (folder keys, user-to-user share keys).
 *
 * Never for file content (task 1908 / 1943): it has no position, opens only
 * v1 frames and cannot be told the file's pin. File content goes through
 * `startDecryptStream` with the pin from `readFileMetadata`. Never for names
 * or notes either (core's readers: `readFileMetadata`, `readNameMetadata`,
 * `decryptNote`). test/1943-no-generic-content-decrypt.test.ts holds the list
 * of files allowed to call this.
 */
export async function decryptChunk(
  fileKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  return withCryptoError(() => withProxy((p) => p.decryptChunk(fileKey, nonce, ciphertext)))
}

/**
 * Task 2237b — `combine_folder_link_key(K_c, stretch)` from core.
 *
 * The one place a link's unwrap key is produced. `stretch` is the Argon2id
 * output for a passphrase link and null for a plain one; the two never mix.
 */
export async function combineFolderLinkKey(
  linkKey: Uint8Array,
  passphraseStretch: Uint8Array | null = null,
): Promise<Uint8Array> {
  return withProxy((p) => p.combineFolderLinkKey(linkKey, passphraseStretch))
}

/** Task 2237b — the per-bucket key of a shared folder's search index. */
export async function deriveSharedFolderIndexKey(
  folderKey: Uint8Array,
  bucket: number,
): Promise<Uint8Array> {
  return withProxy((p) => p.deriveSharedFolderIndexKey(folderKey, bucket))
}

// ─── File content, metadata pins and notes (core 1908, task 1943) ───────────
//
// Core chunk format v2 binds every content frame to its file, its upload and
// its position. Which format a file's content is in is recorded INSIDE its
// encrypted metadata ("the pin"); every content reader, note writer and
// replace upload reads it with core's FILE reader, never from a server field.
// The crypto runs in the worker (`createContentOps`, src/lib/content-crypto.ts).

export {
  PIN_UNRECORDED,
  PIN_V2,
  toContentPin,
  UnverifiedFileMetadataError,
  type ContentPin,
  type DecryptSummary,
  type PinnedMetadata,
} from './content-crypto'

/**
 * Core's metadata reader for FILES: name, MIME type and the content pin.
 * Throws when the name is plaintext, does not open under `fileKey`, or records
 * a format this core does not know. Use its `pin` for every content read, note
 * write and replace of that file.
 */
export async function readFileMetadata(fileKey: Uint8Array, nameEncrypted: string): Promise<PinnedMetadata> {
  return withCryptoError(() => withProxy((p) => p.readFileMetadata(fileKey, nameEncrypted)))
}

/**
 * Core's display / folder reader: like `readFileMetadata`, but a plaintext
 * legacy name reads as itself (pin 0). For showing names and for folders;
 * never the source of a FILE's content pin.
 */
export async function readNameMetadata(fileKey: Uint8Array, nameEncrypted: string): Promise<PinnedMetadata> {
  return withCryptoError(() => withProxy((p) => p.readNameMetadata(fileKey, nameEncrypted)))
}

/** Seal a note of an EXISTING file or folder under the rule of its recorded pin (see src/lib/file-note.ts). */
export async function encryptNoteFor(fileKey: Uint8Array, text: string, pin: ContentPin): Promise<string> {
  return withProxy((p) => p.encryptNoteFor(fileKey, text, pin))
}

/** Open a note: the note subkey first, then the legacy raw key. Throws on plaintext or a wrong key. */
export async function decryptNote(fileKey: Uint8Array, noteEncrypted: string): Promise<string> {
  return withCryptoError(() => withProxy((p) => p.decryptNote(fileKey, noteEncrypted)))
}

// ─── SF-0002 owner read-repair ──────────────────────
// The two core derivations that open a row an older iOS File Provider sealed
// under the uppercase id. See src/lib/owner-repair.ts for the rule; these are
// only the worker transport (the WASM call must stay off the main thread).

/** Owner key for a name that does not open under this client's derived key. */
export async function ownerRepairNameKey(
  masterKey: Uint8Array,
  fileId: string,
  nameEncrypted: string,
): Promise<{ key: Uint8Array; convention: string }> {
  return withProxy((p) => p.ownerRepairNameKey(masterKey, fileId, nameEncrypted))
}

/** Owner key for a version whose first frame does not open under the key we have. */
export async function ownerRepairContentKey(
  masterKey: Uint8Array,
  fileId: string,
  firstChunkFrame: Uint8Array,
): Promise<{ key: Uint8Array; convention: string }> {
  return withProxy((p) => p.ownerRepairContentKey(masterKey, fileId, firstChunkFrame))
}

// ─── 2275 L12/L13: id class, minting, the owner resolver ────────────────────
// Worker transport only. `src/lib/owned-item.ts` holds the typed surface; the
// decisions (class, key, write target, wrap match) are all core's.

export async function mintItemIdWorker(
  masterKey: Uint8Array,
  foreign: boolean,
): Promise<{ idText: string; tag: Uint8Array }> {
  return withProxy((p) => p.mintItemId(masterKey, foreign))
}

export async function resumeItemIdWorker(
  masterKey: Uint8Array,
  itemId: string,
  tag: Uint8Array,
): Promise<{ idText: string; tag: Uint8Array }> {
  return withProxy((p) => p.resumeItemId(masterKey, itemId, tag))
}

export async function isForeignItemIdWorker(itemId: string): Promise<boolean> {
  return withProxy((p) => p.isForeignItemId(itemId))
}

export interface ResolveOwnedItemArgs {
  masterKey: Uint8Array
  itemId: string
  kind: number
  ownerWrap?: Uint8Array | null
  nameEncrypted: string
  sharedFolderId?: string | null
  folderKey?: Uint8Array | null
  folderWrap?: Uint8Array | null
  firstChunkFrame?: Uint8Array | null
}

export async function resolveOwnedItemWorker(args: ResolveOwnedItemArgs): Promise<{
  key: Uint8Array
  contentKey: Uint8Array | null
  origin: string
  name: { name?: string; mimeType?: string | null; plaintext?: string; chunkFormat: number } | null
  writeTarget: { itemId: string; pin: number } | null
}> {
  return withProxy((p) => p.resolveOwnedItem(args))
}

export async function childWrapMatchesWorker(
  folderKey: Uint8Array,
  sharedFolderId: string,
  itemId: string,
  kind: number,
  wrapped: Uint8Array,
  expectedKey: Uint8Array,
): Promise<boolean> {
  return withProxy((p) => p.childWrapMatches(folderKey, sharedFolderId, itemId, kind, wrapped, expectedKey))
}

// ─── 2275 §15 (2326 = A): the request-row resolver ──────────────────────────
// Core opens BOTH seals (bound and the shipped empty-id one), names the seal
// it opened, and returns a decrypt-only content reader. No content key crosses
// to the page; the reader stays in the worker behind a handle.

export interface ResolveRequestRowArgs {
  masterKey: Uint8Array
  itemId: string
  /** The context the request private key was wrapped under: empty for every request so far. */
  requestWrapContext: Uint8Array
  wrappedRequestPrivate: Uint8Array
  wrapNonce: Uint8Array
  senderEphemeralPubkey: Uint8Array
  wrappedContentKey: Uint8Array
  nameEncrypted: string
}

export interface WorkerResolvedRequestRow {
  /** Worker handle of the decrypt-only `WasmRequestContentReader`. */
  handle: number
  fileId: string
  chunkFormat: number
  nameOrigin: string
  name: string | null
  mimeType: string | null
  seal: 'bound' | 'unbound'
  renameTarget: { origin: string; pin: number } | null
}

export async function resolveRequestRowWorker(
  args: ResolveRequestRowArgs,
): Promise<WorkerResolvedRequestRow> {
  return withProxy((p) =>
    p.resolveRequestRow(
      args.masterKey,
      args.itemId,
      args.requestWrapContext,
      args.wrappedRequestPrivate,
      args.wrapNonce,
      args.senderEphemeralPubkey,
      args.wrappedContentKey,
      args.nameEncrypted,
    ),
  )
}

/** §15: a fresh sequential decryptor over a request row's worker-held reader. */
export async function requestReaderDecryptor(readerHandle: number): Promise<number> {
  return withProxy((p) => p.requestReaderDecryptor(readerHandle))
}

/** §15: open ONE frame of a request row (seek / range read). */
export async function requestReaderOpenFrame(
  readerHandle: number,
  versionId: Uint8Array,
  index: number,
  isLast: boolean,
  format: number,
  frame: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) =>
    p.requestReaderOpenFrame(readerHandle, versionId, index, isLast, format, frame),
  )
}

/** §15: free a request row's worker-held reader. */
export async function requestReaderFree(readerHandle: number): Promise<void> {
  await withProxy((p) => p.requestReaderFree(readerHandle))
}

/** §15: the ONLY request-row rename path (string convention, never C). */
export async function sealRequestRenameWorker(
  masterKey: Uint8Array,
  itemId: string,
  pin: number,
  filename: string,
  mimeType: string | null = null,
): Promise<string> {
  return withProxy((p) => p.sealRequestRename(masterKey, itemId, pin, filename, mimeType))
}

/** L12: mint a guest (F-class) item id from core. Needs no master key. */
export async function mintGuestItemIdWorker(): Promise<string> {
  return withProxy((p) => p.mintGuestItemId())
}

/** The worker calls a content decryptor needs. Production: the crypto worker over Comlink. */
export interface DecryptorPort {
  decryptorPushFrame(handle: number, frame: Uint8Array): Promise<Uint8Array>
  decryptorFinish(handle: number): Promise<DecryptSummary>
  decryptorDispose(handle: number): Promise<void>
}

const workerDecryptorPort: DecryptorPort = {
  decryptorPushFrame: (handle, frame) =>
    withProxy((p) => p.decryptorPushFrame(handle, Comlink.transfer(frame, [frame.buffer]))),
  decryptorFinish: (handle) => withProxy((p) => p.decryptorFinish(handle)),
  decryptorDispose: (handle) => withProxy((p) => p.decryptorDispose(handle)),
}

/** Push one frame into a worker-owned decryptor (see `StreamingDecryptor`). */
export async function decryptorPushFrame(handle: number, frame: Uint8Array): Promise<Uint8Array> {
  return workerDecryptorPort.decryptorPushFrame(handle, frame)
}

/** Finish a worker-owned decryptor; consumes it. */
export async function decryptorFinish(handle: number): Promise<DecryptSummary> {
  return workerDecryptorPort.decryptorFinish(handle)
}

/** Release a worker-owned decryptor that will not be finished. */
export async function decryptorDispose(handle: number): Promise<void> {
  return workerDecryptorPort.decryptorDispose(handle)
}

/**
 * Main-thread proxy over a worker-owned `WasmChunkDecryptor`: one file's
 * content, single consumer, frames pushed in order from chunk 0.
 *
 * Contract (core 1908 checklist item 3): call `finish()` after the last frame;
 * when `pushFrame` or `finish` throws, the file is truncated, reordered,
 * spliced or downgraded, and the caller must DISCARD every plaintext byte it
 * already got. `dispose()` frees a decryptor that will not be finished; it is
 * a no-op after `finish()`.
 */
export class StreamingDecryptor {
  #handle: number
  #port: DecryptorPort
  #consumed = false

  constructor(handle: number, port: DecryptorPort = workerDecryptorPort) {
    this.#handle = handle
    this.#port = port
  }

  /** The worker-owned handle. Only `createChunkReader` hands it over. */
  get handle(): number {
    return this.#handle
  }

  /**
   * The worker took this decryptor over (it became a random-access reader).
   * Mark it consumed WITHOUT touching the handle: it no longer exists.
   */
  release(): void {
    this.#consumed = true
  }

  /**
   * Open the next wire frame (`nonce || ciphertext || tag`). The frame's
   * buffer is transferred to the worker: pass a frame that owns its buffer and
   * do not reuse it.
   */
  async pushFrame(frame: Uint8Array): Promise<Uint8Array> {
    if (this.#consumed) throw new Error('decryptor already finished or disposed')
    return this.#port.decryptorPushFrame(this.#handle, frame)
  }

  /** End-of-stream check; consumes the handle whatever it returns. */
  async finish(): Promise<DecryptSummary> {
    if (this.#consumed) throw new Error('decryptor already finished or disposed')
    this.#consumed = true
    return this.#port.decryptorFinish(this.#handle)
  }

  /** Best-effort release for failed or aborted reads. Never throws. */
  async dispose(): Promise<void> {
    if (this.#consumed) return
    this.#consumed = true
    try {
      await this.#port.decryptorDispose(this.#handle)
    } catch (err) {
      console.warn('[crypto] decryptor dispose failed', err)
    }
  }
}

/**
 * Start reading one file's content. `fileId` is the id the file was uploaded
 * under (v2 frames bind it); `pin` comes from `readFileMetadata` of that file.
 *
 * A request row has no key to pass: its `RequestContentSource` starts the
 * decryptor core bound to the row (and ignores `fileId`/`pin`, which core
 * already fixed). Every other row passes its 32-byte key.
 */
export async function startDecryptStream(
  fileKey: ContentKey,
  fileId: string,
  pin: ContentPin,
): Promise<StreamingDecryptor> {
  if (!(fileKey instanceof Uint8Array)) {
    return (await fileKey.startStream()) as unknown as StreamingDecryptor
  }
  const handle = await withProxy((p) => p.createDecryptor(fileKey, fileId, pin))
  return new StreamingDecryptor(handle)
}

/** The worker calls a chunk reader needs. Production: the crypto worker over Comlink. */
export interface ChunkReaderPort {
  createChunkReader(decryptorHandle: number): Promise<number>
  openChunkAt(handle: number, index: number, isLast: boolean, frame: Uint8Array): Promise<Uint8Array>
  closeChunkReader(handle: number): Promise<void>
}

const workerChunkReaderPort: ChunkReaderPort = {
  createChunkReader: (handle) => withProxy((p) => p.createChunkReader(handle)),
  openChunkAt: (handle, index, isLast, frame) =>
    withProxy((p) =>
      p.openChunkAt(handle, index, isLast, Comlink.transfer(frame, [frame.buffer])),
    ),
  closeChunkReader: (handle) => withProxy((p) => p.closeChunkReader(handle)),
}

/**
 * Main-thread proxy over a worker-owned random-access reader (contract LD-0001
 * §5.1). It opens ONE frame at its own index; the key, format and v2 version id
 * live in the worker and are never passed from the page. The plaintext buffer
 * is transferred back, so each call allocates a fresh buffer.
 */
export class ChunkReader {
  #handle: number
  #port: ChunkReaderPort
  #closed = false

  constructor(handle: number, port: ChunkReaderPort = workerChunkReaderPort) {
    this.#handle = handle
    this.#port = port
  }

  /** Open the frame at `index`; `isLast` must be `index === chunkCount - 1`. */
  async openAt(index: number, isLast: boolean, frame: Uint8Array): Promise<Uint8Array> {
    if (this.#closed) throw new Error('chunk reader already closed')
    return this.#port.openChunkAt(this.#handle, index, isLast, frame)
  }

  /** Close the worker-side reader and wipe its key copy. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    try {
      await this.#port.closeChunkReader(this.#handle)
    } catch (err) {
      console.warn('[crypto] chunk reader close failed', err)
    }
  }
}

/**
 * Turn a `StreamingDecryptor` whose chunk 0 was pushed into a random-access
 * reader. The worker frees the decryptor and moves the key copy into the
 * reader; this proxy is then consumed.
 */
export async function createChunkReader(
  decryptor: { handle: number; release?(): void },
  port: ChunkReaderPort = workerChunkReaderPort,
): Promise<ChunkReader> {
  if (decryptor.handle < 0) throw new Error('decryptor is not live')
  let handle: number
  try {
    handle = await port.createChunkReader(decryptor.handle)
  } catch (err) {
    // LD-0001 r4 A-R3: the worker may have built the reader (and moved the
    // key copy into it) before the reply failed. A reader takes its
    // decryptor's handle, so close it by that handle; closing is idempotent
    // and a no-op when no reader was built.
    try {
      await port.closeChunkReader(decryptor.handle)
    } catch {
      // Best effort: the original failure is what the caller needs.
    }
    throw err
  }
  decryptor.release?.()
  return new ChunkReader(handle, port)
}

// ─── Metadata (filename) encryption ─────────────────

export interface EncryptedMetadata {
  nonce: Uint8Array
  ciphertext: Uint8Array
}

/** Encrypt a filename / metadata string with AES-256-GCM. */
export async function encryptFilename(
  fileKey: Uint8Array,
  filename: string,
): Promise<EncryptedMetadata> {
  const result = await withProxy((p) => p.encryptFilename(fileKey, filename))
  return {
    nonce: result.nonce,
    ciphertext: result.ciphertext,
  }
}

/**
 * Encrypt a filename + optional MIME type as JSON metadata.
 * Produces the same format as iOS: `{"name":"...","mime_type":"..."}` encrypted
 * inside the canonical blob envelope. Use this for all new files/folders.
 */
export async function encryptFileMetadata(
  fileKey: Uint8Array,
  filename: string,
  mimeType?: string | null,
): Promise<EncryptedMetadata> {
  const metadataJson = JSON.stringify({ name: filename, mime_type: mimeType ?? null })
  return encryptFilename(fileKey, metadataJson)
}

/**
 * Batched name decryption of many `(fileKey, name_encrypted)` pairs in one
 * Comlink round-trip, through core's display reader (name subkey first, then
 * the legacy raw key; see `decryptManyNames` in the worker). Errors are
 * reported per item; one failure does not abort the batch.
 */
export async function decryptManyNames(
  items: Array<{ id: string; fileKey: Uint8Array; nameEncrypted: string }>,
): Promise<Array<{ id: string; name?: string; mimeType?: string; error?: string }>> {
  if (items.length === 0) return []
  return withProxy((p) => p.decryptManyNames(items))
}

/**
 * Decrypt a DriveFile's `name_encrypted` FOR DISPLAY: `{ name, mimeType }`.
 *
 * Core's display reader does the work (task 1943): the name subkey first (names
 * sealed since core 1908), then the legacy raw key, both envelope shapes, a
 * JSON `{"name","mime_type"}` plaintext or a bare legacy filename, and a
 * plaintext (never encrypted) legacy name as itself. Never throws: an
 * unreadable name shows as "Encrypted file".
 *
 * Not the source of a file's content pin: content reads, note writes and
 * replace uploads use `readFileMetadata`, which refuses what this tolerates.
 */
export async function decryptFileMetadata(
  fileKey: Uint8Array,
  nameEncrypted: string,
): Promise<{ name: string; mimeType: string | null }> {
  // A plaintext legacy name (folders created before name encryption) is shown
  // as-is: exactly what core's reader does, without a worker round trip.
  if (!nameEncrypted.startsWith('{')) {
    return { name: nameEncrypted, mimeType: null }
  }
  try {
    const meta = await readNameMetadata(fileKey, nameEncrypted)
    return { name: meta.name, mimeType: meta.mimeType }
  } catch (err) {
    console.warn('[crypto] decryptFileMetadata failed', {
      nameEncryptedPrefix: nameEncrypted.slice(0, 60),
      keyLength: fileKey.length,
      error: err instanceof Error ? err.message : String(err),
    })
    return { name: 'Encrypted file', mimeType: null }
  }
}

// ─── Recovery phrase ────────────────────────────────

/** Generate a 12-word BIP39 recovery phrase and the corresponding master key. */
export async function generateRecoveryPhrase(): Promise<{
  phrase: string
  masterKey: Uint8Array
}> {
  return withProxy((p) => p.generateRecoveryPhrase())
}

/** Generate a canonical 0708 share token (20 bytes → 27-char url-safe-no-pad
 *  base64) via the single core impl in WASM — matches the server's A1 validator. */
export async function generateShareToken(): Promise<string> {
  return withProxy((p) => p.generateShareToken())
}

/** Recover the master key from a 12-word BIP39 phrase. */
export async function recoverFromPhrase(phrase: string): Promise<Uint8Array> {
  return withProxy((p) => p.recoverFromPhrase(phrase))
}

// ─── OPAQUE protocol ───────────────────────────────

export async function opaqueRegistrationStart(password: string) {
  return withProxy((p) => p.opaqueRegistrationStart(password))
}

export async function opaqueRegistrationFinish(
  clientState: Uint8Array,
  password: string,
  serverResponse: Uint8Array,
) {
  return withProxy((p) => p.opaqueRegistrationFinish(clientState, password, serverResponse))
}

export async function opaqueLoginStart(password: string) {
  return withProxy((p) => p.opaqueLoginStart(password))
}

export async function opaqueLoginFinish(
  clientState: Uint8Array,
  password: string,
  serverResponse: Uint8Array,
  ksfVersion: number,
) {
  return withProxy((p) => p.opaqueLoginFinish(clientState, password, serverResponse, ksfVersion))
}

export async function deriveX25519Public(masterKey: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.deriveX25519Public(masterKey))
}

export async function computeRecoveryCheck(masterKey: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.computeRecoveryCheck(masterKey))
}

/** Derive X25519 signing side from master key (for key exchange). */
export async function deriveX25519Private(masterKey: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.deriveX25519Private(masterKey))
}

/** Compute X25519 shared secret for user-to-user sharing. */
export async function deriveShareKey(
  sharedSecret: Uint8Array,
  fileId: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.deriveShareKey(sharedSecret, fileId))
}

/**
 * A shared folder's key id (task 2133): HKDF-SHA256 of the 32-byte folder key,
 * derived in core. Returns 32 bytes. Not secret, never a key. A key that is
 * not 32 bytes is an error.
 */
export async function folderKeyId(folderKey: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.folderKeyId(folderKey))
}

// ─── Task 2237b, decisions L6 and L7: owned-folder wraps (core) ──────────────
// The only way the web seals or opens a folder child, a custody record or a
// link's owner copies. No client-side sealing, and no unbound fallback: the
// legacy invite format has its own named functions in folder-share-crypto.ts.

/** `kind` of an L7 child wrap: 1 for a file, 2 for a folder. */
export const FOLDER_CHILD_FILE = 1
export const FOLDER_CHILD_FOLDER = 2
export type FolderChildKind = typeof FOLDER_CHILD_FILE | typeof FOLDER_CHILD_FOLDER

/** L7: `nonce || ct` (60 bytes) of `childKey` under `folderKey`, bound to the shared ROOT id, the item id and its kind. */
export async function wrapFolderChild(
  folderKey: Uint8Array,
  rootId: string,
  itemId: string,
  kind: FolderChildKind,
  childKey: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.wrapFolderChild(folderKey, rootId, itemId, kind, childKey))
}

/** L7: open a child wrap. A wrap made for another root, item or kind is refused. */
export async function unwrapFolderChild(
  folderKey: Uint8Array,
  rootId: string,
  itemId: string,
  kind: FolderChildKind,
  wrapped: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.unwrapFolderChild(folderKey, rootId, itemId, kind, wrapped))
}

/** L6: the folder key's custody record (`shared_folders.owner_wrapped_folder_key`). */
export async function wrapFolderCustody(
  masterKey: Uint8Array,
  folderId: string,
  folderKey: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.wrapFolderCustody(masterKey, folderId, folderKey))
}

/** L6: open a custody record. A legacy (unbound) owner copy is refused. */
export async function unwrapFolderCustody(
  masterKey: Uint8Array,
  folderId: string,
  wrapped: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.unwrapFolderCustody(masterKey, folderId, wrapped))
}

// ─── L16 (2275 T5.7): actor names and link labels ───────────────────────────
// Core owns the sanitising (NFC, control stripping, blank refusal) and the
// envelopes; web only carries the bytes. Actor names are bound to the shared
// folder id, link labels to the share id.

/** L16: seal an actor's display name, bound to the shared folder id. */
export async function sealActorName(
  folderKey: Uint8Array,
  sharedFolderId: string,
  name: string,
): Promise<string> {
  return withProxy((p) => p.sealFolderActorName(folderKey, sharedFolderId, name))
}

/** L16: open an actor's display name; a different folder id is refused. */
export async function openActorName(
  folderKey: Uint8Array,
  sharedFolderId: string,
  envelope: string,
): Promise<string> {
  return withProxy((p) => p.openFolderActorName(folderKey, sharedFolderId, envelope))
}

/** L16: seal a link label under the master key, bound to the share id. */
export async function wrapLinkLabel(
  masterKey: Uint8Array,
  shareId: string,
  label: string,
): Promise<Uint8Array> {
  return withProxy((p) => p.wrapLinkLabel(masterKey, shareId, label))
}

/** L16: open a link label; a different share id is refused. */
export async function unwrapLinkLabel(
  masterKey: Uint8Array,
  shareId: string,
  wrapped: Uint8Array,
): Promise<string> {
  return withProxy((p) => p.unwrapLinkLabel(masterKey, shareId, wrapped))
}

/** L6: a link's `owner_wrapped_key` (K_c), bound to the share id. */
export async function wrapLinkOwnerKey(masterKey: Uint8Array, shareId: string, linkKey: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.wrapLinkOwnerKey(masterKey, shareId, linkKey))
}

export async function unwrapLinkOwnerKey(masterKey: Uint8Array, shareId: string, wrapped: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.unwrapLinkOwnerKey(masterKey, shareId, wrapped))
}

/** L6: a link's `owner_wrapped_token`, bound to the share id. */
export async function wrapLinkOwnerToken(masterKey: Uint8Array, shareId: string, token: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.wrapLinkOwnerToken(masterKey, shareId, token))
}

export async function unwrapLinkOwnerToken(masterKey: Uint8Array, shareId: string, wrapped: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.unwrapLinkOwnerToken(masterKey, shareId, wrapped))
}

/** L8: the owner's own copy of a guest or member file key (`owner_wrapped_file_key`), bound to the item id. */
export async function wrapOwnerFileKey(masterKey: Uint8Array, itemId: string, fileKey: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.wrapOwnerFileKey(masterKey, itemId, fileKey))
}

/** L8: open an owner file-key record. A folder name blob or a content frame is refused. */
export async function unwrapOwnerFileKey(masterKey: Uint8Array, itemId: string, wrapped: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.unwrapOwnerFileKey(masterKey, itemId, wrapped))
}

/** The link passphrase stretch, in core (NFC, empty refused, token-bound salt). */
export async function deriveFolderLinkPassphraseStretch(passphrase: string, token: string): Promise<Uint8Array> {
  return withProxy((p) => p.deriveFolderLinkPassphraseStretch(passphrase, token))
}

/** Task 2255: purpose-bound folder-invite owner copies, implemented in core. */
export async function wrapInviteOwnerCopy(masterKey: Uint8Array, folderId: string, folderKey: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.wrapInviteOwnerCopy(masterKey, folderId, folderKey))
}

export async function unwrapInviteOwnerCopy(masterKey: Uint8Array, folderId: string, wrapped: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.unwrapInviteOwnerCopy(masterKey, folderId, wrapped))
}

/**
 * Task 2255 (L9, corrected): open a LEGACY owner copy only when core proves it
 * over the folder's rows (the server's folder-keys rows, verbatim), in one
 * worker call. Null when it does not open, holds text, or is not proven.
 */
export async function openLegacyInviteOwnerCopy(
  masterKey: Uint8Array, folderId: string, legacyCopy: Uint8Array, rows: { file_id: string; encrypted_file_key: string }[],
): Promise<Uint8Array | null> {
  return (await withProxy((p) => p.openLegacyInviteOwnerCopy(masterKey, folderId, legacyCopy, rows))) ?? null
}

/**
 * Encrypt a file key for user-to-user sharing.
 * Performs the full X25519 key exchange + AES-256-GCM encryption.
 */
export async function encryptFileKeyForSharing(
  masterKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  fileId: string,
  fileKey: Uint8Array,
): Promise<{ encryptedFileKey: Uint8Array; nonce: Uint8Array }> {
  const myPrivate = await deriveX25519Private(masterKey)
  const sharedSecret = await x25519SharedSecret(myPrivate, recipientPublicKey)
  // Convert file ID (UUID string) to bytes for HKDF info parameter
  const fileIdBytes = new TextEncoder().encode(fileId)
  const shareKey = await deriveShareKey(sharedSecret, fileIdBytes)
  // Encrypt the file key using the share key via AES-256-GCM
  const result = await encryptChunk(shareKey, fileKey)
  // Zero intermediate key material
  zeroize(myPrivate)
  zeroize(sharedSecret)
  zeroize(shareKey)
  return { encryptedFileKey: result.ciphertext, nonce: result.nonce }
}

// ─── Encrypted blob serialization ──────────────────
//
// The envelope grammar lives in core (`metadata_wire`, W-P3-2): the worker
// writes core's frozen canonical form and reads every form clients have
// stored. See `metadata-envelope.ts`; this file only hops to the worker.

/** Parse an encrypted blob JSON string into raw nonce + ciphertext bytes (core's tolerant reader). */
export async function parseEncryptedBlob(json: string): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  return withCryptoError(() => withProxy((p) => p.decodeMetadataEnvelope(json)))
}

/** Serialize nonce + ciphertext into core's canonical encrypted blob JSON format. */
export async function serializeEncryptedBlob(nonce: Uint8Array, ciphertext: Uint8Array): Promise<string> {
  return withProxy((p) => p.encodeMetadataEnvelope(nonce, ciphertext))
}

// ─── Chunk planning ────────────────────────────────

/**
 * Plan chunks for a file using the core adaptive chunk-size ladder.
 * Returns { chunk_size_bytes, chunk_count } based on file size and profile.
 *
 * Profiles: "desktop", "web", "mobile", "backup".
 * The server may override this during v2 init — the client proposes, server decides.
 */
export async function planChunks(
  fileSizeBytes: number,
  profile: 'desktop' | 'web' | 'mobile' | 'backup' = 'web',
): Promise<{ chunk_size_bytes: number; chunk_count: number }> {
  return withProxy((p) => p.planChunks(fileSizeBytes, profile))
}

// ─── Streaming encryption (shared core ChunkEncryptor) ──────────────────────
// The encryptor proxy lives in crypto-stream-encrypt.ts; re-exported here so
// every consumer keeps importing it from the crypto service.

export {
  StreamingEncryptor,
  startEncryptedStream,
  startEncryptedStreamForNewItem,
  startEncryptedStreamWithChunkSize,
} from './crypto-stream-encrypt'
export type { ChunkEncryptorSummary, ChunkProfile } from './crypto-stream-encrypt'

// ─── Client-side share key wrapping ─────────────────────────────────────────
//
// Used for "double-encrypted" shares where the client generates K_c and wraps
// the file key under it before sending to the server. The server stores the
// opaque blob but can never recover the file key without K_c — which only
// lives in the URL fragment (#key=…) and is never sent to the server.
//
// Wire format: nonce(12 bytes) || AES-256-GCM-ciphertext(32 + 16 tag = 48 bytes)
// Total: 60 bytes.

/**
 * Wrap a file key under a client-generated share key using AES-256-GCM.
 * Returns nonce(12) || ciphertext(48) = 60 bytes.
 *
 * @param wrapKey  32-byte client key (stays in URL fragment, never sent to server)
 * @param keyToWrap  32-byte file key to protect
 */
export async function wrapKeyForShare(
  wrapKey: Uint8Array,
  keyToWrap: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    wrapKey.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    keyToWrap.buffer as ArrayBuffer,
  )
  const result = new Uint8Array(iv.length + encrypted.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(encrypted), iv.length)
  return result
}

/**
 * Unwrap a file key that was previously wrapped with wrapKeyForShare.
 * Used on the share-view page when the recipient opens a double-encrypted link.
 *
 * @param wrapKey  32-byte client key extracted from the URL #key= fragment
 * @param wrappedKey  60-byte blob from the server (nonce || ciphertext)
 */
export async function unwrapKeyFromShare(
  wrapKey: Uint8Array,
  wrappedKey: Uint8Array,
): Promise<Uint8Array> {
  const iv = wrappedKey.slice(0, 12)
  const ciphertext = wrappedKey.slice(12)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    wrapKey.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer,
  )
  return new Uint8Array(plaintext)
}

/**
 * Base64url encode (URL-safe, no padding).
 * Use this for keys in URL fragments — avoids %2B / %2F encoding.
 */
export function toBase64url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ─── Bundle shares (task 0417) ───────────────────────
//
// A bundle share mints ONE anonymous public link (`/s/:token#key=K_c`) over an
// ordered set of files — no folder is created. It reuses the single-file
// double-encrypted model verbatim (NO new crypto primitive, spec §3, D1):
//   - One client key K_c (32B random) lives ONLY in the URL fragment.
//   - For each selected file: FileKey_i = deriveFileKey(masterKey, file_id_i),
//     then wrapped_i = wrapKeyForShare(K_c, FileKey_i) — K_c wraps each item key
//     DIRECTLY (no intermediate bundle_key; a public link has one consumer key).
//   - The owner-recovery blobs (task 0708/0709 A+) are computed ONCE for the
//     whole bundle: owner_wrapped_key = wrap(masterKey, K_c),
//     owner_wrapped_token = wrap(masterKey, rawToken).
// The server only ever receives the opaque wrapped blobs — never K_c, never any
// FileKey, never a plaintext name. Zero-knowledge is identical to single-file.

/** One file selected for a bundle share — the minimum the helper needs. */
export interface BundleSelection {
  fileId: string
  /** 0-based ordered position in the bundle. */
  position: number
  /**
   * The item's FileKey, when the caller already resolved it (task 2238 review).
   * REQUIRED for a file received through a file request: such a row is sealed
   * under a random content key, NOT under `deriveFileKey(master, id)`, so the
   * derivation below would wrap the wrong key and the recipient would get an
   * undecryptable item. Callers pass `getFileKeyForFile(file)` — the key
   * context resolves both shapes. The caller owns (and zeroizes) this buffer;
   * this helper never zeroizes a supplied key.
   */
  fileKey?: Uint8Array
}

/**
 * The crypto material a bundle CREATE needs, ready to POST. `items` are ordered
 * (position 0..N-1), each carrying the item's FileKey wrapped under K_c.
 * `keyForUrl` is the base64url K_c that goes in the `#key=` fragment — it MUST
 * stay client-side. The owner-recovery blobs are the bundle's single envelope
 * copy (one per bundle, not per item).
 */
export interface BundleCreateMaterial {
  items: Array<{ file_id: string; position: number; wrapped_file_key: string }>
  keyForUrl: string
  ownerWrappedKey: string
}

/**
 * Build the per-item wrapped keys + owner-recovery key for a bundle CREATE.
 *
 * Generates a fresh K_c, derives each selected file's FileKey from the master
 * key, and wraps it under K_c (60-byte AES-256-GCM frame). Returns the ordered
 * `items` array, the base64url K_c for the URL fragment, and the owner-wrapped
 * K_c. The caller is responsible for `owner_wrapped_token` (it wraps the raw
 * token, which the caller mints). K_c and each derived FileKey are zeroized
 * before returning — the only surviving copy of K_c is `keyForUrl`.
 */
export async function prepareBundleShareItems(
  masterKey: Uint8Array,
  selections: BundleSelection[],
): Promise<BundleCreateMaterial> {
  // One client key for the whole bundle — never leaves the browser except as
  // the URL fragment (keyForUrl) the owner shares out-of-band.
  const clientKey = crypto.getRandomValues(new Uint8Array(32))

  const items: Array<{ file_id: string; position: number; wrapped_file_key: string }> = []
  for (const sel of selections) {
    // A supplied key (request-upload envelope) is used as-is and stays the
    // caller's to zeroize; otherwise the classic derivation applies.
    const supplied = sel.fileKey
    const fileKey = supplied ?? (await deriveFileKey(masterKey, sel.fileId))
    const wrapped = await wrapKeyForShare(clientKey, fileKey)
    if (!supplied) zeroize(fileKey)
    items.push({
      file_id: sel.fileId,
      position: sel.position,
      wrapped_file_key: toBase64(wrapped),
    })
  }

  // Owner-recovery (0708/0709 A+): wrap K_c under the OWNER's master key so the
  // owner can rebuild a working link later. Computed ONCE for the bundle.
  const ownerWrappedKey = toBase64(await wrapKeyForShare(masterKey, clientKey))

  const keyForUrl = toBase64url(clientKey)
  zeroize(clientKey)

  return { items, keyForUrl, ownerWrappedKey }
}

/**
 * Wrap a raw share token under the owner's master key (task 0708) so the owner
 * can re-derive a working link from `/shared`. Returns base64. Mirrors the
 * single-file `owner_wrapped_token`, computed once per bundle.
 */
export async function wrapBundleToken(
  masterKey: Uint8Array,
  rawToken: string,
): Promise<string> {
  return toBase64(await wrapKeyForShare(masterKey, new TextEncoder().encode(rawToken)))
}

/**
 * Recipient side: unwrap one bundle item's FileKey from K_c.
 *
 * @param clientKey  K_c (32B) read from the `#key=` URL fragment.
 * @param wrappedFileKeyB64  the item's `wrapped_file_key` (base64) from the manifest.
 * @returns the 32-byte FileKey to decrypt that item's name + content. Throws if
 *          K_c is wrong (AES-GCM auth fails) — the caller surfaces that honestly.
 */
export async function unwrapBundleItemKey(
  clientKey: Uint8Array,
  wrappedFileKeyB64: string,
): Promise<Uint8Array> {
  return unwrapKeyFromShare(clientKey, fromBase64(wrappedFileKeyB64))
}


