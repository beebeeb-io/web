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

  // Frozen contract 2237 §1: `format: "l7"` on every shared_folder_keys write
  // whose wraps are L7, and on no other.
  test('a member key publish for a custody folder carries format "l7"; a legacy one carries none', async () => {
    const { addFolderKeys } = await import('../src/lib/api')
    await addFolderKeys('inv-9', [{ file_id: 'c', encrypted_file_key: 'k' }], 'BBBB', 'l7')
    expect(bodies[0].body).toEqual({ keys: [{ file_id: 'c', encrypted_file_key: 'k' }], folder_key_id: 'BBBB', format: 'l7' })
    await addFolderKeys('inv-9', [{ file_id: 'c', encrypted_file_key: 'k' }], 'BBBB')
    expect('format' in bodies[1].body).toBe(false)
  })

  test('the owner keys publish (custody folders only, always L7) carries format "l7"', async () => {
    const { publishSharedFolderKeys } = await import('../src/lib/api')
    await publishSharedFolderKeys('F', [{ file_id: 'c', encrypted_file_key: 'k' }])
    expect(bodies[0].url).toContain('/api/v1/shared-folders/F/keys')
    expect(bodies[0].body).toEqual({ keys: [{ file_id: 'c', encrypted_file_key: 'k' }], format: 'l7' })
  })

  test('a folder invite sends the format its payload declares', async () => {
    const { createInvite } = await import('../src/lib/api')
    await createInvite('F', 'a@beebeeb.io', {
      is_folder_share: true,
      encrypted_folder_key: '',
      encrypted_owner_folder_key: 'blob',
      folder_keys: [],
      folder_key_id: 'AAAA',
      format: 'l7',
    })
    expect(bodies[0].body.format).toBe('l7')
  })
})
