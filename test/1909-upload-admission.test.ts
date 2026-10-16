import { afterEach, expect, test } from 'bun:test'
import { setExpectedUserProvider } from '@beebeeb/shared'
import { installMocks, cap, resetCaptures } from './helpers/upload-share-mocks'
await installMocks()
afterEach(() => setExpectedUserProvider(null))

for (const nextOwner of ['user-b', null]) {
  test(`1909: queued upload without a signal rejects when vault owner becomes ${nextOwner}`, async () => {
    resetCaptures()
    let owner: string | null = 'user-a'
    setExpectedUserProvider(() => owner)
    const { encryptedUpload } = await import('../src/lib/encrypted-upload')
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const jobs = Array.from({ length: 3 }, (_, i) => encryptedUpload(
      new File([new Uint8Array([1, 2, 3, 4])], `${i}.txt`), `${i}`,
      new Uint8Array([1]), new Uint8Array([9]), undefined, undefined, undefined, undefined,
      undefined, async () => { await gate; return new Uint8Array([9]) },
    ))
    const done = Promise.allSettled(jobs)
    try {
      await new Promise(r => setTimeout(r, 30))
      expect(cap.initCalls.length).toBe(2)
      owner = nextOwner
    } finally { release() }
    const results = await done
    expect(results[2].status).toBe('rejected')
    if (results[2].status === 'rejected') expect(results[2].reason.name).toBe('AbortError')
    expect(cap.initCalls.length).toBe(2)
  })
}

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
