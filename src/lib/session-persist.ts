// ─── Session persistence ────────────────────────────
// Keeps the vault unlocked across page refreshes with a SLIDING
// inactivity window (task 1532, Guus ruling 2026-09-25: "60m of
// inactivity should be good").
//
// On unlock: generates a random "remember token", wraps the master key
// with it via AES-256-GCM, stores the wrapped blob + timestamps in
// IndexedDB and the remember token in localStorage.
//
// While unlocked: user activity (interaction / API use) calls
// touchSession(), which bumps the stored `lastActivityAt` — the window
// keeps sliding forward as long as the user keeps using the app.
//
// On load, and eagerly via a re-armed timer + visibilitychange/pagehide
// listeners: if more than the window has elapsed since `lastActivityAt`,
// the blob + token are deleted. Deletion is not deferred to the next app
// load — an idle tab left open past the window loses its persisted key
// on its own.
//
// Security tradeoff: XSS can read the token from localStorage, but the
// master key is never in localStorage directly. An attacker would need
// to read from both localStorage AND IndexedDB, then perform the unwrap.
// The sliding window, capped at 60 minutes, limits the exposure window.

const DB_NAME = 'beebeeb_session_persist'
const DB_VERSION = 1
const STORE_NAME = 'session'
const ENTRY_ID = 'persist'

const LS_TOKEN_KEY = 'bb_spt'
const LS_TTL_KEY = 'bb_vault_ttl'
const NONCE_BYTES = 12

const DEFAULT_TTL_MS = 30 * 60 * 1000
const MAX_TTL_MS = 60 * 60 * 1000

// ─── Generation counter (guards a stale in-flight persistSession()) ──
//
// Task 1532 continuation (web PR #78, Codex P1): persistSession() reads
// effectiveTtlMs() once, then does real async work (deriveKey/encrypt,
// IndexedDB). A setVaultTTL(0) landing DURING that await window used to be
// clobbered — persistSession() had already decided to persist and just
// went ahead and committed the wrapped key + token after "Every refresh"
// cleared them, and the timer it then armed used TTL 0's own
// checkAndClearIfExpired() no-op (see below) to never clean it up.
//
// Bumped by every setVaultTTL() and clearSession() call — either one means
// "whatever an in-flight persist decided is stale". persistSession()
// captures the generation before starting its async work and re-checks it
// (together with the CURRENT effective TTL) immediately before each write;
// a mismatch aborts the commit and cleans up instead of persisting a
// session the setting no longer allows.
let ttlGeneration = 0

interface PersistEntry {
  id: typeof ENTRY_ID
  wrapped: ArrayBuffer
  nonce: Uint8Array
  /** Diagnostic only — expiry is keyed off `lastActivityAt`, not this. */
  createdAt: number
  /** Task 1531/1534 (P0): the account this persisted key was stamped for —
   *  see session-vault-cache.ts's identical field for the full rationale.
   *  Not a secret (not covered by the AEAD); a plain ownership tag. */
  userId?: string
  /** The sliding-window anchor: bumped by touchSession() on activity. */
  lastActivityAt: number
}

// ─── TTL preference (Settings → Vault timeout) ────────

/**
 * The user's chosen window, clamped to MAX_TTL_MS (60 min). A value stored
 * before task 1532 (e.g. the old 30-day option) is clamped down to 60
 * minutes here rather than discarded to a different default — "existing
 * stored TTLs > 60 min are clamped to 60 on next load" per the ruling.
 *
 * `raw === null` (key was never written, or was removed) means "no
 * preference recorded" and falls back to DEFAULT_TTL_MS. An explicit stored
 * "0" means the user picked "Every refresh" and must read back as exactly
 * 0 — NOT the default. (Task 1532 continuation, eng-1532c: `setVaultTTL(0)`
 * used to `removeItem` the key, which made "explicitly chose Every refresh"
 * indistinguishable from "never chose anything", so this function silently
 * upgraded a 0-ms preference to the 30-min default and `persistSession`
 * would go on to persist a session the user had just asked it not to.)
 */
