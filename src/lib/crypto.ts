// ─── Crypto service ─────────────────────────────────
// Proxies all WASM crypto operations to a Web Worker via Comlink.
// Master key lives in memory on the main thread only.
//
// Memory-cap restart:
//   WebAssembly linear memory only grows — it never shrinks. After a long
//   session involving many large encrypt/decrypt ops the worker can hold
//   hundreds of MB. We periodically check the worker's reported memory
//   usage and, when it crosses MEMORY_THRESHOLD_BYTES, terminate it and
//   spawn a fresh worker. All consumer calls funnel through `withProxy`,
//   which gates new ops on `restartPromise` while a restart is in flight
//   and tracks `inFlight` so the swap waits for outstanding ops to drain.

import * as Comlink from 'comlink'
import type { CryptoWorker } from '../workers/crypto.worker'

/** Soft cap on WASM linear-memory bytes before we recycle the worker. */
const MEMORY_THRESHOLD_BYTES = 256 * 1024 * 1024
/** Check memory every N completed ops (cheap: a single Comlink round-trip). */
const MEM_CHECK_INTERVAL = 16

let currentWorker: Worker | null = null
let workerProxy: Comlink.Remote<CryptoWorker> | null = null
let initPromise: Promise<void> | null = null

// ── Restart coordination state ──────────────────────────────────────────────
// `inFlight` counts ops that have grabbed `workerProxy` and not yet resolved.
// `restartPromise`, when set, blocks new ops at the gate inside `withProxy`.
// `idleNotifier`, when set, is resolved as soon as `inFlight` returns to 0.
let inFlight = 0
let restartPromise: Promise<void> | null = null
let opsSinceMemCheck = 0
let idleNotifier: (() => void) | null = null

function spawnWorker(): { worker: Worker; proxy: Comlink.Remote<CryptoWorker> } {
  const worker = new Worker(
    new URL('../workers/crypto.worker.ts', import.meta.url),
    { type: 'module' },
  )
  const proxy = Comlink.wrap<CryptoWorker>(worker)
  return { worker, proxy }
}

/** Spawn the crypto worker and initialize WASM inside it (singleton). */
export async function initCrypto(): Promise<void> {
  if (workerProxy) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const { worker, proxy } = spawnWorker()
    await proxy.init()
    currentWorker = worker
    workerProxy = proxy
  })()

  try {
    await initPromise
  } finally {
    // Allow re-init after a terminate(): once `workerProxy` is null again
    // a later `initCrypto()` should run the spawn flow.
    initPromise = null
  }
}

function notifyIdleIfReached(): void {
  if (inFlight === 0 && idleNotifier) {
    const n = idleNotifier
    idleNotifier = null
    n()
  }
}

function waitForIdle(): Promise<void> {
  if (inFlight === 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    // Only one waiter ever — the restart driver. We don't have multiple
    // restart drivers because `restartPromise` itself gates concurrency.
    idleNotifier = resolve
  })
}

/**
 * Run `fn` against the current worker proxy with concurrency tracking.
 *
 * - Waits for any in-flight restart before grabbing the proxy
 * - Lazily initializes the worker on first call
 * - Increments `inFlight` for the duration of the call so a concurrent
 *   restart driver can wait for the op to settle before terminating
 * - After the call resolves, periodically polls memory usage and triggers
 *   a restart if the soft cap is exceeded
 */
async function withProxy<T>(
  fn: (proxy: Comlink.Remote<CryptoWorker>) => Promise<T>,
): Promise<T> {
  // Gate: block new ops while a restart is in flight.
  while (restartPromise) {
    await restartPromise
  }
  if (!workerProxy) {
    await initCrypto()
  }
  const proxy = workerProxy
  if (!proxy) {
    throw new Error('Crypto worker not initialized — call initCrypto() first')
  }

  inFlight++
  try {
    return await fn(proxy)
  } finally {
    inFlight--
    notifyIdleIfReached()
    opsSinceMemCheck++
    if (opsSinceMemCheck >= MEM_CHECK_INTERVAL && !restartPromise) {
      opsSinceMemCheck = 0
      // Fire and forget — restart runs in its own async context.
      void maybeRestart()
    }
  }
}

