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
) {
  return withProxy((p) => p.opaqueLoginFinish(clientState, password, serverResponse))
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