export function getVaultTTL(): number {
  try {
    const raw = localStorage.getItem(LS_TTL_KEY)
    if (raw !== null) {
      const ms = parseInt(raw, 10)
      if (!isNaN(ms) && ms >= 0) return Math.min(ms, MAX_TTL_MS)
    }
  } catch { /* localStorage unavailable */ }
  return DEFAULT_TTL_MS
}

export function setVaultTTL(ms: number): void {
  const clamped = Math.max(0, Math.min(ms, MAX_TTL_MS))
  // Bump FIRST, synchronously, before any of the async cleanup below — an
  // in-flight persistSession() re-checks this against the value it
  // captured at start, so the bump itself is what invalidates it, not the
  // (fire-and-forget, async) clearSession()/checkAndClearIfExpired() calls
  // that follow.
  ttlGeneration++
  try {
    // Always write, including "0" — see getVaultTTL()'s doc comment for why
    // this can no longer be a removeItem().
    localStorage.setItem(LS_TTL_KEY, String(clamped))
  } catch { /* localStorage unavailable */ }

  if (clamped === 0) {
    // "Every refresh": nothing should persist across a reload, including
    // whatever was ALREADY persisted under a previous, longer-window
    // setting — the eager-expiry watcher no-ops once ttl is 0
    // (checkAndClearIfExpired's own `if (ttl === 0) return`), so without
    // this the leftover blob + token would otherwise sit un-expiring in
    // IndexedDB/localStorage until something else overwrites them.
    void clearSession()
    return
  }

  // Task 1532 continuation (Codex P2, web PR #77): the eager-deletion timer
  // captures its duration at persist/restore/touch time. Without this, only
  // shortening the setting (e.g. 60 -> 15 min) left that stale, longer-
  // duration timer armed — an idle session would outlive the NEW window
  // until either the old timer eventually fired or the user generated more
  // activity (touchSession already re-arms against the current TTL, but
  // nothing re-arms on its own while idle). Re-validate the active session
  // against the new TTL immediately: delete it if it is already past the
  // new window, otherwise re-arm the timer at the new remaining duration.
  // checkAndClearIfExpired() re-reads the TTL itself, so it naturally picks
  // up the value just written above.
  void checkAndClearIfExpired()
}

// Options above 60 minutes (incl. the old 30-day option) are gone — task
// 1532. The remaining options are the max INACTIVITY window, not "time
// since login": the window keeps sliding forward while the user is active.
export const TTL_OPTIONS = [
  { label: 'Every refresh', value: 0 },
  { label: '15 minutes', value: 15 * 60 * 1000 },
  { label: '30 minutes', value: 30 * 60 * 1000 },
  { label: '1 hour', value: 60 * 60 * 1000 },
] as const

// ─── Test-only window override (e2e) ──────────────────
//
// DEV-only: `import.meta.env.DEV` is constant-folded to `false` and this
// whole branch is tree-shaken out of production builds (same pattern as
// dev-auth.ts's devAutoAuth). Lets e2e/scripts/web-e2e.sh prove the
// eager-deletion timer actually fires without waiting a real 60 minutes,
// without adding any production-reachable way to change another user's
// (or your own) window — this key is never read outside a DEV build, so
// no URL param or injected localStorage value can reach it in prod.
const LS_TEST_TTL_OVERRIDE_KEY = 'bb_e2e_ttl_override_ms'

function effectiveTtlMs(): number {
  if (import.meta.env.DEV) {
    try {
      const raw = localStorage.getItem(LS_TEST_TTL_OVERRIDE_KEY)
      if (raw) {
        const ms = parseInt(raw, 10)
        if (!isNaN(ms) && ms > 0) return ms
      }
    } catch { /* ignore */ }
  }
  return getVaultTTL()
}

// ─── IndexedDB helpers ────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function dbGet(db: IDBDatabase): Promise<PersistEntry | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(ENTRY_ID)
    req.onsuccess = () => resolve(req.result as PersistEntry | undefined)
    req.onerror = () => reject(req.error)
  })
}

