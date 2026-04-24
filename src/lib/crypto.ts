// ─── Crypto service ─────────────────────────────────
// Wraps the beebeeb-wasm module. Master key lives in memory only.

import type * as WasmTypes from 'beebeeb-wasm'

let wasmModule: typeof WasmTypes | null = null
let initPromise: Promise<void> | null = null

/** Lazily initialize the WASM module (singleton). */
export async function initCrypto(): Promise<void> {
  if (wasmModule) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const mod = await import('beebeeb-wasm')
    // The default export is the init function — call it to load the .wasm
    await mod.default()
    wasmModule = mod
  })()

  return initPromise
}

function getWasm(): typeof WasmTypes {
  if (!wasmModule) {
    throw new Error('WASM not initialized — call initCrypto() first')
  }
  return wasmModule
}

// ─── Key derivation ─────────────────────────────────

/** Derive a master key from a password + salt via Argon2id. */
export async function deriveKeys(
  password: string,
  salt: Uint8Array,
): Promise<{ masterKey: Uint8Array }> {
  await initCrypto()
  const result = getWasm().derive_master_key(password, salt)
  return { masterKey: result.key as Uint8Array }
}

/** Derive a per-file key from the master key and a file ID string. */
export function deriveFileKey(
  masterKey: Uint8Array,
  fileId: string,
): Uint8Array {
  const encoder = new TextEncoder()
  const fileIdBytes = encoder.encode(fileId)
  return getWasm().derive_file_key(masterKey, fileIdBytes)
}

// ─── Chunk encryption ───────────────────────────────

export interface EncryptedChunk {
  nonce: Uint8Array
  ciphertext: Uint8Array
}

/** Encrypt a plaintext chunk with AES-256-GCM. */
export function encryptChunk(
  fileKey: Uint8Array,
  plaintext: Uint8Array,
): EncryptedChunk {
  const result = getWasm().encrypt_chunk(fileKey, plaintext)
  return {
    nonce: result.nonce as Uint8Array,
    ciphertext: result.ciphertext as Uint8Array,
  }
}

/** Decrypt a chunk that was encrypted with encryptChunk. */
export function decryptChunk(
  fileKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  return getWasm().decrypt_chunk(fileKey, nonce, ciphertext)
}

// ─── Metadata (filename) encryption ─────────────────

export interface EncryptedMetadata {
  nonce: Uint8Array
  ciphertext: Uint8Array
}

/** Encrypt a filename / metadata string with AES-256-GCM. */
export function encryptFilename(
  fileKey: Uint8Array,
  filename: string,
): EncryptedMetadata {
  const result = getWasm().encrypt_metadata(fileKey, filename)
  return {
    nonce: result.nonce as Uint8Array,
    ciphertext: result.ciphertext as Uint8Array,
  }
}

/** Decrypt a filename / metadata string. */
export function decryptFilename(
  fileKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): string {
  return getWasm().decrypt_metadata(fileKey, nonce, ciphertext)
}

// ─── Recovery phrase ────────────────────────────────

/** Generate a 12-word BIP39 recovery phrase and the corresponding master key. */
export function generateRecoveryPhrase(): {
  phrase: string
  masterKey: Uint8Array
} {
  const result = getWasm().generate_recovery_phrase()
  return {
    phrase: result.phrase as string,
    masterKey: result.master_key as Uint8Array,
  }
}

/** Recover the master key from a 12-word BIP39 phrase. */
export function recoverFromPhrase(phrase: string): Uint8Array {
  return getWasm().recover_from_phrase(phrase)
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
