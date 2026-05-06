/**
 * Tauri desktop session bridge.
 *
 * The Tauri desktop shell wraps app.beebeeb.io in a WebView and exposes
 * `set_session` / `clear_session` IPC commands (Rust side, see desktop
 * commit 4ba692f) that persist the auth token + master key for auto-unlock
 * on the next launch.
 *
 * In a normal browser context none of these helpers fire — we detect the
 * Tauri runtime via `window.__TAURI__` and bail out before importing the
 * IPC binding so the production web bundle never hard-depends on Tauri.
 *
 * All calls are intentionally fire-and-forget with a try/catch that logs
 * but never throws back to the caller. The bridge is an enhancement, not
 * a requirement — auth must keep working even if IPC fails (broken
 * dev-client, dev tools open in the desktop shell, etc.).
 */

declare global {
  interface Window {
    __TAURI__?: unknown
  }
}

/** True iff the page is loaded inside the Tauri WebView. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI__ !== 'undefined'
}

type Invoke = typeof import('@tauri-apps/api/core').invoke

async function getInvoke(): Promise<Invoke | null> {
  if (!isTauri()) return null
  try {
    // Dynamic import keeps the @tauri-apps/api package out of the browser
    // bundle's eager graph — bundlers tree-shake it cleanly when isTauri()
    // is statically false at the call site.
    const mod = await import('@tauri-apps/api/core')
    return mod.invoke
  } catch (err) {
    console.warn('[tauri-bridge] @tauri-apps/api/core unavailable:', err)
    return null
  }
}

/**
 * Push the current session (auth token + master key bytes) to the desktop
 * Rust process so it can persist them and auto-unlock on next launch.
 *
 * masterKey is converted to a plain `number[]` because Tauri IPC serializes
 * via JSON — Uint8Array becomes a sparse object on the wire otherwise.
 */
export async function pushTauriSession(
  token: string,
  masterKey: Uint8Array,
): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) return
  try {
    await invoke('set_session', { token, masterKey: Array.from(masterKey) })
  } catch (err) {
    console.warn('[tauri-bridge] set_session failed:', err)
  }
}

/**
 * Tell the desktop process to drop any cached session. Called on explicit
 * logout (fullLogout / clearToken paths). Locking the vault without
 * logging out doesn't trigger this — the user is still authed.
 */
export async function clearTauriSession(): Promise<void> {
  const invoke = await getInvoke()
  if (!invoke) return
  try {
    await invoke('clear_session')
  } catch (err) {
    console.warn('[tauri-bridge] clear_session failed:', err)
  }
}
