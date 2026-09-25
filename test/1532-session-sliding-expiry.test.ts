import { describe, test, expect, beforeEach } from 'bun:test'
import { installFakeIndexedDB } from './helpers/fake-indexeddb'

// Task 1532 (Guus ruling, 2026-09-25): "1532 unlocked should be allowed for
// more than 30m, 60m of inactivity should be good". The "stay unlocked"
// session-persist cache moves from a FIXED time-since-login TTL to a
// SLIDING inactivity window, capped at 60 minutes: activity (touchSession)
// keeps pushing the expiry forward; idle past the window and the blob +
// token are deleted EAGERLY (timer + visibilitychange/pagehide), not only
// lazily on the next app load. Options above 60 minutes (incl. the old
// 30-day option) are gone, and an existing stored TTL above 60 minutes is
// clamped to 60 on next load rather than silently falling back to a
// different default.
//
// Same in-memory localStorage/indexedDB stand-ins as
// test/1529-vault-empty-password.test.ts (bun test has neither global —
// verified there under bun 1.3.4).
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}
;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()

const fakeIdb = installFakeIndexedDB()
beforeEach(() => {
  fakeIdb.reset()
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
})

const {
  persistSession,
  restoreSession,
  touchSession,
  clearSession,
  getVaultTTL,
  setVaultTTL,
  TTL_OPTIONS,
} = await import('../src/lib/session-persist')
const { cacheKeySessionOnly } = await import('../src/lib/key-cache')
const { initSessionVault } = await import('../src/lib/session-vault-cache')

function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

/**
 * Directly patches the raw `beebeeb_session_persist` entry's
 * `lastActivityAt` field — the same technique the rest of this repo uses to
 * simulate elapsed time (e.g. test/pending-checkout-0957.test.ts writes
 * `ts: Date.now() - X`), rather than mocking Date.now() globally. Leaves
 * `wrapped`/`nonce` untouched so restoreSession()'s decrypt still succeeds
 * when the patched offset is still inside the window.
 */
