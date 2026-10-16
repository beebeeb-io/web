import { afterEach, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { setClientInfo, setExpectedUserProvider, getClientInfo } from '@beebeeb/shared'
const originalFetch = globalThis.fetch
const originalClientInfo = getClientInfo()
const turn = () => new Promise(r => setTimeout(r, 10))
afterEach(() => { globalThis.fetch = originalFetch; setExpectedUserProvider(null); if (originalClientInfo) setClientInfo(originalClientInfo.client, originalClientInfo.version) })

let value = 1
let encryptions: number[][] = []
const proxy = {
  upsert: async (_id: string, name: string) => { value = Number(name); return [0] },
  encryptBuckets: async (_key: Uint8Array, dirty: number[]) => {
    encryptions.push([...dirty]); return [{ bucket: 0, page: 0, blob: new Uint8Array([value]) }]
  },
  dispose: async () => {},
}
await mockModuleScoped('../src/lib/crypto', import.meta.dir, { buildSearchIndex: async () => proxy })
const { CoreSearchIndex } = await import('../src/lib/search-index-core')
const { putShards } = await import('../src/lib/search-index-shards')

test('1909: shard transport bounds overlapping callers and sends client provenance', async () => {
  const releases: (() => void)[] = []
  let active = 0, peak = 0, calls = 0
  let headers: Headers | undefined
  setClientInfo('web', '1909-test')
  globalThis.fetch = (async (_url, init) => {
    calls++; active++; peak = Math.max(active, peak); headers = new Headers(init?.headers)
    await new Promise<void>(r => releases.push(r)); active--
    return Response.json({ bucket: 0, page: 0, version: 1 })
  }) as typeof fetch
  const jobs = Array.from({ length: 3 }, (_, j) => putShards(Array.from({ length: 4 }, (_, i) => ({
    bucket: j * 4 + i, page: 0, blob: new Uint8Array([1]),
  }))))
  const done = Promise.all(jobs)
  try {
    await turn()
    expect(calls).toBe(2)
    expect(headers?.get('X-Beebeeb-Client')).toBe('web')
  } finally {
    while (calls < 12 || active > 0) { releases.splice(0).forEach(r => r()); await turn() }
    await done
  }
  expect(peak).toBe(2)
})

test('1909: publication encrypts and writes in order; adjacent changes coalesce', async () => {
  value = 1; encryptions = []
  const bodies: number[] = [], releases: (() => void)[] = []
  globalThis.fetch = (async (_url, init) => {
    bodies.push(new Uint8Array(init?.body as ArrayBuffer)[0])
    await new Promise<void>(r => releases.push(r))
    return Response.json({ bucket: 0, page: 0, version: 1 })
  }) as typeof fetch
  const index = await CoreSearchIndex.buildFrom([]), key = new Uint8Array(32)
  const first = index.pushBuckets(key, [0])
  await turn()
  await index.upsert('id', '2')
  const next = [index.pushBuckets(key, [0]), index.pushBuckets(key, [0])]
  const done = Promise.all([first, ...next])
  try { await turn(); expect(bodies).toEqual([1]) }
  finally {
    for (let i = 0; i < 10; i++) { releases.splice(0).forEach(r => r()); await turn() }
    await done
  }
  expect(bodies).toEqual([1, 2])
  expect(encryptions).toHaveLength(2)
  await index.dispose()
})

test('1909: a failed dirty publication remains flushable without another mutation', async () => {
  encryptions = []; let calls = 0
  globalThis.fetch = (async () => {
    calls++; return calls === 1 ? new Response('', { status: 503 }) : Response.json({ version: 1 })
  }) as typeof fetch
  const index = await CoreSearchIndex.buildFrom([]), key = new Uint8Array(32)
  await expect(index.pushBuckets(key, [0])).rejects.toThrow()
  await index.pushBuckets(key, [])
  expect(calls).toBe(2)
  await index.dispose()
})

test('1909: disposing an index cancels queued pages before another account can send them', async () => {
  const releases: (() => void)[] = []
  let calls = 0
  globalThis.fetch = (async () => {
    calls++; await new Promise<void>(r => releases.push(r)); return Response.json({version: 1})
  }) as typeof fetch
  const blocking = putShards([1,2].map(bucket => ({bucket, page: 0, blob: new Uint8Array([1])})))
  await turn()
  const index = await CoreSearchIndex.buildFrom([])
  const pending = index.pushBuckets(new Uint8Array(32), [0])
  const result = Promise.allSettled([pending])
  await turn()
  await index.dispose()
  releases.forEach(r => r()); await blocking
  expect((await result)[0].status).toBe('rejected')
  expect(calls).toBe(2)
})
