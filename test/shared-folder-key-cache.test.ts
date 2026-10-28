import { expect, test } from 'bun:test'
import { createSharedFolderKeyCache } from '../src/lib/shared-folder-key-cache'

test('A5 a guest file added after the first listing refreshes the key index once', async () => {
  let calls = 0
  const cache = createSharedFolderKeyCache(async () => {
    calls++
    return calls === 1 ? new Map([['old', 'wrap1']]) : new Map([['old', 'wrap1'], ['new', 'wrap2']])
  })
  expect((await cache.forFile('root', 'old')).get('old')).toBe('wrap1')
  expect((await cache.forFile('root', 'new')).get('new')).toBe('wrap2')
  expect(calls).toBe(2)
  expect((await cache.forFile('root', 'missing')).has('missing')).toBe(false)
  expect(calls).toBe(3) // one refresh for this lookup, no retry loop
})

test('A5 failed requests are evicted so a later lookup recovers', async () => {
  let calls = 0
  const cache = createSharedFolderKeyCache(async () => {
    if (++calls === 1) throw new Error('offline')
    return new Map([['file', 'wrap']])
  })
  await expect(cache.forFile('root', 'file')).rejects.toThrow('offline')
  expect((await cache.forFile('root', 'file')).get('file')).toBe('wrap')
  expect(calls).toBe(2)
})
