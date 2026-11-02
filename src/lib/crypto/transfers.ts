import { x25519SharedSecret } from './helpers'
import { withProxy } from './service'

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
