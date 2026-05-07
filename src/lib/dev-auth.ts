/**
 * Dev-mode auto-auth bypass.
 *
 * ONLY active when `import.meta.env.DEV` is true (Vite dev server).
 * Vite constant-folds all `import.meta.env.DEV` checks in production builds,
 * so this code path is dead in prod and Rollup tree-shakes it.
 *
 * Flow:
 *   1. POST /dev/auto-login → server returns session_token + master_key_bytes_base64
 *   2. Store session_token in localStorage (same slot as real auth)
 *   3. Wrap the master key with the tab's non-extractable session key and persist
 *      to IndexedDB via session-vault-cache. KeyProvider reads this on startup to
 *      mark the vault as unlocked without needing a password prompt.
 *
 * Gracefully degrades: if the endpoint 404s, is unreachable, or times out, the
 * function returns false and the normal login flow runs as usual.
 *
 * Server-side: rust-engineer implements POST /dev/auto-login (debug builds only,
 * gated by cfg!(debug_assertions)). Response shape:
 *   { session_token: string, master_key_bytes_base64: string, email: string, role: string }
 */

import { initSessionVault, cacheVaultKey } from './session-vault-cache'

const DEV_SESSION_FLAG = 'bb_dev_authed'
const DEV_EMAIL = 'dev@beebeeb.dev'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface DevAutoLoginResponse {
  session_token: string
  master_key_bytes_base64: string
  email: string
  role: string
}

/**
 * Attempt dev auto-auth. Returns true if a session was injected.
 *
 * Always re-fetches on each call: the in-memory session-cache wrapping key
 * is lost on every page reload, so we need a fresh master key wrap each
 * time. Returns false if the endpoint is unavailable.
 */
export async function devAutoAuth(): Promise<boolean> {
  // Not in dev mode — should never be called, but guard defensively.
  if (!import.meta.env.DEV) return false

  // The session-cache wrapping key lives only in memory, so a page reload
  // always discards it — re-fetch the master key on every fresh load even
  // when a session token is still in localStorage. The /dev/auto-login
  // endpoint is idempotent for the dev email.
  // Note: no rate-limit on retry — if the server was transiently unavailable
  // (e.g. cargo-watch rebuilding), we want to try again on the next page load.

  try {
    const res = await fetch(`${API_URL}/dev/auto-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEV_EMAIL }),
      signal: AbortSignal.timeout(3000),
    })

    if (!res.ok) {
      // Endpoint might not exist yet (404) or server isn't running — skip silently.
      sessionStorage.setItem(DEV_SESSION_FLAG, 'unavailable')
      return false
    }

    const data = await res.json() as DevAutoLoginResponse

    // 1. Session token
    localStorage.setItem('bb_session', data.session_token)

    // 2. Decode master key from URL-safe base64 (server uses URL_SAFE_NO_PAD).
    //    atob() only handles standard base64 — convert `-` → `+` and `_` → `/`.
    const b64Standard = data.master_key_bytes_base64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const masterKeyBytes = Uint8Array.from(atob(b64Standard), (c) => c.charCodeAt(0))

    // 3. Wrap the master key with the tab's non-extractable session key and
    //    stash it in IndexedDB. KeyProvider's getVaultKey() will unwrap it
    //    on startup and call setIsUnlocked(true).
    await initSessionVault()
    await cacheVaultKey(masterKeyBytes)

    // 4. Record success so DevBanner knows what email/role to display.
    sessionStorage.setItem(
      DEV_SESSION_FLAG,
      JSON.stringify({ email: data.email ?? DEV_EMAIL, role: data.role ?? 'superadmin' }),
    )

    return true
  } catch {
    // Network failure, timeout, etc. — fall through to normal login.
    sessionStorage.setItem(DEV_SESSION_FLAG, 'unavailable')
    return false
  }
}

/** Returns the email+role if this session was auto-authenticated by dev bypass. */
export function getDevAuthInfo(): { email: string; role: string } | null {
  if (!import.meta.env.DEV) return null
  const raw = sessionStorage.getItem(DEV_SESSION_FLAG)
  if (!raw || raw === 'unavailable') return null
  try {
    return JSON.parse(raw) as { email: string; role: string }
  } catch {
    return null
  }
}
