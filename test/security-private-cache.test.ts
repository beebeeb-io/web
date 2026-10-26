import { afterAll, beforeEach, expect, test } from 'bun:test'
import { setAuthIdentity } from '@beebeeb/shared/api'
import { installFakeIndexedDB } from './helpers/fake-indexeddb'
import { cacheFileList, getCachedFileList, cacheFilePreview, getCachedFilePreview, clearOfflineCaches, setOfflineCacheAccessCheck } from '../src/lib/offline-cache'
import type { DriveFile } from '../src/lib/api'
const originalIDB = globalThis.indexedDB
const db = installFakeIndexedDB()
const row = { id: 'file-a', parent_id: null } as DriveFile
beforeEach(() => { db.reset(); setAuthIdentity('account-a'); setOfflineCacheAccessCheck(() => true) })
afterAll(() => { globalThis.indexedDB = originalIDB; setAuthIdentity(null); setOfflineCacheAccessCheck(() => false) })

test('account B never receives account A cached names, rows or plaintext previews', async () => {
  await cacheFileList(null, [row], { 'file-a': 'private-name' })
  await cacheFilePreview('file-a', 'data:image/png;base64,private')
  expect((await getCachedFileList(null))?.decryptedNames).toEqual({ 'file-a': 'private-name' })
  expect(await getCachedFilePreview('file-a')).toContain('private')
  setAuthIdentity('account-b')
  expect(await getCachedFileList(null)).toBeNull()
  expect(await getCachedFilePreview('file-a')).toBeNull()
  await cacheFileList(null, [row])
  expect((await getCachedFileList(null))?.decryptedNames).toEqual({})
})

test('lock/logout clears both plaintext stores', async () => {
  await cacheFileList(null, [row], { 'file-a': 'private-name' })
  await cacheFilePreview('file-a', 'data:image/png;base64,private')
  await clearOfflineCaches()
  expect(await getCachedFileList(null)).toBeNull()
  expect(await getCachedFilePreview('file-a')).toBeNull()
})

test('an in-flight pre-lock write cannot repopulate the stores', async () => {
  // Hold both opens until AFTER the purge has finished, rather than relying
  // on this fake IDB's normal microtask ordering to expose the race.
  const open = indexedDB.open
  let remaining = 2
  const releases: Array<() => void> = []
  indexedDB.open = function (...args: Parameters<IDBFactory['open']>) {
    const request = open.apply(this, args)
    if (remaining-- > 0) {
      let handler: (() => void) | null = null
      Object.defineProperty(request, 'onsuccess', {
        configurable: true,
        get: () => () => { releases.push(() => handler?.()) },
        set: value => { handler = value },
      })
    }
    return request
  }
  try {
    const listWrite = cacheFileList(null, [row], { 'file-a': 'late-secret' })
    const previewWrite = cacheFilePreview('file-a', 'data:late-secret')
    await Promise.resolve()
    expect(releases.length).toBe(2)
    await clearOfflineCaches()
    for (const release of releases) release()
    await Promise.all([listWrite, previewWrite])
  } finally { indexedDB.open = open }
  expect(await getCachedFileList(null)).toBeNull()
  expect(await getCachedFilePreview('file-a')).toBeNull()
})

test('signed-out reads and writes fail closed', async () => {
  await cacheFileList(null, [row])
  setAuthIdentity(null)
  expect(await getCachedFileList(null)).toBeNull()
  await cacheFilePreview('signed-out', 'data:private')
  setAuthIdentity('account-a')
  expect(await getCachedFilePreview('signed-out')).toBeNull()
})

test('live key check blocks reads and new writes even before UI rerenders after lock', async () => {
  await cacheFileList(null, [row], { 'file-a': 'private-name' })
  await cacheFilePreview('file-a', 'data:private')
  setOfflineCacheAccessCheck(() => false)
  expect(await getCachedFileList(null)).toBeNull()
  expect(await getCachedFilePreview('file-a')).toBeNull()
  await cacheFilePreview('late', 'data:late')
  setOfflineCacheAccessCheck(() => true)
  expect(await getCachedFilePreview('late')).toBeNull()
})

test('late writes from a previous login are dropped', async () => {
  const listWrite = cacheFileList(null, [row])
  const previewWrite = cacheFilePreview('file-a', 'data:old-login')
  setAuthIdentity('account-b')
  await Promise.all([listWrite, previewWrite])
  expect(await getCachedFileList(null)).toBeNull()
  expect(await getCachedFilePreview('file-a')).toBeNull()
  setAuthIdentity('account-a')
  expect(await getCachedFileList(null)).toBeNull()
  expect(await getCachedFilePreview('file-a')).toBeNull()
})

test('lock/logout wiring invokes both cache purges and drive checks its captured scope', async () => {
  const keys = await Bun.file(new URL('../src/lib/key-context.tsx', import.meta.url)).text()
  const lock = keys.slice(keys.indexOf('const lock ='), keys.indexOf('const discardStalePasswordVault'))
  const logout = keys.slice(keys.indexOf('const fullLogout ='), keys.indexOf('// Full clear on explicit logout'))
  for (const source of [lock, logout]) {
    expect(source).toContain('clearOfflineCaches()')
    expect(source).toContain('clearThumbnailCache()')
  }
  expect(keys).toContain('setOfflineCacheAccessCheck(() => masterKeyRef.current !== null')
  const drive = await Bun.file(new URL('../src/pages/drive.tsx', import.meta.url)).text()
  const fetch = drive.slice(drive.indexOf('const fetchFiles ='), drive.indexOf('// Latest-callback refs'))
  expect(fetch).toContain('const cacheScope = getOfflineCacheScope()')
  expect(fetch.match(/isCurrentOfflineCacheScope\(cacheScope\)/g)?.length).toBe(5)
})
