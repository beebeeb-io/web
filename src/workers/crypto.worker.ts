// ─── Crypto Web Worker ─────────────────────────────
// Runs all WASM crypto operations off the main thread.
// Exposed via Comlink so the main thread calls these as async functions.

import * as Comlink from 'comlink'
import type * as WasmTypes from 'beebeeb-wasm'

let wasmModule: typeof WasmTypes | null = null

async function ensureWasm(): Promise<typeof WasmTypes> {
  if (wasmModule) return wasmModule
  const mod = await import('beebeeb-wasm')
  await mod.default()
  wasmModule = mod
  return wasmModule
}

const cryptoWorker = {
  /** Initialize the WASM module. Called once on worker start. */
  async init(): Promise<void> {
    await ensureWasm()
  },

  /** Derive a master key from a password + salt via Argon2id. */
  async deriveKeys(
    password: string,
    salt: Uint8Array,
  ): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    const result = wasm.derive_master_key(password, salt)
    return result.key as Uint8Array
  },

  /** Derive a per-file key from the master key and a file ID string. */
  async deriveFileKey(
    masterKey: Uint8Array,
    fileId: string,
  ): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    const encoder = new TextEncoder()
    const fileIdBytes = encoder.encode(fileId)
    return wasm.derive_file_key(masterKey, fileIdBytes)
  },

  /** Encrypt a plaintext chunk with AES-256-GCM. */
  async encryptChunk(
    fileKey: Uint8Array,
    plaintext: Uint8Array,
  ): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
    const wasm = await ensureWasm()
    const result = wasm.encrypt_chunk(fileKey, plaintext)
    return {
      nonce: result.nonce as Uint8Array,
      ciphertext: result.ciphertext as Uint8Array,
    }
  },

  /** Decrypt a chunk that was encrypted with encryptChunk. */
  async decryptChunk(
    fileKey: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
  ): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    return wasm.decrypt_chunk(fileKey, nonce, ciphertext)
  },

  /** Encrypt a filename / metadata string with AES-256-GCM. */
  async encryptFilename(
    fileKey: Uint8Array,
    filename: string,
  ): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
    const wasm = await ensureWasm()
    const result = wasm.encrypt_metadata(fileKey, filename)
    return {
      nonce: result.nonce as Uint8Array,
      ciphertext: result.ciphertext as Uint8Array,
    }
  },

  /** Decrypt a filename / metadata string. */
  async decryptFilename(
    fileKey: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
  ): Promise<string> {
    const wasm = await ensureWasm()
    return wasm.decrypt_metadata(fileKey, nonce, ciphertext)
  },

  /** Generate a 12-word BIP39 recovery phrase and the corresponding master key. */
  async generateRecoveryPhrase(): Promise<{
    phrase: string
    masterKey: Uint8Array
  }> {
    const wasm = await ensureWasm()
    const result = wasm.generate_recovery_phrase()
    return {
      phrase: result.phrase as string,
      masterKey: result.master_key as Uint8Array,
    }
  },

  /** Recover the master key from a 12-word BIP39 phrase. */
  async recoverFromPhrase(phrase: string): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    return wasm.recover_from_phrase(phrase)
  },
}

export type CryptoWorker = typeof cryptoWorker

Comlink.expose(cryptoWorker)
