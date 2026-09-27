/**
 * Office editor Labs opt-in (task 1567 ship prep, 2026-09-27) — a RUNTIME
 * gate, independent of the build-time `FEATURE_OFFICE_EDITOR` flag
 * (../flags.ts).
 *
 * Why two flags: `FEATURE_OFFICE_EDITOR` controls whether the office
 * route/lazy chunk and the ~55 MB (Brotli) engine bundle are even PART OF a
 * given build — it must be `true` for the production image (so the bundle
 * is actually hosted and the route compiles in), but flipping THAT flag
 * requires a rebuild + redeploy, which defeats the point of a fast opt-in
 * for early access before the feature is announced. This module is the
 * founder's own on/off switch on an ALREADY-DEPLOYED production build: a
 * per-browser localStorage flag, settable either by pasting `?labs=office`
 * onto any URL once (it's remembered from then on, same tab or a new one on
 * the same device) or by a future Settings → Labs toggle calling
 * `setOfficeLabsEnabled` directly. No server round-trip, no credentials, no
 * build step — see the task file's ship-prep note for why this shape was
 * chosen over a server-side flag (this app has no admin-configurable
 * feature-flag service yet, and building one is out of scope for unblocking
 * this one feature).
 *
 * Both gates are ANDed together everywhere the office editor is reachable
 * (src/app.tsx's `/office/:fileId` route, file-preview.tsx's "Edit" entry
 * point) — Labs being on can never resurrect a route the BUILD itself
 * doesn't carry, and the build flag alone is no longer enough to show the
 * feature to every visitor of a build that has it compiled in.
 */

const STORAGE_KEY = 'bb-office-labs'
const QUERY_PARAM = 'labs'
const QUERY_VALUE = 'office'

/**
 * True once, and remembered from then on (localStorage), if the current URL
 * carries `?labs=office` OR a previous visit already set it. Safe to call
 * anywhere (SSR-free app, but still guarded — `window`/`localStorage` can
 * throw in a locked-down/private-browsing context; this never throws).
 */
export function isOfficeLabsEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    if (params.get(QUERY_PARAM) === QUERY_VALUE) {
      // Remember it — the whole point is "flip it on prod without a
      // redeploy" via a link the founder can open once, not a param he has
      // to keep appending.
      try {
        window.localStorage.setItem(STORAGE_KEY, 'true')
      } catch {
        // Private-browsing/locked-down storage — the param itself still
        // gates THIS page view; just doesn't persist past it.
      }
      return true
    }
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/** For a future Settings → Labs toggle — sets or clears the same flag
 *  `isOfficeLabsEnabled` reads, without needing the query-param round-trip. */
export function setOfficeLabsEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(STORAGE_KEY, 'true')
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // best-effort — never throws into a click handler.
  }
}