async function patchLastActivityAt(msAgo: number): Promise<void> {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('beebeeb_session_persist', 1)
    req.onupgradeneeded = () => {
      const database = req.result
      if (!database.objectStoreNames.contains('session')) {
        database.createObjectStore('session', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const entry: Record<string, unknown> | undefined = await new Promise((resolve, reject) => {
    const tx = db.transaction('session', 'readonly')
    const r = tx.objectStore('session').get('persist')
    r.onsuccess = () => resolve(r.result as Record<string, unknown> | undefined)
    r.onerror = () => reject(r.error)
  })
  if (!entry) throw new Error('patchLastActivityAt: no persisted entry to patch')
  entry.lastActivityAt = Date.now() - msAgo
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('session', 'readwrite')
    const r = tx.objectStore('session').put(entry)
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
  })
  db.close()
}

/** Raw read of the persisted entry, bypassing the TTL check in restoreSession. */
async function rawEntry(): Promise<unknown> {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('beebeeb_session_persist', 1)
    req.onupgradeneeded = () => {
      const database = req.result
      if (!database.objectStoreNames.contains('session')) {
        database.createObjectStore('session', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const entry = await new Promise((resolve, reject) => {
    const tx = db.transaction('session', 'readonly')
    const r = tx.objectStore('session').get('persist')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  db.close()
  return entry
}

describe('task 1532: sliding expiry — activity extends the window', () => {
  test('activity at ~50 minutes idle keeps the session alive well past where a fixed 60-min-since-login TTL would have expired it', async () => {
    setVaultTTL(60 * 60 * 1000) // 1 hour — the ruling's window
    const key = randomKey()
    await persistSession(key)

    // Simulate 50 minutes of inactivity since login/last activity.
    await patchLastActivityAt(50 * 60 * 1000)
    // Activity happens now (t=50min): touchSession slides the window forward.
    await touchSession()

    // Simulate a further 59 minutes of inactivity SINCE THE TOUCH (i.e.
    // t=109min since original login) — under the OLD fixed-since-creation
    // 60-minute TTL this would already be long expired; under the sliding
    // window it is still valid because the touch reset the anchor.
    await patchLastActivityAt(59 * 60 * 1000)
    const restored = await restoreSession()
    expect(restored).toEqual(key)
  })

  test('idle 61 minutes (no activity) → the session is gone: restoreSession returns null, bb_spt + the IDB entry are both cleared', async () => {
    setVaultTTL(60 * 60 * 1000)
    const key = randomKey()
    await persistSession(key)

    await patchLastActivityAt(61 * 60 * 1000)
    const restored = await restoreSession()

    expect(restored).toBeNull()
    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await rawEntry()).toBeUndefined()
  })

  test('a control: 59 minutes idle (still inside the window, no activity needed) restores fine', async () => {
    setVaultTTL(60 * 60 * 1000)
    const key = randomKey()
    await persistSession(key)
    await patchLastActivityAt(59 * 60 * 1000)
    expect(await restoreSession()).toEqual(key)
  })

  test('touchSession never resurrects an entry that has already crossed the window', async () => {
    setVaultTTL(60 * 60 * 1000)
    const key = randomKey()
    await persistSession(key)
    await patchLastActivityAt(90 * 60 * 1000) // way past 60 min, no activity since

    await touchSession() // must be a no-op — not a resurrection
    const restored = await restoreSession()

    expect(restored).toBeNull()
    expect(await rawEntry()).toBeUndefined()
  })
})

describe('task 1532: a stored TTL above 60 minutes is clamped to 60, not discarded to a different default', () => {
  test('getVaultTTL() clamps a pre-1532 stored 30-day value down to exactly MAX (60 minutes) — not the 30-minute default', async () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    localStorage.setItem('bb_vault_ttl', String(THIRTY_DAYS_MS))

    const effective = getVaultTTL()

    expect(effective).toBe(60 * 60 * 1000)
    expect(effective).not.toBe(30 * 60 * 1000) // would be the DEFAULT_TTL_MS fallback — wrong clamp target
  })

  test('a persisted session inherits the clamp: still alive at 59 min under the stale 30-day stored value, gone at 61', async () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    localStorage.setItem('bb_vault_ttl', String(THIRTY_DAYS_MS))
    const key = randomKey()
    await persistSession(key)

    await patchLastActivityAt(59 * 60 * 1000)
    expect(await restoreSession()).toEqual(key)

    await persistSession(key) // fresh entry
    await patchLastActivityAt(61 * 60 * 1000)
    expect(await restoreSession()).toBeNull()
  })

  test('TTL_OPTIONS no longer offers anything above 60 minutes (the 4h/1day/7day/30day options are gone)', () => {
    const values = TTL_OPTIONS.map(o => o.value)
    expect(Math.max(...values)).toBe(60 * 60 * 1000)
    for (const v of values) expect(v).toBeLessThanOrEqual(60 * 60 * 1000)
  })
})

describe('task 1532: eager deletion — the blob + token are cleared without waiting for the next restoreSession() call', () => {
  test('a real (short) window: once it elapses, the eager-deletion timer clears bb_spt + the IDB entry on its own, with no restoreSession() call at all', async () => {
    setVaultTTL(80) // 80ms — a real, valid, tiny window (no dev override needed)
    const key = randomKey()
    await persistSession(key)

    expect(localStorage.getItem('bb_spt')).not.toBeNull()
    expect(await rawEntry()).not.toBeUndefined()

    await new Promise(resolve => setTimeout(resolve, 300))

    // Nobody called restoreSession() — the timer armed by persistSession()
    // must have fired and cleared eagerly on its own.
    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await rawEntry()).toBeUndefined()
  })
})

describe('task 1532: the passkey session-only path still persists nothing', () => {
  test('cacheKeySessionOnly + activity (touchSession, as key-context.tsx wires for every unlocked tab) never creates a persisted entry', async () => {
    setVaultTTL(60 * 60 * 1000)
    const key = randomKey()
    await initSessionVault()
    await cacheKeySessionOnly(key)

    // The activity listener in key-context.tsx calls touchSession() on any
    // interaction while isUnlocked — regardless of which path unlocked it.
    // It must stay a no-op when nothing was ever persisted in the first
    // place (task 1529's ruling: passkey-without-PRF is session-only).
    await touchSession()
    await touchSession()

    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await rawEntry()).toBeUndefined()
    expect(await restoreSession()).toBeNull()
  })
})

describe('task 1532: clearSession control (proves the assertions above can detect a real persisted entry)', () => {
  test('persistSession followed by clearSession leaves nothing behind — sanity check for the "gone" assertions', async () => {
    setVaultTTL(60 * 60 * 1000)
    const key = randomKey()
    await persistSession(key)
    expect(localStorage.getItem('bb_spt')).not.toBeNull()

    await clearSession()

    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await rawEntry()).toBeUndefined()
  })
})

