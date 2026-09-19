/**
 * API base URL. Each consuming app is responsible for resolving its own URL
 * (via Vite env, runtime config, or a static fallback) and calling
 * `setApiUrl()` once at startup. Defaults to localhost so local dev tooling
 * works out of the box without configuration.
 */

let API_URL: string = 'http://localhost:3001'

export function setApiUrl(url: string): void {
  API_URL = url
}

export function getApiUrl(): string {
  return API_URL
}

/**
 * Writer-provenance client identity (task 1436, the desktop/web half of
 * 1392). `request()` attaches `X-Beebeeb-Client: <client>` and
 * `X-Beebeeb-Client-Version: <version>` to every call once this is set; the
 * server records both on every `object_versions` row (server PR #23 / task
 * 1369) so a blast-radius query can tell which client + build wrote a
 * version. No user data goes in either value.
 *
 * Deliberately opt-in and unset by default: this package is also consumed by
 * admin, which must NOT silently start sending `X-Beebeeb-Client: web` just
 * because it imports the same shared `request()`. Each consuming app calls
 * `setClientInfo(...)` once at startup (mirroring `setApiUrl`) with its own
 * identity — web calls `setClientInfo('web', __APP_VERSION__)`; admin does
 * not call this at all today (see 1436's PR description for the follow-up).
 */
let CLIENT_INFO: { client: string; version: string } | null = null

export function setClientInfo(client: string, version: string): void {
  CLIENT_INFO = { client, version }
}

export function getClientInfo(): { client: string; version: string } | null {
  return CLIENT_INFO
}

/**
 * Header object for a raw `fetch()` call that bypasses `request()` (e.g. a
 * binary chunk PUT that streams a body `request()` doesn't support). Spread
 * this into the call's headers so it carries the same writer-provenance
 * headers `request()` attaches automatically. Empty object when
 * `setClientInfo()` hasn't been called (matches `request()`'s opt-in
 * behavior — admin stays untagged).
 */
export function provenanceHeaders(): Record<string, string> {
  const info = getClientInfo()
  if (!info) return {}
  return { 'X-Beebeeb-Client': info.client, 'X-Beebeeb-Client-Version': info.version }
}
