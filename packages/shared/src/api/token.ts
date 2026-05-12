/**
 * Auth token storage. Uses localStorage under the configurable
 * `tokenStorageKey` so web and admin can each have their own session keys
 * (`bb_session` vs `bb_admin_session`) without colliding when both apps
 * run in the same browser.
 *
 * The web app additionally clears its Tauri desktop session when the token
 * is wiped — that's a web-specific concern and is handled by registering a
 * post-clear callback via `registerOnTokenCleared`. Shared code stays
 * platform-agnostic.
 */

let tokenStorageKey: string = 'bb_session'
let onTokenCleared: (() => void) | null = null

export function setTokenStorageKey(key: string): void {
  tokenStorageKey = key
}

export function registerOnTokenCleared(cb: () => void): void {
  onTokenCleared = cb
}

export function getToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(tokenStorageKey)
}

export function setToken(token: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(tokenStorageKey, token)
}

export function clearToken(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(tokenStorageKey)
  }
  try {
    onTokenCleared?.()
  } catch {
    // Never let a post-clear callback failure mask the actual logout.
  }
}
