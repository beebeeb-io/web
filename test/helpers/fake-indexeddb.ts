// Minimal in-memory IndexedDB stand-in for `bun test`.
//
// `bun test` has no `indexedDB` global (confirmed: `typeof indexedDB` is
// `undefined` under bun 1.3.4 — there is no bundled fake-indexeddb, jsdom, or
// happy-dom in this repo). src/lib/vault.ts talks to IndexedDB directly
// (open → onupgradeneeded/createObjectStore, transaction → objectStore →
// get/put/delete/clear), so unit-testing it needs *something* implementing
// that surface. Rather than add a new npm dependency for ~40 lines of
// surface, this file implements exactly what vault.ts uses — nothing more —
// backed by an in-memory Map, with request completion dispatched on a
// microtask (`queueMicrotask`) so it behaves like the real async, event-driven
// IndexedDB API that vault.ts's Promise-wrapping (`request.onsuccess = () =>
// resolve(...)`) expects.
//
// Usage:
//   import { installFakeIndexedDB } from './helpers/fake-indexeddb'
//   const fakeIdb = installFakeIndexedDB()
//   beforeEach(() => fakeIdb.reset())   // fresh "device" per test

type Listener = (() => void) | null

class FakeIDBRequest<T = unknown> {
  result: T | undefined
  error: unknown = null
  onsuccess: Listener = null
  onerror: Listener = null
  onupgradeneeded: Listener = null

  static succeed<T>(value: T): FakeIDBRequest<T> {
    const req = new FakeIDBRequest<T>()
    queueMicrotask(() => {
      req.result = value
      req.onsuccess?.()
    })
    return req
  }
}

class FakeObjectStore {
  constructor(private readonly rows: Map<string, unknown>, private readonly keyPath: string) {}

  get(key: string): FakeIDBRequest<unknown> {
    return FakeIDBRequest.succeed(this.rows.get(key))
  }

  put(value: Record<string, unknown>): FakeIDBRequest<void> {
    this.rows.set(value[this.keyPath] as string, value)
    return FakeIDBRequest.succeed(undefined)
  }

  delete(key: string): FakeIDBRequest<void> {
    this.rows.delete(key)
    return FakeIDBRequest.succeed(undefined)
  }

  clear(): FakeIDBRequest<void> {
    this.rows.clear()
    return FakeIDBRequest.succeed(undefined)
  }
}

class FakeTransaction {
  constructor(private readonly store: FakeObjectStore) {}
  objectStore(_name: string): FakeObjectStore {
    return this.store
  }
}

class FakeIDBDatabase {
  private readonly stores = new Map<string, Map<string, unknown>>()
  private readonly keyPaths = new Map<string, string>()

  objectStoreNames = {
    contains: (name: string): boolean => this.stores.has(name),
  }

  createObjectStore(name: string, opts: { keyPath: string }): FakeObjectStore {
    const rows = new Map<string, unknown>()
    this.stores.set(name, rows)
    this.keyPaths.set(name, opts.keyPath)
    return new FakeObjectStore(rows, opts.keyPath)
  }

  transaction(name: string, _mode: 'readonly' | 'readwrite'): FakeTransaction {
    const rows = this.stores.get(name)
    const keyPath = this.keyPaths.get(name) ?? 'id'
    if (!rows) throw new Error(`FakeIndexedDB: no object store "${name}"`)
    return new FakeTransaction(new FakeObjectStore(rows, keyPath))
  }

  // vault.ts calls db.close() in a `finally` after every operation.
  close(): void {}
}

/**
 * Installs a fake `globalThis.indexedDB` backed by persistent in-memory
 * databases, ONE PER DATABASE NAME (matches real IndexedDB: `beebeeb_vault`,
 * `beebeeb_session_cache` and `beebeeb_session_persist` are three separate
 * databases, each with its own object stores — `open()` on each name keeps
 * returning that name's own database, and each name's `onupgradeneeded`
 * fires exactly once, the first time IT is opened).
 *
 * Task 1529 continuation (web #73): the original version of this helper
 * ignored the database `name` entirely and kept a single shared `db`, so
 * the FIRST module to call `open()` (whichever ran first) silently "won"
 * and every other database name's `onupgradeneeded` never fired — a second
 * module's `createObjectStore` call for ITS store never ran, and its first
 * `transaction()` call threw `no object store "…"`. That was invisible as
 * long as tests only exercised vault.ts alone; it broke the moment a test
 * needed vault.ts + session-vault-cache.ts + session-persist.ts (three
 * different DB_NAMEs) in the same file.
 *
 * Returns `{ reset }` to start a fresh "device" (all databases wiped)
 * between tests.
 */
export function installFakeIndexedDB(): { reset: () => void } {
  let dbs = new Map<string, FakeIDBDatabase>()

  const factory = {
    open(name: string, _version: number): FakeIDBRequest<FakeIDBDatabase> {
      const req = new FakeIDBRequest<FakeIDBDatabase>()
      queueMicrotask(() => {
        let database = dbs.get(name)
        const isNew = !database
        if (isNew) {
          database = new FakeIDBDatabase()
          dbs.set(name, database)
        }
        req.result = database as FakeIDBDatabase
        if (isNew) req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  }

  ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = factory

  return {
    reset: () => {
      dbs = new Map()
    },
  }
}
