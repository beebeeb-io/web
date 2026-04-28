// ─── Crypto service ─────────────────────────────────
// Proxies all WASM crypto operations to a Web Worker via Comlink.
// Master key lives in memory on the main thread only.

import * as Comlink from 'comlink'
import type { CryptoWorker } from '../workers/crypto.worker'

let workerProxy: Comlink.Remote<CryptoWorker> | null = null
let initPromise: Promise<void> | null = null

/** Spawn the crypto worker and initialize WASM inside it (singleton). */
export async function initCrypto(): Promise<void> {
  if (workerProxy) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const worker = new Worker(
      new URL('../workers/crypto.worker.ts', import.meta.url),
      { type: 'module' },
    )
    const proxy = Comlink.wrap<CryptoWorker>(worker)
    await proxy.init()
    workerProxy = proxy
  })()

  return initPromise
}

function getProxy(): Comlink.Remote<CryptoWorker> {
  if (!workerProxy) {
    throw new Error('Crypto worker not initialized — call initCrypto() first')
  }
  return workerProxy
}

// ─── Key derivation ─────────────────────────────────

/** Derive a master key from a password + salt via Argon2id. */
export async function deriveKeys(
  password: string,
  salt: Uint8Array,
): Promise<{ masterKey: Uint8Array }> {
  await initCrypto()
  const masterKey = await getProxy().deriveKeys(password, salt)
  return { masterKey }
}

/** Derive a per-file key from the master key and a file ID string. */
export async function deriveFileKey(
  masterKey: Uint8Array,
  fileId: string,
): Promise<Uint8Array> {
  return getProxy().deriveFileKey(masterKey, fileId)
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
  const result = await getProxy().encryptChunk(fileKey, plaintext)
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
  return getProxy().decryptChunk(fileKey, nonce, ciphertext)
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
  const result = await getProxy().encryptFilename(fileKey, filename)
  return {
    nonce: result.nonce,
    ciphertext: result.ciphertext,
  }
}

/** Decrypt a filename / metadata string. */
export async function decryptFilename(
  fileKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<string> {
  return getProxy().decryptFilename(fileKey, nonce, ciphertext)
}

// ─── Recovery phrase ────────────────────────────────

/** Generate a 12-word BIP39 recovery phrase and the corresponding master key. */
export async function generateRecoveryPhrase(): Promise<{
  phrase: string
  masterKey: Uint8Array
}> {
  return getProxy().generateRecoveryPhrase()
}

/** Recover the master key from a 12-word BIP39 phrase. */
export async function recoverFromPhrase(phrase: string): Promise<Uint8Array> {
  return getProxy().recoverFromPhrase(phrase)
}

// ─── OPAQUE protocol ───────────────────────────────

export async function opaqueRegistrationStart(password: string) {
  await initCrypto()
  return getProxy().opaqueRegistrationStart(password)
}

export async function opaqueRegistrationFinish(
  clientState: Uint8Array,
  password: string,
  serverResponse: Uint8Array,
) {
  return getProxy().opaqueRegistrationFinish(clientState, password, serverResponse)
}

export async function opaqueLoginStart(password: string) {
  await initCrypto()
  return getProxy().opaqueLoginStart(password)
}

export async function opaqueLoginFinish(
  clientState: Uint8Array,
  password: string,
  serverResponse: Uint8Array,
) {
  return getProxy().opaqueLoginFinish(clientState, password, serverResponse)
}

export async function deriveX25519Public(masterKey: Uint8Array): Promise<Uint8Array> {
  return getProxy().deriveX25519Public(masterKey)
}

export async function computeRecoveryCheck(masterKey: Uint8Array): Promise<Uint8Array> {
  return getProxy().computeRecoveryCheck(masterKey)
}

// ─── Helpers ────────────────────────────────────────

const CHUNK_SIZE = 1024 * 1024 // 1 MB

/** Split a file into 1MB chunks. */
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