// ─── Continuation: web PR #77, Codex P2 on session-persist.ts:257 ────
//
// setVaultTTL() only wrote localStorage — it never touched the ALREADY-
// ARMED expiry timer (captured at persist/restore/touch time) or the
// persisted entry itself. Shortening the setting (e.g. 60 -> 15 min) left
// the stale, longer-duration timer running: an idle session outlived the
// new window until either that old timer eventually fired (using whatever
// TTL was current AT THAT POINT — correct value, wrong wait) or the user
// generated fresh activity via touchSession(). An idle tab got neither.
//
// `await flush()` below lets the fire-and-forget recheck setVaultTTL() now
// kicks off (`void checkAndClearIfExpired()`) actually run: openDB/dbGet/
// dbDelete in the fake IndexedDB resolve over queueMicrotask hops, and a
// zero-delay setTimeout is ordered after all pending microtasks.
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('task 1532 continuation (web #77, Codex P2): setVaultTTL no longer leaves a stale timer armed at the OLD ttl', () => {
  test('setVaultTTL(15 min) while 20 min already idle deletes the session IMMEDIATELY — does not wait for the stale 60-min timer', async () => {
    setVaultTTL(60 * 60 * 1000) // 60 min
    const key = randomKey()
    await persistSession(key)

    await patchLastActivityAt(20 * 60 * 1000) // 20 min idle already
    setVaultTTL(15 * 60 * 1000) // shorten to 15 min — 20 min already exceeds it
    await flush()

    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await rawEntry()).toBeUndefined()
  })

  test('setVaultTTL(15 min) with NO activity elapsed does not delete right away — only once the new (shorter) window actually elapses', async () => {
    setVaultTTL(60 * 60 * 1000)
    const key = randomKey()
    await persistSession(key)

    setVaultTTL(15 * 60 * 1000) // shortened, but 0 min idle so far
    await flush()

    // Still alive immediately after shortening — the recheck must not be a
    // blanket "shortened => delete", only "already past the new window".
    expect(localStorage.getItem('bb_spt')).not.toBeNull()
    expect(await rawEntry()).not.toBeUndefined()
  })

  test('the re-armed timer fires at the NEW (shorter) duration, not the stale OLD one — real wall-clock ms-scale window, no activity, no restoreSession() call', async () => {
    setVaultTTL(1000) // stand-in "long" window (proportionally: 60 min)
    const key = randomKey()
    await persistSession(key)

    setVaultTTL(150) // stand-in "shortened to 15 min" — 0 idle so far
    await flush() // let the immediate recheck run: not yet past 150ms, must re-arm

    expect(localStorage.getItem('bb_spt')).not.toBeNull() // sanity: not deleted by the recheck itself

    // Wait past the NEW 150ms window but well under the STALE 1000ms one.
    // Pre-fix: the original persistSession() timer (armed for 1000ms) is
    // still the only one running -> still present here -> RED.
    // Post-fix: setVaultTTL() re-armed at ~150ms remaining -> fired -> gone.
    await new Promise(resolve => setTimeout(resolve, 320))

    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await rawEntry()).toBeUndefined()
  })

  test('control: touchSession() already re-arms against the CURRENT ttl on every call (no regression introduced here)', async () => {
    setVaultTTL(60 * 60 * 1000)
    const key = randomKey()
    await persistSession(key)

    await patchLastActivityAt(10 * 60 * 1000) // 10 min idle
    await touchSession() // activity now -> anchor resets, re-arms at current (60 min) ttl

    setVaultTTL(30 * 60 * 1000) // shorten to 30 min; 0 idle since the touch
    await flush()
    expect(await rawEntry()).not.toBeUndefined() // not past 30 min yet (0 elapsed)

    // 29 min since the touch — inside the NEW 30-min window but would be
    // outside a stale 60-min one. touchSession() reads ttl fresh every
    // call, so this only extends the anchor if it is checking against the
    // CURRENT (30 min) value.
    await patchLastActivityAt(29 * 60 * 1000)
    await touchSession()
    expect(await restoreSession()).toEqual(key) // proves the anchor really moved to "now"
  })
})