/**
 * Check WASM memory usage; if above the threshold, terminate the worker
 * and spawn a fresh one. Safe to call concurrently — `restartPromise`
 * serializes the actual swap.
 */
async function maybeRestart(): Promise<void> {
  if (restartPromise || !workerProxy) return
  // LIVE-ENCRYPTOR GUARD: never recycle the worker while a streaming upload
  // owns an encryptor. A `WasmChunkEncryptor` is a pointer into THIS worker's
  // linear memory; terminating the worker mid-upload would orphan it and break
  // finish()'s integrity guard. Check before taking the restart lock.
  try {
    if ((await workerProxy.liveEncryptorCount()) > 0) return
  } catch (err) {
    // Worker went away (terminate raced us) — bail; the next op lazily re-inits.
    console.warn('[crypto] liveEncryptorCount failed', err)
    return
  }
  let bytes = 0
  try {
    // Direct call (not via withProxy) so the memory probe itself doesn't
    // bump `inFlight` and deadlock the drain step below.
    bytes = await workerProxy.getMemoryUsage()
  } catch (err) {
    // If the worker has gone away (terminate raced us) just bail; the next
    // op will lazily re-init.
    console.warn('[crypto] getMemoryUsage failed', err)
    return
  }
  if (bytes <= MEMORY_THRESHOLD_BYTES) return
  // Re-check the lock — another driver may have raced us past the entry
  // guard while we were awaiting getMemoryUsage(). The next assignment must
  // be synchronous so a parallel driver sees a non-null restartPromise.
  if (restartPromise) return

  // Take the restart lock. Any new `withProxy` call now blocks until we're
  // done. Existing in-flight ops continue against the old worker and we
  // wait for them to settle before terminating.
  restartPromise = (async () => {
    try {
      await waitForIdle()
      const oldWorker = currentWorker
      currentWorker = null
      workerProxy = null
      try {
        oldWorker?.terminate()
      } catch (err) {
        console.warn('[crypto] worker.terminate() failed', err)
      }
      const { worker, proxy } = spawnWorker()
      await proxy.init()
      currentWorker = worker
      workerProxy = proxy
      // Best-effort observability — useful when watching the manual test.
      console.info(
        `[crypto] worker recycled at ${(bytes / (1024 * 1024)).toFixed(1)} MB WASM memory`,
      )
    } catch (err) {
      console.error('[crypto] worker restart failed', err)
      // Leave workerProxy null — the next withProxy() will run initCrypto()
      // which spawns a fresh worker from scratch.
    }
  })()
  try {
    await restartPromise
  } finally {
    restartPromise = null
  }
}

/**
 * Test-only hook: reports the current memory threshold + state. Not part
 * of the public API. Kept un-exported in production builds.
 */
export const __cryptoRestartInternals = {
  getInFlight: () => inFlight,
  getMemoryThresholdBytes: () => MEMORY_THRESHOLD_BYTES,
  isRestarting: () => restartPromise !== null,
}

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

/** Decrypt a chunk that was encrypted with encryptChunk. */
export async function decryptChunk(
  fileKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.decryptChunk(fileKey, nonce, ciphertext))
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

