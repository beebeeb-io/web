// Session token/email storage plus the small auth helpers the API client shares.
export const API_URL = import.meta.env.VITE_API_URL || 'https://api.beebeeb.io'
export const STATUS_URL = import.meta.env.VITE_STATUS_URL || 'https://status.beebeeb.io'

// ─── Email storage (parallel to token) ──────────────
// Stored alongside the session token so the desktop shell can show the
// signed-in identity on its Account page. Cleared whenever the token is.
const EMAIL_STORAGE_KEY = 'bb_email'

export function setEmail(email: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(EMAIL_STORAGE_KEY, email)
}

export function getEmail(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(EMAIL_STORAGE_KEY)
}

export function clearEmail(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(EMAIL_STORAGE_KEY)
}

/**
 * Decode a hex string into a byte array. Used by the legacy login path that
 * receives the password salt as hex from /auth/login. Kept local because
 * shared has no obvious need for it and it pulls no extra deps.
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

