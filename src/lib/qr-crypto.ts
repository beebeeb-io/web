// ─── QR provisioning crypto ─────────────────────────
// Web Crypto API helpers for encrypting/decrypting master key via a 6-digit code.
// Used for device-to-device QR provisioning.

const QR_INFO = 'beebeeb-qr-provision'

/** Derive an AES-256-GCM key from a 6-digit numeric code using HKDF. */
export async function deriveQrKey(code: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(code),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: enc.encode(QR_INFO),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypt a master key with a QR code-derived key. Returns base64(nonce + ciphertext). */
export async function encryptForQr(masterKey: Uint8Array, code: string): Promise<string> {
  const key = await deriveQrKey(code)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    masterKey.buffer as ArrayBuffer,
  )
  // Concat nonce(12) + ciphertext
  const payload = new Uint8Array(12 + ciphertext.byteLength)
  payload.set(nonce, 0)
  payload.set(new Uint8Array(ciphertext), 12)
  return btoa(String.fromCharCode(...payload))
}

/** Decrypt a master key from a QR payload using the 6-digit code. */
export async function decryptFromQr(base64Payload: string, code: string): Promise<Uint8Array> {
  const raw = Uint8Array.from(atob(base64Payload), (c) => c.charCodeAt(0))
  if (raw.length < 13) {
    throw new Error('Invalid QR payload')
  }
  const nonce = raw.slice(0, 12)
  const ciphertext = raw.slice(12)
  const key = await deriveQrKey(code)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext,
  )
  return new Uint8Array(plaintext)
}

/** Generate a random 6-digit numeric code. */
export function generateCode(): string {
  const arr = crypto.getRandomValues(new Uint8Array(4))
  const num = (arr[0] | (arr[1] << 8) | (arr[2] << 16) | ((arr[3] & 0x7f) << 24)) >>> 0
  return String(num % 1_000_000).padStart(6, '0')
}