/** Decrypt a filename / metadata string. */
export async function decryptFilename(
  fileKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<string> {
  return withProxy((p) => p.decryptFilename(fileKey, nonce, ciphertext))
}

/**
 * Batched decryption of many `(fileKey, nonce, ciphertext)` triples in one
 * Comlink round-trip. Errors are reported per item — one failure does not
 * abort the batch. See `decryptManyNames` in the worker for plaintext parsing
 * details (JSON `{name, mime_type}` vs legacy bare string).
 */
export async function decryptManyNames(
  items: Array<{ id: string; fileKey: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array }>,
): Promise<Array<{ id: string; name?: string; mimeType?: string; error?: string }>> {
  if (items.length === 0) return []
  return withProxy((p) => p.decryptManyNames(items))
}

/**
 * Decrypt and parse the `name_encrypted` field from a DriveFile.
 *
 * Supports two formats:
 *   New (ZK-safe): the decrypted plaintext is `{"name":"report.pdf","mime_type":"application/pdf"}`
 *   Legacy:        the decrypted plaintext is just `"report.pdf"` (a bare filename string)
 *
 * Always returns `{ name, mimeType }` regardless of format, so callers
 * are insulated from the migration.
 */
export async function decryptFileMetadata(
  fileKey: Uint8Array,
  nameEncrypted: string,
): Promise<{ name: string; mimeType: string | null }> {
  let name = 'Encrypted file'
  let mimeType: string | null = null

  // Legacy: some folders were stored with plaintext names before encryption
  // was implemented. If the value doesn't look like JSON, return it as-is.
  if (!nameEncrypted.startsWith('{')) {
    return { name: nameEncrypted, mimeType: null }
  }

  try {
    const { nonce, ciphertext } = parseEncryptedBlob(nameEncrypted)
    const plain = await decryptFilename(fileKey, nonce, ciphertext)
    try {
      const meta = JSON.parse(plain) as { name?: string; mime_type?: string }
      name = meta.name ?? plain
      mimeType = meta.mime_type ?? null
    } catch {
      name = plain
    }
  } catch (err) {
    console.warn('[crypto] decryptFileMetadata failed', {
      nameEncryptedPrefix: nameEncrypted.slice(0, 60),
      keyLength: fileKey.length,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return { name, mimeType }
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
export async function x25519SharedSecret(
  myPrivate: Uint8Array,
  theirPublic: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.x25519SharedSecret(myPrivate, theirPublic))
}

/** Derive a per-file share key from a shared secret and file ID bytes. */
export async function deriveShareKey(
  sharedSecret: Uint8Array,
  fileId: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.deriveShareKey(sharedSecret, fileId))
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
// Canonical wire format (used by CLI, mobile, and now web):
//   {"cipher_suite":"V1Aes256Gcm","nonce":[byte_array],"ciphertext":[byte_array]}
//
// Legacy web format (still accepted on read, no longer produced):
//   {"nonce":"base64string","ciphertext":"base64string"}

/**
 * Parse an encrypted blob JSON string into raw nonce + ciphertext bytes.
 *
 * Tolerant reader: accepts canonical format (cipher_suite + byte arrays),
 * legacy web format (base64 strings), or a mix.
 */
export function parseEncryptedBlob(json: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const parsed = JSON.parse(json) as {
    cipher_suite?: string
    nonce: string | number[]
    ciphertext: string | number[]
  }

  const nonce = Array.isArray(parsed.nonce)
    ? new Uint8Array(parsed.nonce)
    : fromBase64(parsed.nonce)

  const ciphertext = Array.isArray(parsed.ciphertext)
    ? new Uint8Array(parsed.ciphertext)
    : fromBase64(parsed.ciphertext)

  return { nonce, ciphertext }
}

/**
 * Serialize nonce + ciphertext into the canonical encrypted blob JSON format.
 *
 * All new writes use canonical format so CLI, mobile, and web are interoperable.
 */
export function serializeEncryptedBlob(nonce: Uint8Array, ciphertext: Uint8Array): string {
  return JSON.stringify({
    cipher_suite: 'V1Aes256Gcm',
    nonce: Array.from(nonce),
    ciphertext: Array.from(ciphertext),
  })
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

// ─── File requests (sealed-box / ECIES per request) ─────────────────────────
//
// All crypto is the core `file_request` binding — this layer only composes the
// pieces. Two domain-separation inputs (`request_id` for the private-key wrap,
// `file_id` for the per-upload seal) are passed to core as HKDF `info`. Because
// the SERVER assigns the request UUID and the file UUID *after* the client has
// already wrapped / sealed, neither id is known at wrap/seal time, and the
// server carries no client-chosen id to echo back. So both sides use a FIXED
// EMPTY value — the only value reconstructable by both the wrapper/unwrapper and
// the sealer/opener. This stays secure: each wrap uses a fresh random GCM nonce,
// and each seal uses a fresh ephemeral X25519 keypair, so uniqueness never
// depends on the (empty) id. Every client (web/cli/mobile) MUST use this same
// empty convention for links to round-trip cross-client.
export const FILE_REQUEST_EMPTY_ID = new Uint8Array(0)

export interface RequestKeypair {
  /** 32-byte X25519 private key (R_priv). Wrap before persisting. */
  privateKey: Uint8Array
  /** 32-byte X25519 public key (R_pub). Goes in the link fragment. */
  publicKey: Uint8Array
}

/** Generate a fresh per-request X25519 keypair. R_priv is 32 random bytes;
 *  R_pub is derived by the core binding (clamping applied internally). */
export async function generateRequestKeypair(): Promise<RequestKeypair> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32))
  const publicKey = await withProxy((p) => p.deriveX25519PublicFromPrivate(privateKey))
  return { privateKey, publicKey }
}

/** Derive R_pub from a (already-unwrapped) R_priv — used to rebuild a link. */
export async function derivePublicFromPrivate(rPriv: Uint8Array): Promise<Uint8Array> {
  return withProxy((p) => p.deriveX25519PublicFromPrivate(rPriv))
}

/** Wrap a request's R_priv under the owner's master key. */
export async function wrapRequestPrivate(
  masterKey: Uint8Array,
  rPriv: Uint8Array,
  requestId: Uint8Array = FILE_REQUEST_EMPTY_ID,
): Promise<{ wrapped: Uint8Array; nonce: Uint8Array }> {
  return withProxy((p) => p.wrapRequestPrivate(masterKey, requestId, rPriv))
}

/** Unwrap a request's R_priv with the owner's master key. */
export async function unwrapRequestPrivate(
  masterKey: Uint8Array,
  wrapped: Uint8Array,
  nonce: Uint8Array,
  requestId: Uint8Array = FILE_REQUEST_EMPTY_ID,
): Promise<Uint8Array> {
  return withProxy((p) => p.unwrapRequestPrivate(masterKey, requestId, wrapped, nonce))
}

/** Seal a per-file content key C to a request public key (uploader path).
 *  Returns the uploader's ephemeral public key + the wrapped content key. */
export async function sealToRequest(
  rPub: Uint8Array,
  contentKey: Uint8Array,
  fileId: Uint8Array = FILE_REQUEST_EMPTY_ID,
): Promise<{ ePub: Uint8Array; wrappedKey: Uint8Array }> {
  const result = await withProxy((p) => p.sealToRequest(rPub, fileId, contentKey))
  return { ePub: result.e_pub, wrappedKey: result.wrapped_key }
}

/** Open a sealed upload, recovering the content key C (owner decrypt path). */
export async function openRequestUpload(
  rPriv: Uint8Array,
  ePub: Uint8Array,
  wrappedKey: Uint8Array,
  fileId: Uint8Array = FILE_REQUEST_EMPTY_ID,
): Promise<Uint8Array> {
  return withProxy((p) => p.openRequestUpload(rPriv, ePub, fileId, wrappedKey))
}

// ─── Constellation peer transfer ─────────────────────────────────────────────
//
// Ephemeral X25519 (per-transfer) + HKDF-SHA256 (salted with the session id) +
// AES-256-GCM, all implemented in core and exposed through the worker. The
// receiver generates a keypair, sends its public key, performs ECDH against the
// sender's public key (`x25519SharedSecret`), then derives BOTH the AES transfer
// key and the 4 SAS words from the SAME shared secret + session id — so the SAS
// words authenticate the real key agreement (a relay swapping either public key
// produces different words on the two screens).

/** Generate a fresh ephemeral X25519 keypair for a transfer. */
export async function transferGenerateKeypair(): Promise<{
  public: Uint8Array
  private: Uint8Array
}> {
  return withProxy((p) => p.transferGenerateKeypair())
}

/** Derive the 32-byte AES-256 transfer key from a shared secret + session id. */
export async function transferDeriveKey(
  sharedSecret: Uint8Array,
  sessionId: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.transferDeriveKey(sharedSecret, sessionId))
}

/** Derive the 4-byte SAS material from a shared secret + session id (MITM check). */
export async function transferDeriveSasBytes(
  sharedSecret: Uint8Array,
  sessionId: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.transferDeriveSasBytes(sharedSecret, sessionId))
}

