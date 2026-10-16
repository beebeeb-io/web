import { expect, test } from 'bun:test'
import { installMocks, cap, resetCaptures } from './helpers/upload-share-mocks'
await installMocks()

test('1909: upload admission is shared and cancels a queued file before init', async () => {
  resetCaptures()
  const { encryptedUpload } = await import('../src/lib/encrypted-upload')
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const abort = new AbortController()
  const jobs = Array.from({ length: 5 }, (_, i) => encryptedUpload(
    new File([new Uint8Array([1,2,3,4])], `${i}.txt`), `${i}`,
    new Uint8Array([1]), new Uint8Array([9]), undefined, undefined, undefined, undefined,
    i === 3 ? abort.signal : undefined,
    async () => { await gate; return new Uint8Array([9]) },
  ))
  const done = Promise.allSettled(jobs)
  try {
    await new Promise(r => setTimeout(r, 30))
    expect(cap.initCalls.length).toBe(2)
    abort.abort()
    await new Promise(r => setTimeout(r, 0))
  } finally { abort.abort(); release() }
  const results = await done
  expect(results.filter(r => r.status === 'fulfilled').length).toBe(4)
  expect(results[3].status).toBe('rejected')
  expect(cap.initCalls.length).toBe(4)
})