function dbPut(db: IDBDatabase, entry: PersistEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(entry)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function dbDelete(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).delete(ENTRY_ID)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ─── Crypto ───────────────────────────────────────────

async function deriveKey(token: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    token as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** The anchor a pre-1532 entry (no lastActivityAt) falls back to. */
function anchorOf(entry: PersistEntry): number {
  return entry.lastActivityAt ?? entry.createdAt
}

// ─── Eager-deletion watcher ────────────────────────────
//
// The blob + token are deleted as soon as the window elapses — not only
// lazily on the next app load. A re-armed setTimeout covers the common
// case; visibilitychange/pagehide cover the case where the timer was
// throttled while the tab sat in the background (browsers deprioritize
// timers in hidden tabs), by checking as soon as the user comes back or
// the page is about to go away.

let expiryTimer: ReturnType<typeof setTimeout> | null = null
let watcherInstalled = false

function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer)
    expiryTimer = null
  }
}

function armExpiryTimer(msUntilExpiry: number): void {
  clearExpiryTimer()
  expiryTimer = setTimeout(() => { void checkAndClearIfExpired() }, Math.max(0, msUntilExpiry))
}

async function checkAndClearIfExpired(): Promise<void> {
  const ttl = effectiveTtlMs()
  if (ttl === 0) {
    // Codex P1 (web PR #78): TTL 0 ("Every refresh") means nothing may be
    // stored, ever — this used to `return` here, a no-op that assumed
    // nothing could be persisted while ttl reads 0. That assumption broke
    // the moment a persistSession() call raced setVaultTTL(0) and won (see
    // persistSession()'s generation-counter guard above): the eager-
    // deletion watcher — the ONLY thing standing between a stale commit and
    // it sitting forever — silently did nothing because it, too, treated
    // ttl===0 as "there's nothing to check". Clear unconditionally instead;
    // clearSession() is a harmless no-op (removeItem +
    // delete on an already-empty store) when there is nothing to delete.
    await clearSession()
    return
  }
  const db = await openDB()
  let entry: PersistEntry | undefined
  try {
    entry = await dbGet(db)
  } finally {
    db.close()
  }
  if (!entry) return
  const elapsed = Date.now() - anchorOf(entry)
  if (elapsed >= ttl) {
    await clearSession()
  } else {
    armExpiryTimer(ttl - elapsed)
  }
}

/**
 * Installs the eager-deletion watcher (re-armed timer + visibilitychange/
 * pagehide listeners). Idempotent — safe to call on every KeyProvider
 * mount. No-op outside a browser (no `document`, e.g. SSR/build tooling).
 */
export function initSessionExpiryWatcher(): void {
  if (watcherInstalled) return
  watcherInstalled = true
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', () => { void checkAndClearIfExpired() })
  window.addEventListener('pagehide', () => { void checkAndClearIfExpired() })
  // Task 1532 continuation (Codex P2, web PR #77), other-tabs case:
  // setVaultTTL() in ANOTHER tab only re-arms THAT tab's in-process timer
  // (module-level `expiryTimer`, not shared across tabs). `storage` fires
  // here — never in the tab that made the write — whenever bb_vault_ttl
  // changes elsewhere; re-run the same recheck so this tab's timer doesn't
  // keep running at a TTL the user just shortened (or lengthened) in a
  // different tab.
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === LS_TTL_KEY) void checkAndClearIfExpired()
  })
  void checkAndClearIfExpired()
}

// ─── Public API ───────────────────────────────────────