/** Map 4 SAS bytes to 4 words from the canonical core wordlist. */
export async function transferSasToWords(sasBytes: Uint8Array): Promise<string[]> {
  return withProxy((p) => p.transferSasToWords(sasBytes))
}

/** Encrypt a transfer payload under the transfer key → `nonce(12) || ct+tag`. */
export async function transferEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.transferEncrypt(key, plaintext))
}

/** Decrypt a `nonce(12) || ciphertext` blob produced by transferEncrypt. */
export async function transferDecrypt(
  key: Uint8Array,
  blob: Uint8Array,
): Promise<Uint8Array> {
  return withProxy((p) => p.transferDecrypt(key, blob))
}

/**
 * Parse a UUID (e.g. the server `session_id`) into its RAW 16 bytes.
 *
 * The transfer key + SAS derivations salt with the session id; both sides MUST
 * agree on the exact salt bytes. The canonical salt is the UUID's 16 raw bytes
 * (hex, dashes stripped) — NOT the UTF-8 of the dashed string. Getting this
 * wrong silently produces a different key/SAS on each end and the decrypt fails.
 */
export function sessionIdToBytes(sessionId: string): Uint8Array {
  const hex = sessionId.replace(/-/g, '')
  if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(`Invalid session_id UUID: ${sessionId}`)
  }
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * The receiver's end of a transfer key agreement, as a pure (worker-proxied)
 * helper so it can be unit-tested without the React page. Performs ECDH against
 * the sender's public key and derives the AES transfer key + the 4 SAS words
 * from the same shared secret + session id.
 */
