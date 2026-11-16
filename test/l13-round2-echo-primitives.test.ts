/**
 * SF-0001 L13 round 2 — E5 (part 1): the echo check lives in the request
 * primitives, so every caller is covered once.
 *
 * `createFolder`, `initUpload` and `completeUpload` already receive the id the
 * client proposed. They compare it with the answer themselves; no caller can
 * forget. A completion answer names an item that may already hold the upload,
 * so its message says so.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

await mockModuleScoped('../packages/shared/src/api/token', import.meta.dir, {
  getToken: () => 'token',
  clearToken: () => {},
  setToken: () => {},
  setTokenStorageKey: () => {},
  registerOnTokenCleared: () => {},
})

const { setApiUrl } = await import('../packages/shared/src/api/index')
const { createFolder, initUpload, completeUpload } = await import('../src/lib/api')
const {
  SERVER_CHANGED_ITEM_ID_MESSAGE,
  SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE,
  ServerChangedItemIdError,
} = await import('../src/lib/item-id-echo')

setApiUrl('http://test.local')

const originalFetch = globalThis.fetch
const seen: string[] = []

function stubJson(body: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input))
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  seen.length = 0
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(() => null, (e: unknown) => e)
}

const DRIVE_FILE = {
  name_encrypted: 'sealed',
  mime_type: null,
  size_bytes: 0,
  chunk_count: 0,
  is_folder: false,
  is_uploading: false,
  created_at: '2026-05-08T00:00:00.000Z',
  updated_at: '2026-05-08T00:00:00.000Z',
}

describe('E5: createFolder asserts the echoed id', () => {
  test('another id aborts with the typed error, nothing usable returned', async () => {
    stubJson({ ...DRIVE_FILE, id: 'server-chosen-id', is_folder: true })
    const err = await caught(() => createFolder('sealed', 'parent-1', 'my-folder-id'))
    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_MESSAGE)
    expect(seen.length).toBe(1)
  })

  test('the same id is accepted', async () => {
    stubJson({ ...DRIVE_FILE, id: 'my-folder-id', is_folder: true })
    const created = await createFolder('sealed', 'parent-1', 'my-folder-id')
    expect(created.id).toBe('my-folder-id')
  })
})

describe('E5: initUpload asserts the echoed id (both protocols)', () => {
  const metadata = {
    file_id: 'my-file-id',
    name_encrypted: 'sealed',
    size_bytes: 4,
    chunk_count: 1,
  }

  test('v2 answering another id aborts', async () => {
    stubJson({
      file_id: 'server-chosen-id', tenant_id: 't', object_version_id: 'o', upload_session_id: 's',
      chunk_size_bytes: 4, chunk_count: 1, storage_format_version: 2, storage_pool_id: 'p', region: 'Europe',
    })
    const err = await caught(() => initUpload(metadata))
    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_MESSAGE)
  })

  test('v2 echoing the proposed id is accepted', async () => {
    stubJson({
      file_id: 'my-file-id', tenant_id: 't', object_version_id: 'o', upload_session_id: 's',
      chunk_size_bytes: 4, chunk_count: 1, storage_format_version: 2, storage_pool_id: 'p', region: 'Europe',
    })
    const init = await initUpload(metadata)
    expect(init.file_id).toBe('my-file-id')
  })

  test('v1 answering another id aborts too', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes('/uploads/init')) {
        return new Response('{}', { status: 404 })
      }
      return new Response(JSON.stringify({ file_id: 'server-chosen-id', chunk_count: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const err = await caught(() => initUpload(metadata))
    expect(err).toBeInstanceOf(ServerChangedItemIdError)
  })
})

describe('E5: completeUpload asserts the echoed id with honest copy', () => {
  test('another id aborts and says the upload may exist on the server', async () => {
    stubJson({ ...DRIVE_FILE, id: 'server-chosen-id' })
    const err = await caught(() => completeUpload('my-file-id', 'session-1'))
    expect(err).toBeInstanceOf(ServerChangedItemIdError)
    expect((err as Error).message).toBe(SERVER_CHANGED_ITEM_ID_AFTER_UPLOAD_MESSAGE)
    expect((err as Error).message).toContain('may exist on the server')
  })

  test('the same id is accepted', async () => {
    stubJson({ ...DRIVE_FILE, id: 'my-file-id' })
    const done = await completeUpload('my-file-id', 'session-1')
    expect(done.id).toBe('my-file-id')
  })
})
