// ─── Crypto Web Worker ─────────────────────────────
// Runs all WASM crypto operations off the main thread.
// Exposed via Comlink so the main thread calls these as async functions.

import * as Comlink from 'comlink'
import type * as WasmTypes from 'beebeeb-wasm'

let wasmModule: typeof WasmTypes | null = null

async function ensureWasm(): Promise<typeof WasmTypes> {
  if (wasmModule) return wasmModule
  const mod = await import('beebeeb-wasm')
  if (typeof mod.default === 'function') {
    await mod.default()
  }
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

  /** OPAQUE: start client registration. Returns { message, state }. */
  async opaqueRegistrationStart(password: string): Promise<{ message: Uint8Array; state: Uint8Array }> {
    const wasm = await ensureWasm()
    const result = wasm.opaque_registration_start(new TextEncoder().encode(password))
    return { message: result.message as Uint8Array, state: result.state as Uint8Array }
  },

  /** OPAQUE: finish client registration. Returns registration upload bytes. */
  async opaqueRegistrationFinish(
    clientState: Uint8Array,
    password: string,
    serverResponse: Uint8Array,
  ): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    return wasm.opaque_registration_finish(clientState, new TextEncoder().encode(password), serverResponse) as Uint8Array
  },

  /** OPAQUE: start client login. Returns { message, state }. */
  async opaqueLoginStart(password: string): Promise<{ message: Uint8Array; state: Uint8Array }> {
    const wasm = await ensureWasm()
    const result = wasm.opaque_login_start(new TextEncoder().encode(password))
    return { message: result.message as Uint8Array, state: result.state as Uint8Array }
  },

  /** OPAQUE: finish client login. Returns { message, session_key, export_key }. */
  async opaqueLoginFinish(
    clientState: Uint8Array,
    password: string,
    serverResponse: Uint8Array,
  ): Promise<{ message: Uint8Array; sessionKey: Uint8Array; exportKey: Uint8Array }> {
    const wasm = await ensureWasm()
    const result = wasm.opaque_login_finish(clientState, new TextEncoder().encode(password), serverResponse)
    return {
      message: result.message as Uint8Array,
      sessionKey: result.session_key as Uint8Array,
      exportKey: result.export_key as Uint8Array,
    }
  },

  /** Derive X25519 public key from master key (for sharing). */
  async deriveX25519Public(masterKey: Uint8Array): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    const priv = wasm.derive_x25519_private(masterKey)
    return wasm.derive_x25519_public(priv) as Uint8Array
  },

  /** Compute recovery check hash from master key. */
  async computeRecoveryCheck(masterKey: Uint8Array): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    return wasm.compute_recovery_check(masterKey) as Uint8Array
  },

  /** Derive X25519 signing side from master key (for sharing). */
  async deriveX25519Private(masterKey: Uint8Array): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    return wasm.derive_x25519_private(masterKey) as Uint8Array
  },

  /** Compute X25519 DH result from our keypair and their public part. */
  async x25519SharedSecret(myPrivate: Uint8Array, theirPublic: Uint8Array): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    return wasm.x25519_shared_secret(myPrivate, theirPublic) as Uint8Array
  },

  /** Derive a per-file share key from a shared secret and file ID. */
  async deriveShareKey(sharedSecret: Uint8Array, fileId: Uint8Array): Promise<Uint8Array> {
    const wasm = await ensureWasm()
    return wasm.derive_share_key(sharedSecret, fileId) as Uint8Array
  },
}

export type CryptoWorker = typeof cryptoWorker

Comlink.expose(cryptoWorker)