// ─── Continuation: other tabs (storage event) ─────────────────────────
//
// setVaultTTL()'s recheck above only re-arms the timer IN THE TAB THAT
// CALLED IT. A second, already-unlocked tab has its own module-level timer,
// armed at whatever ttl was current when IT last persisted/restored/
// touched — changing the setting in tab A does not reach tab B's timer
// directly. The browser's `storage` event fires in tab B (never in tab A,
// the one that wrote) whenever localStorage changes; initSessionExpiryWatcher
// now listens for it and reruns the same recheck.
//
// bun test has neither `window` nor `document` (confirmed empty globals,
// same as the missing `indexedDB` this file already stands in for) — DOM
// dispatch of a real StorageEvent needs a browser, which is what
// e2e/scripts/web-e2e.sh is for. This stands in the same minimal way the
// rest of the file stands in for indexedDB/localStorage: a fake
// `window`/`document` exposing just the `addEventListener` surface
// session-persist.ts calls, so the registered 'storage' callback can be
// invoked directly and its effect on the persisted entry asserted for real.
describe('task 1532 continuation (web #77): storage event reconciles the OTHER tab\'s stale timer', () => {
  test('another tab shortening bb_vault_ttl fires "storage" here -> this tab\'s stale timer is re-armed/expired against the NEW value', async () => {
    const listeners = new Map<string, (e: { key: string | null }) => void>()
    ;(globalThis as { document?: unknown }).document = {
      addEventListener: (_type: string, _cb: () => void) => {},
    }
    ;(globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, cb: (e: { key: string | null }) => void) => {
        listeners.set(type, cb)
      },
    }

    const { initSessionExpiryWatcher } = await import('../src/lib/session-persist')
    initSessionExpiryWatcher()
    const storageListener = listeners.get('storage')
    expect(storageListener).toBeDefined()

    setVaultTTL(60 * 60 * 1000) // this (simulated) tab's own setting: 60 min
    const key = randomKey()
    await persistSession(key) // arms THIS tab's timer at 60 min

    await patchLastActivityAt(20 * 60 * 1000) // 20 min idle

    // Simulate "another tab" shortening the setting: it writes localStorage
    // directly (what setVaultTTL() does in that other tab) WITHOUT calling
    // this tab's setVaultTTL() — only the storage event crosses over.
    localStorage.setItem('bb_vault_ttl', String(15 * 60 * 1000))
    storageListener!({ key: 'bb_vault_ttl' })
    await flush()

    // 20 min idle > the new 15-min value -> the storage-event recheck must
    // delete it, same as the same-tab setVaultTTL() path above.
    expect(localStorage.getItem('bb_spt')).toBeNull()
    expect(await rawEntry()).toBeUndefined()
  })
})
