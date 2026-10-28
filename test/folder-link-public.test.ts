import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  FolderNotAvailableError,
  FolderShapeError,
  clearProof,
  listFolderItems,
  readProof,
  resolveFolderLink,
  storeProof,
} from '../src/lib/folder-link-public'

// sessionStorage stub — the module only ever uses get/set/removeItem.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
})

let calls: Array<{ url: string; init: RequestInit }> = []
let next: () => Response = () => new Response('{}', { status: 200 })

const originalFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return next()
  }) as unknown as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  calls = []
  store.clear()
  next = () => new Response('{}', { status: 200 })
})

function headersOf(index = 0): Record<string, string> {
  return (calls[index]?.init.headers as Record<string, string>) ?? {}
}

describe('resolveFolderLink (2237b)', () => {
  test('a passphrase link with no proof asks for the passphrase', async () => {
    next = () => Response.json({ passphrase_required: true })
    expect(await resolveFolderLink('tok')).toEqual({ kind: 'passphrase_required' })
  })

  test('a 404 becomes FolderNotAvailableError', async () => {
    next = () => Response.json({ error: 'not_found' }, { status: 404 })
    let caught: unknown
    try {
      await resolveFolderLink('tok')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(FolderNotAvailableError)
    expect((caught as FolderNotAvailableError).status).toBe(404)
  })

  test('a 200 without wrapped_folder_key is a shape error', async () => {
    next = () =>
      Response.json({
        folder_id: 'f',
        root_name_encrypted: 'n',
        access_level: 'view',
      })
    await expect(resolveFolderLink('tok')).rejects.toBeInstanceOf(FolderShapeError)
  })

  test('a 200 with a key resolves ok', async () => {
    next = () =>
      Response.json({
        folder_id: 'f',
        root_name_encrypted: 'n',
        access_level: 'view',
        label_encrypted: null,
        expires_at: null,
        passphrase_protected: false,
        wrapped_folder_key: 'wrap',
        key_version: 1,
        cap_bytes: null,
        cap_used_bytes: 0,
      })
    const result = await resolveFolderLink('tok')
    expect(result.kind).toBe('ok')
  })
})

describe('listFolderItems (2237b)', () => {
  test('sends parent_id and the default limit, and no proof header without a proof', async () => {
    next = () => Response.json({ items: [], next_cursor: null })
    await listFolderItems('tok', { parentId: null })
    expect(calls[0].url).toContain('/api/v1/f/tok/items?parent_id=&limit=200')
    expect(headersOf()['x-folder-link-proof']).toBeUndefined()
  })

  test('attaches x-folder-link-proof when a proof is given', async () => {
    next = () => Response.json({ items: [], next_cursor: null })
    const proof = storeProof('tok', 'p1', new Date(Date.now() + 60_000).toISOString())
    await listFolderItems('tok', { parentId: 'p1' }, proof)
    expect(headersOf()['x-folder-link-proof']).toBe('p1')
    expect(calls[0].url).toContain('parent_id=p1')
  })

  test('rejects limit 501 client-side before any fetch', async () => {
    await expect(
      listFolderItems('tok', { parentId: null, limit: 501 }),
    ).rejects.toThrow('limit must be between 1 and 500')
    expect(calls.length).toBe(0)
  })
})

describe('proof storage (2237b)', () => {
  test('an expired proof reads as null', () => {
    storeProof('t', 'p', new Date(Date.now() - 1_000).toISOString())
    expect(readProof('t')).toBeNull()
  })

  test('a live proof is stored in sessionStorage under the documented key', () => {
    const proof = storeProof('t', 'p', new Date(Date.now() + 60_000).toISOString())
    expect(readProof('t')).toEqual(proof)
    expect(store.has('beebeeb.folderLink.proof.t')).toBe(true)
    clearProof('t')
    expect(readProof('t')).toBeNull()
  })
})
