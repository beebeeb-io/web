// ─── Passkey vault key wrapping ────────────────────
// Handles vault key wrapping for passkey-based vault unlock.
//
// Strategy:
// 1. PRF extension (ideal): derive vault_wrap_key from the passkey's PRF output.
//    The key never leaves the authenticator — even XSS cannot extract it.
// 2. localStorage fallback: store a random vault_wrap_key keyed by credential ID.
//    Less secure (XSS-accessible) but functional on all browsers.
//
// The encrypted master key (vault blob) is stored server-side via the escrow API.
// Only the vault_wrap_key (from PRF or localStorage) can decrypt it.

const NONCE_BYTES = 12
const KEY_BYTES = 32
const LS_PREFIX = 'bb_vwk_' // vault wrap key prefix in localStorage

// ─── PRF support detection ─────────────────────────

/**
 * Build the PRF extension inputs for WebAuthn create/get calls.
 * Returns undefined if the browser doesn't support PRF.
 */
export function prfExtensionInputs(): { prf: { eval: { first: BufferSource } } } | undefined {
  // The PRF extension uses a static salt to derive a deterministic output.
  // We use a fixed application-specific salt so the same passkey always
  // produces the same PRF output for Beebeeb vault operations.
  const salt = new TextEncoder().encode('beebeeb.io/vault-wrap-key/v1')
  // Pad or hash to exactly 32 bytes (WebAuthn PRF salt must be >= 32 bytes)
  const paddedSalt = new Uint8Array(32)
  paddedSalt.set(salt.slice(0, 32))

  return {
    prf: {
      eval: {
        first: paddedSalt,
      },
    },
  }
}

/**
 * Check if the browser and authenticator support the PRF extension.
 * This must be called after a WebAuthn operation to check the extension results.
 */
export function isPrfSupported(extensionResults: AuthenticationExtensionsClientOutputs): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (extensionResults as any)?.prf
  return prf?.enabled === true || prf?.results?.first != null
}

/**
 * Extract the PRF output from WebAuthn extension results.
 * Returns null if PRF was not available.
 */
export function extractPrfOutput(extensionResults: AuthenticationExtensionsClientOutputs): Uint8Array | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (extensionResults as any)?.prf
  if (!prf?.results?.first) return null
  return new Uint8Array(prf.results.first as ArrayBuffer)
}

// ─── Vault wrap key management ─────────────────────

/**
 * Derive or retrieve the vault wrap key for a credential.
 *
 * If PRF output is available, derives a 256-bit key via HKDF.
 * Otherwise falls back to a random key stored in localStorage.
 *
 * @param credentialId  The base64url credential ID
 * @param prfOutput     PRF extension output (null if not supported)
 * @param generateFallback  If true, generate and store a new fallback key
 * @returns The 32-byte vault wrap key, or null if no key is available
 */
export async function getVaultWrapKey(
  credentialId: string,
  prfOutput: Uint8Array | null,
  generateFallback: boolean,
): Promise<Uint8Array | null> {
  if (prfOutput) {
    return deriveWrapKeyFromPrf(prfOutput)
  }

  // Fallback: localStorage
  const stored = localStorage.getItem(LS_PREFIX + credentialId)
  if (stored) {
    return base64ToBytes(stored)
  }

  if (generateFallback) {
    const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
    localStorage.setItem(LS_PREFIX + credentialId, bytesToBase64(key))
    return key
  }

  return null
}

/**
 * Remove the localStorage fallback key for a credential.
 * Called when a passkey is deleted.
 */
export function removeVaultWrapKey(credentialId: string): void {
  localStorage.removeItem(LS_PREFIX + credentialId)
}

// ─── AES-256-GCM vault blob encryption ────────────

/**
 * Encrypt the master key with the vault wrap key.
 * Returns nonce(12) || ciphertext (AES-256-GCM with 128-bit tag).
 */
export async function encryptVaultBlob(
  vaultWrapKey: Uint8Array,
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    vaultWrapKey.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    cryptoKey,
    masterKey.buffer as ArrayBuffer,
  )

  // Wire format: nonce(12) || ciphertext(32 + 16 tag = 48)
  const result = new Uint8Array(NONCE_BYTES + ciphertext.byteLength)
  result.set(nonce, 0)
  result.set(new Uint8Array(ciphertext), NONCE_BYTES)
  return result
}

/**
 * Decrypt the vault blob with the vault wrap key.
 * Input format: nonce(12) || ciphertext.
 * Returns the 32-byte master key, or null if decryption fails.
 */
export async function decryptVaultBlob(
  vaultWrapKey: Uint8Array,
  blob: Uint8Array,
): Promise<Uint8Array | null> {
  if (blob.length < NONCE_BYTES + 1) return null

  const nonce = blob.slice(0, NONCE_BYTES)
  const ciphertext = blob.slice(NONCE_BYTES)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    vaultWrapKey.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      cryptoKey,
      ciphertext.buffer as ArrayBuffer,
    )
    return new Uint8Array(plaintext)
  } catch {
    // Decryption failure — wrong key or corrupted blob
    return null
  }
}

// ─── HKDF derivation from PRF output ──────────────

async function deriveWrapKeyFromPrf(prfOutput: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits'],
  )

  const info = new TextEncoder().encode('beebeeb.io/vault-wrap/v1')
  const salt = new Uint8Array(0) // HKDF salt can be empty when input is already random

  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    keyMaterial,
    256,
  )

  return new Uint8Array(bits)
}

// ─── Base64 helpers (not base64url) ────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
