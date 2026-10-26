import { afterAll, beforeEach, expect, test } from 'bun:test'
import { setAuthIdentity } from '@beebeeb/shared/api'
import { setOfflineCacheAccessCheck } from '../src/lib/offline-cache'
import { encryptThumbnailBlob, fetchAndDecryptThumbnail, fetchAndDecryptLargeThumbnail, clearThumbnailCache } from '../src/lib/thumbnail'
const real = { fetch: globalThis.fetch, caches: globalThis.caches, create: URL.createObjectURL, revoke: URL.revokeObjectURL }
const stores = new Map<string, Map<string, Response>>()
const revoked: string[] = []
let urls = 0
let fetches = 0
const key = new Uint8Array(32).fill(4)
const secret = 'private pixel fixture'
const encrypted = await encryptThumbnailBlob(new Blob([secret]), key)
function store(name: string) {
  let rows = stores.get(name)
  if (!rows) { rows = new Map(); stores.set(name, rows) }
  return rows
}
globalThis.caches = {
  open: async (name: string) => {
    const rows = store(name)
    return { match: async (path: string) => rows.get(path)?.clone(), put: async (path: string, response: Response) => { rows.set(path, response.clone()) }, keys: async () => [...rows.keys()], delete: async (path: string) => rows.delete(path) }
  },
  delete: async (name: string) => stores.delete(name),
} as unknown as CacheStorage
URL.createObjectURL = () => `blob:test-${++urls}`
URL.revokeObjectURL = url => { revoked.push(url) }
beforeEach(async () => {
  setAuthIdentity('account-a'); setOfflineCacheAccessCheck(() => true)
  await clearThumbnailCache(); stores.clear(); revoked.length = 0; urls = 0; fetches = 0
  globalThis.fetch = (async () => { fetches++; return new Response(encrypted) }) as typeof fetch
})
afterAll(async () => {
  await clearThumbnailCache()
  setAuthIdentity(null); setOfflineCacheAccessCheck(() => false)
  globalThis.fetch = real.fetch; globalThis.caches = real.caches
  URL.createObjectURL = real.create; URL.revokeObjectURL = real.revoke
})

test('persistent cache contains only authenticated ciphertext and still works offline with the key', async () => {
  expect(await fetchAndDecryptThumbnail('file-a', key)).toBe('blob:test-1')
  const entries = [...stores.values()].flatMap(rows => [...rows.values()])
  expect(entries.length).toBe(1)
  expect(new Uint8Array(await entries[0].clone().arrayBuffer())).toEqual(encrypted)
  await clearThumbnailCache()
  globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch
  expect(await fetchAndDecryptThumbnail('file-a', key)).toBe('blob:test-2')
})

test('lock revokes rendered URLs and a wrong key cannot reuse cached plaintext', async () => {
  const url = await fetchAndDecryptThumbnail('file-b', key)
  expect(url).not.toBeNull()
  await clearThumbnailCache()
  expect(revoked).toContain(url!)
  expect(await fetchAndDecryptThumbnail('file-b', new Uint8Array(32).fill(9))).toBeNull()
})

test('deletes the legacy persistent plaintext cache', async () => {
  store('beebeeb-thumbnails-v2').set('/thumb/legacy', new Response(secret))
  await clearThumbnailCache()
  expect(stores.has('beebeeb-thumbnails-v2')).toBe(false)
})

test('a response arriving after lock cannot recreate a decrypted object URL', async () => {
  let finish!: (response: Response) => void
  globalThis.fetch = (() => new Promise<Response>(resolve => { finish = resolve })) as typeof fetch
  const pending = fetchAndDecryptThumbnail('late-file', key)
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0))
  await clearThumbnailCache()
  finish(new Response(encrypted))
  expect(await pending).toBeNull()
  expect(urls).toBe(0)
})


test('large preview URLs are revoked at lock and a stale key holder cannot restart a preview', async () => {
  const first = await fetchAndDecryptLargeThumbnail('large-file', key)
  const second = await fetchAndDecryptLargeThumbnail('large-file', key)
  expect(first).not.toBeNull()
  expect(second).not.toBe(first)
  expect(revoked).not.toContain(first!)
  await clearThumbnailCache()
  expect(revoked).toContain(first!)
  expect(revoked).toContain(second!)
  setOfflineCacheAccessCheck(() => false)
  const requestsBefore = fetches
  expect(await fetchAndDecryptLargeThumbnail('large-file', key)).toBeNull()
  expect(fetches).toBe(requestsBefore)
})
