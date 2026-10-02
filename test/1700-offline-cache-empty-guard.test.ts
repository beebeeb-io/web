import { afterAll, describe, expect, test } from 'bun:test'
import type { DriveFile } from '../src/lib/api'

/**
 * Task 1700 — `cacheFileList([])` used to persist an empty list over a good
 * cached folder, poisoning the offline cache (the false-EmptyDrive incident
 * called `cacheFileList` from `refreshFromSync` while the sync tree was
 * incomplete). An empty list must never be written; a non-empty write must
 * still work. A minimal in-memory IndexedDB stands in for the browser so the
 * write path can be observed.
 */

const DB_RECORDS = new Map<string, unknown>()

class FakeReq<T> {
  onsuccess: ((this: unknown) => void) | null = null
  onerror: (() => void) | null = null
  result!: T
}

class FakeStore {
  get(key: string): FakeReq<unknown> {
    const req = new FakeReq<unknown>()
    setTimeout(() => {
      req.result = DB_RECORDS.get(key)
      req.onsuccess?.()
    }, 0)
    return req
  }
  put(record: { parentId: string }): FakeReq<string> {
    const req = new FakeReq<string>()
    fakeIDB.puts.push(record.parentId)
    DB_RECORDS.set(record.parentId, record)
    setTimeout(() => {
      req.result = record.parentId
      req.onsuccess?.()
    }, 0)
    return req
  }
  delete(key: string): FakeReq<undefined> {
    const req = new FakeReq<undefined>()
    DB_RECORDS.delete(key)
    setTimeout(() => req.onsuccess?.(), 0)
    return req
  }
  getAll(): FakeReq<unknown[]> {
    const req = new FakeReq<unknown[]>()
    setTimeout(() => {
      req.result = [...DB_RECORDS.values()]
      req.onsuccess?.()
    }, 0)
    return req
  }
}

const fakeIDB = {
  puts: [] as string[],
  open() {
    const req = new FakeReq<unknown>()
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => { throw new Error('upgrade must not be needed') },
      close: () => {},
      transaction: () => ({ objectStore: () => new FakeStore() }),
    }
    req.result = db
    setTimeout(() => {
      req.onsuccess?.()
    }, 0)
    return req
  },
}

const realIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB
;(globalThis as { indexedDB?: unknown }).indexedDB = fakeIDB

afterAll(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = realIndexedDB
})

const { cacheFileList } = await import('../src/lib/offline-cache')

function row(id: string): DriveFile {
  return {
    id,
    name_encrypted: `enc-${id}`,
    mime_type: null,
    size_bytes: 1,
    is_folder: false,
    is_trashed: false,
    parent_id: null,
    chunk_count: 1,
    is_starred: false,
    has_thumbnail: false,
    has_large_thumbnail: false,
    version_number: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  }
}

function reset() {
  DB_RECORDS.clear()
  fakeIDB.puts.length = 0
}

describe('1700: cacheFileList empty-list guard', () => {
  test('T8 cacheFileList([]) does not overwrite a non-empty cache (and does not write at all)', async () => {
    reset()
    DB_RECORDS.set('__root__', {
      parentId: '__root__',
      files: [row('a')],
      decryptedNames: { a: 'Alpha' },
      cachedAt: Date.now(),
      accessedAt: Date.now(),
    })

    await cacheFileList(null, [])

    expect(fakeIDB.puts).toEqual([])
    const stored = DB_RECORDS.get('__root__') as { files: DriveFile[]; decryptedNames: Record<string, string> }
    expect(stored.files.length).toBe(1)
    expect(stored.files[0].id).toBe('a')
    expect(stored.decryptedNames.a).toBe('Alpha')

    // Control: the instrument can observe a write — a non-empty list persists.
    await cacheFileList(null, [row('b')])
    expect(fakeIDB.puts).toEqual(['__root__'])
    const after = DB_RECORDS.get('__root__') as { files: DriveFile[] }
    expect(after.files.length).toBe(1)
    expect(after.files[0].id).toBe('b')
  })

  test('T8 an empty list into an empty cache remains a no-op', async () => {
    reset()
    await cacheFileList(null, [])
    expect(fakeIDB.puts).toEqual([])
    expect(DB_RECORDS.has('__root__')).toBe(false)
  })
})
