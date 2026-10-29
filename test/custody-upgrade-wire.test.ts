/**
 * Task 2237b L7b (a), contract 2237 §1/§2: the custody upgrade's two requests
 * on the wire. Separate from folder-custody-upgrade.test.ts, which mocks the
 * crypto module; this one needs the real request(). Coded against server #353
 * (feat/2237b-a-custody-upgrade) and the contract: if the server settles a
 * different route or body, `upgradeSharedFolderCustody` in api.ts is the one
 * place to change, and this test with it.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

describe('custody upgrade requests on the wire', () => {
  const originalFetch = globalThis.fetch
  let calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
  let reply: unknown = {}
  beforeEach(() => {
    calls = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('the upgrade is one PUT .../key with the L6 custody record, format "l7" and every row in rewrap.keys', async () => {
    reply = { created: true, key_version: 1, rewrapped: 1 }
    const { upgradeSharedFolderCustody } = await import('../src/lib/api')
    const res = await upgradeSharedFolderCustody('F', {
      ownerWrappedFolderKey: 'custody',
      keys: [{ file_id: 'c', encrypted_file_key: 'k' }],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toContain('/api/v1/shared-folders/F/key')
    expect(calls[0].body).toEqual({
      owner_wrapped_folder_key: 'custody',
      key_version: 1,
      format: 'l7',
      rewrap: { keys: [{ file_id: 'c', encrypted_file_key: 'k' }] },
    })
    expect(res.rewrapped).toBe(1)
  })

  test('an empty folder still sends rewrap (an upgrade is never a plain registration)', async () => {
    reply = { created: true, key_version: 1, rewrapped: 0 }
    const { upgradeSharedFolderCustody } = await import('../src/lib/api')
    await upgradeSharedFolderCustody('F', { ownerWrappedFolderKey: 'custody', keys: [] })
    expect(calls[0].body?.rewrap).toEqual({ keys: [] })
    expect(calls[0].body?.format).toBe('l7')
  })

  test('the legacy rows are listed with GET .../legacy-keys, each with its kind', async () => {
    reply = { keys: [{ file_id: 'c', encrypted_file_key: 'k', is_folder: true }] }
    const { listLegacyFolderKeys } = await import('../src/lib/api')
    expect(await listLegacyFolderKeys('F')).toEqual([{ file_id: 'c', encrypted_file_key: 'k', is_folder: true }])
    expect(calls[0].method).toBe('GET')
    expect(calls[0].url).toContain('/api/v1/shared-folders/F/legacy-keys')
  })
})
