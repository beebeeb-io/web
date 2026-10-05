import { describe, test, expect, beforeEach } from 'bun:test'
import { installFakeIndexedDB } from './helpers/fake-indexeddb'

/**
 * Task 1810 round 2 — the three security-review P2s on web#141.
 *
 *  P2-1  the stale-vault discard must not delete ANOTHER account's password vault
 *        (the 'master' slot is one per browser);
 *  P2-2  /set-password must lock() any resident key and load the session's user
 *        BEFORE the phrase screen exists, in that order;
 *  P2-3  the signed-in locked surface's phrase button must not sign out (logout
 *        wipes the whole vault store, passkey vault included).
 */

const fakeIdb = installFakeIndexedDB()
beforeEach(() => fakeIdb.reset())

const { wrapAndStore, wrapAndStoreWithPasskey, unwrap, hasVault, clearPasswordVault } = await import('../src/lib/vault')
const { completeResetSession } = await import('../src/lib/reset-session')
const { prepareInPlacePhraseUnlock } = await import('../src/lib/locked-phrase-unlock')

const ME = 'user-me-1810-0000-0000-000000000001'
const OTHER = 'user-other-1810-0000-0000-00000000002'
const PW = 'some-password-1810-xxxxxxxxxx'

function key(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

/** Rewrite the 'master' entry on disk without its account tag: the shape a
 *  pre-1531 device carries. */
async function stripTag(): Promise<void> {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('beebeeb_vault', 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const entry: Record<string, unknown> = await new Promise((resolve, reject) => {
    const r = db.transaction('keys', 'readonly').objectStore('keys').get('master')
    r.onsuccess = () => resolve(r.result as Record<string, unknown>)
    r.onerror = () => reject(r.error)
  })
  delete entry.userId
  await new Promise<void>((resolve, reject) => {
    const r = db.transaction('keys', 'readwrite').objectStore('keys').put(entry)
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
  })
  db.close()
}

describe('P2-1: clearPasswordVault(userId) only removes this account\'s entry', () => {
  test('an entry tagged for ANOTHER account is left alone (returns false, still opens for its owner)', async () => {
    const otherKey = key()
    await wrapAndStore(otherKey, PW, OTHER)
    expect(await clearPasswordVault(ME)).toBe(false)
    expect(await hasVault()).toBe(true)
    const still = await unwrap(PW, OTHER)
    expect(still).not.toBeNull()
    expect(Array.from(still!.key)).toEqual(Array.from(otherKey))
  })

  test('an entry tagged for THIS account is removed', async () => {
    await wrapAndStore(key(), PW, ME)
    expect(await clearPasswordVault(ME)).toBe(true)
    expect(await hasVault()).toBe(false)
  })

  test('an UNTAGGED (pre-1531) entry cannot be attributed: removed, as before', async () => {
    await wrapAndStore(key(), PW, ME)
    await stripTag()
    expect((await unwrap(PW, ME))?.untagged).toBe(true) // precondition: it really is untagged
    expect(await clearPasswordVault(ME)).toBe(true)
    expect(await hasVault()).toBe(false)
  })

  test('with no entry it returns false (so the "we removed your vault" notice is not shown)', async () => {
    expect(await clearPasswordVault(ME)).toBe(false)
  })

  test('a passkey vault is never touched, whichever account it is for', async () => {
    await wrapAndStore(key(), PW, ME)
    await wrapAndStoreWithPasskey(key(), crypto.getRandomValues(new Uint8Array(32)), OTHER)
    expect(await clearPasswordVault(ME)).toBe(true)
    expect(await hasVault()).toBe(true)
  })
})

describe('P2-2: completeResetSession locks, then loads the user, before reporting ready', () => {
  function deps(log: string[], refresh: () => Promise<void> = async () => { log.push('refreshUser') }) {
    return {
      clearLegacyBearer: () => { log.push('clearLegacyBearer') },
      lock: () => { log.push('lock') },
      markPasswordResetCompleted: () => { log.push('mark') },
      refreshUser: refresh,
    }
  }

  test('lock() runs before refreshUser(), refreshUser() is awaited, then ready', async () => {
    const log: string[] = []
    let refreshDone = false
    const result = await completeResetSession(
      deps(log, async () => {
        log.push('refreshUser')
        await new Promise((r) => setTimeout(r, 5))
        refreshDone = true
      }),
    )
    expect(result).toBe('ready')
    expect(refreshDone).toBe(true) // resolved only after the user was loaded
    expect(log.indexOf('lock')).toBeGreaterThanOrEqual(0)
    expect(log.indexOf('lock')).toBeLessThan(log.indexOf('refreshUser'))
    expect(log).toEqual(['clearLegacyBearer', 'lock', 'mark', 'refreshUser'])
  })

  test('if the session cannot be read back it reports failed (no phrase screen on a stale user)', async () => {
    const log: string[] = []
    const result = await completeResetSession(deps(log, async () => { throw new Error('getMe 401') }))
    expect(result).toBe('failed')
    expect(log).toContain('lock')
  })
})

describe('P2-3: the in-place phrase unlock never signs out', () => {
  test('it drops this account\'s stale password entry and calls nothing else', async () => {
    const calls: string[] = []
    await prepareInPlacePhraseUnlock({
      userId: ME,
      discardStalePasswordVault: async (id) => { calls.push(`discard:${id}`); return true },
    })
    expect(calls).toEqual([`discard:${ME}`])
  })

  test('with no user loaded it discards nothing', async () => {
    const calls: string[] = []
    await prepareInPlacePhraseUnlock({
      userId: null,
      discardStalePasswordVault: async (id) => { calls.push(id); return true },
    })
    expect(calls).toEqual([])
  })

  test('the component source does not call logout() from the phrase button', async () => {
    const src = await Bun.file(new URL('../src/components/vault-locked-no-key.tsx', import.meta.url)).text()
    const handler = src.slice(src.indexOf('const handleUnlockWithPhrase'), src.indexOf('// ── exit 1'))
    expect(handler.length).toBeGreaterThan(100)
    expect(handler).not.toMatch(/logout\(/)
    expect(handler).toContain('prepareInPlacePhraseUnlock')
  })
})
