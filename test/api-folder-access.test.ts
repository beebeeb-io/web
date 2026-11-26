import { afterEach, beforeEach, expect, test } from 'bun:test'
import { forgetFolderMembersMiss, getFolderMembers } from '../src/lib/api-folder-access'

const realFetch = globalThis.fetch
let calls = 0
beforeEach(() => {
  calls = 0
  forgetFolderMembersMiss()
  globalThis.fetch = (async () => {
    calls++
    return new Response(JSON.stringify({ error: 'not_found', message: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch })

test('a 404 for a folder is requested once, then served from cache', async () => {
  for (let i = 0; i < 50; i++) {
    await expect(getFolderMembers('f1')).rejects.toMatchObject({ status: 404 })
  }
  expect(calls).toBe(1)
  await expect(getFolderMembers('f2')).rejects.toMatchObject({ status: 404 })
  expect(calls).toBe(2)
  forgetFolderMembersMiss('f1')
  await expect(getFolderMembers('f1')).rejects.toMatchObject({ status: 404 })
  expect(calls).toBe(3)
})
