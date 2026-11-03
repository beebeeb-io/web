import { expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

let failure: Error = new Error('lazy import failed')
await mockModuleScoped('../src/lib/direct/session', import.meta.dir, {
  getDirectSession: async () => { throw failure },
})
const { directChunks } = await import('../src/lib/direct/download')
for (const stage of ['lazy import', 'SRI manifest fetch', 'second WASM init']) {
  test(`${stage} failure selects the existing API transport`, async () => {
    failure = new Error(`${stage} failed`)
    expect(await directChunks('file', { versionId: null, chunkFormat: 0 }, new AbortController().signal)).toBeNull()
  })
}
test('initialization cancellation remains an abort', async () => {
  failure = new DOMException('Session changed', 'AbortError')
  await expect(directChunks('file', { versionId: null, chunkFormat: 0 }, new AbortController().signal)).rejects.toThrow('Session changed')
})
