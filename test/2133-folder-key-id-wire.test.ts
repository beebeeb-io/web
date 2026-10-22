import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// Task 2133 part 2a: the wire bodies of the two requests that carry folder key
// material. Separate file from 2133-folder-key-id.test.ts because that one
// mocks ./api; this one needs the real request().
describe('request bodies on the wire', () => {
  const originalFetch = globalThis.fetch
  let bodies: Array<{ url: string; body: Record<string, unknown> }> = []
  beforeEach(() => {
    bodies = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ invite_id: 'i1', status: 'invited' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('POST /shares/invites carries folder_key_id next to the folder key material', async () => {
    const { createInvite } = await import('../src/lib/api')
    await createInvite('F', 'a@beebeeb.io', {
      is_folder_share: true,
      encrypted_folder_key: '',
      encrypted_owner_folder_key: 'blob',
      folder_keys: [],
      folder_key_id: 'AAAA',
    })
    expect(bodies).toHaveLength(1)
    expect(bodies[0].url).toContain('/api/v1/shares/invites')
    expect(bodies[0].body.folder_key_id).toBe('AAAA')
    expect(bodies[0].body.is_folder_share).toBe(true)
  })

  test('a plain file invite carries no folder_key_id', async () => {
    const { createInvite } = await import('../src/lib/api')
    await createInvite('F', 'a@beebeeb.io')
    expect('folder_key_id' in bodies[0].body).toBe(false)
  })

  test('POST /shares/invites/{id}/folder-keys carries folder_key_id with the keys', async () => {
    const { addFolderKeys } = await import('../src/lib/api')
    await addFolderKeys('inv-9', [{ file_id: 'c', encrypted_file_key: 'k' }], 'BBBB')
    expect(bodies[0].url).toContain('/api/v1/shares/invites/inv-9/folder-keys')
    expect(bodies[0].body).toEqual({ keys: [{ file_id: 'c', encrypted_file_key: 'k' }], folder_key_id: 'BBBB' })
  })
})