// Task 1531/1534 (P0) + task 1532: every persisted entry is both
// account-bound (`userId`, threaded from the same auth response that
// proved identity — never inferred) and TTL-governed by the sliding
// inactivity window below. Neither guarantee is optional for the other.
export async function persistSession(masterKey: Uint8Array, userId: string): Promise<void> {
  const ttl = effectiveTtlMs()
  if (ttl === 0) {
    // "Every refresh": never persist — and drop anything already sitting
    // from before the setting was changed to this (setVaultTTL(0) already
    // clears at the moment of the setting change; this covers a fresh
    // unlock/login that reaches persistSession() while ttl is 0 by some
    // other path, e.g. the DEV-only e2e override).
    await clearSession()
    return
  }

  // Codex P1 (web PR #78): captured BEFORE any of the async work below —
  // setVaultTTL() bumps this synchronously (before its own async cleanup),
  // so any setVaultTTL()/clearSession() call that lands anywhere during
  // this function's awaits is guaranteed to have moved it by the time we
  // check again.
  const generation = ttlGeneration

  const token = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const key = await deriveKey(token)

  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    key,
    masterKey as unknown as BufferSource,
  )

  // A setVaultTTL(0) (or any other clearSession()) that raced the
  // crypto/IndexedDB work above must win: re-read BOTH the generation
  // counter and the current effective TTL right before committing. Either
  // one having moved means the setting changed (or the session was
  // cleared) mid-flight, so this commit must be abandoned, not written
  // after the fact — see checkAndClearIfExpired()'s TTL-0 branch above for
  // why leaving a stale commit around was previously unrecoverable.
  if (generation !== ttlGeneration || effectiveTtlMs() === 0) {
    await clearSession()
    return
  }

  const now = Date.now()
  const db = await openDB()
  try {
    await dbPut(db, { id: ENTRY_ID, wrapped, nonce, createdAt: now, lastActivityAt: now, userId })
  } finally {
    db.close()
  }

  // Re-check once more: dbPut() above is itself async (an IndexedDB
  // transaction), so the same race could still land in the gap between the
  // check above and the write actually landing.
  if (generation !== ttlGeneration || effectiveTtlMs() === 0) {
    await clearSession()
    return
  }

  try {
    const hex = Array.from(token).map(b => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(LS_TOKEN_KEY, hex)
  } catch { /* localStorage unavailable */ }

  armExpiryTimer(ttl)
}

/** Returns the restored key alongside the account id (task 1531/1534) it
 *  was persisted for. Returns null when no entry exists, TTL has lapsed
 *  (sliding inactivity window, task 1532), decryption fails, or — task
 *  1531/1534 P0 continuation, web PR #85 — the entry PREDATES account
 *  binding (`userId` missing): an untagged entry can only be a stale
 *  pre-1531/1534 write, so it is deleted on sight rather than handed to the
 *  caller to load-then-maybe-lock (same rationale as
 *  session-vault-cache.ts's `getVaultKey`). */
export async function restoreSession(): Promise<{ key: Uint8Array; userId: string } | null> {
  const ttl = effectiveTtlMs()
  if (ttl === 0) return null

  let hex: string | null
  try {
    hex = localStorage.getItem(LS_TOKEN_KEY)
  } catch {
    return null
  }
  if (!hex || hex.length !== 64) return null

  const token = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    token[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }

  const db = await openDB()
  let entry: PersistEntry | undefined
  try {
    entry = await dbGet(db)
  } finally {
    db.close()
  }
  if (!entry) return null

  const elapsed = Date.now() - anchorOf(entry)
  if (elapsed > ttl) {
    await clearSession()
    return null
  }

  const userId = entry.userId
  if (userId === undefined) {
    await clearSession()
    return null
  }

  try {
    const key = await deriveKey(token)
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.nonce as unknown as BufferSource },
      key,
      entry.wrapped,
    )
    armExpiryTimer(ttl - elapsed)
    return { key: new Uint8Array(pt), userId }
  } catch {
    await clearSession()
    return null
  }
}

/**
 * Extends the sliding-expiry window — called on user interaction / API use
 * while a session is persisted (key-context.tsx wires this to DOM activity
 * events). No-ops if nothing is persisted, persistence is off (ttl === 0),
 * or the window has already elapsed: touching an expired entry must never
 * resurrect it — that case is left for the expiry timer / next
 * restoreSession() to delete.
 */
export async function touchSession(): Promise<void> {
  const ttl = effectiveTtlMs()
  if (ttl === 0) return

  const db = await openDB()
  try {
    const entry = await dbGet(db)
    if (!entry) return
    const now = Date.now()
    if (now - anchorOf(entry) > ttl) return
    await dbPut(db, { ...entry, lastActivityAt: now })
  } finally {
    db.close()
  }

  armExpiryTimer(ttl)
}

export async function clearSession(): Promise<void> {
  // Any clear invalidates an in-flight persistSession() too — not just a
  // direct setVaultTTL(0) — so a persist racing a plain "log out"/expiry
  // clear can't resurrect what was just deleted either.
  ttlGeneration++
  clearExpiryTimer()
  try {
    localStorage.removeItem(LS_TOKEN_KEY)
  } catch { /* ok */ }
  try {
    const db = await openDB()
    try {
      await dbDelete(db)
    } finally {
      db.close()
    }
  } catch { /* ok */ }
}