export async function deriveTransferSession(
  receiverPrivate: Uint8Array,
  senderPublic: Uint8Array,
  sessionId: string,
): Promise<{ transferKey: Uint8Array; sasWords: string[]; sharedSecret: Uint8Array }> {
  const sessionIdBytes = sessionIdToBytes(sessionId)
  const sharedSecret = await x25519SharedSecret(receiverPrivate, senderPublic)
  const transferKey = await transferDeriveKey(sharedSecret, sessionIdBytes)
  const sasWords = await transferSasToWords(
    await transferDeriveSasBytes(sharedSecret, sessionIdBytes),
  )
  return { transferKey, sasWords, sharedSecret }
}

/**
 * Decrypt a Constellation transfer blob under the agreed transfer key. Thin,
 * pure wrapper over `transferDecrypt` so the receiver-page decrypt path has a
 * single testable entry point (round-trip tested in transfer-crypto.test.ts).
 */
export async function decryptTransferBlob(
  transferKey: Uint8Array,
  blob: Uint8Array,
): Promise<Uint8Array> {
  return transferDecrypt(transferKey, blob)
}

// ─── Helpers ────────────────────────────────────────

/**
 * Legacy 4 MB constant — kept only for the `chunkFile` helper below (used by
 * some older callers). New upload code should use `planChunks()` instead.
 */
export const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB

/** Split a file into 4MB chunks. */
export async function chunkFile(file: File): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = []
  let offset = 0
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE)
    const buffer = await slice.arrayBuffer()
    chunks.push(new Uint8Array(buffer))
    offset += CHUNK_SIZE
  }
  return chunks
}

/** Encode bytes to base64 (for sending in JSON). */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Decode base64 back to bytes. */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Zero out a Uint8Array (for clearing key material). */
export function zeroize(buffer: Uint8Array): void {
  buffer.fill(0)
}

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
    const fileKey = await deriveFileKey(masterKey, sel.fileId)
    const wrapped = await wrapKeyForShare(clientKey, fileKey)
    zeroize(fileKey)
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
