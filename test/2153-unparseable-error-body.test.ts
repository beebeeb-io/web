import { afterEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

/**
 * Task 2153: an empty or non-JSON error body (a bare 403, a proxy's HTML 502) must give an
 * ApiError with NO code. The old fallback turned it into code === 'Server returned an invalid
 * response', which code that branches on `code` then mistook for a real server answer.
 */
await mockModuleScoped('../packages/shared/src/api/token', import.meta.dir, {
  getToken: () => null,
  clearToken: () => {},
  setToken: () => {},
  setTokenStorageKey: () => {},
  registerOnTokenCleared: () => {},
})

const { request, setApiUrl, ApiError, registerAccountDeletedHandler } = await import(
  '../packages/shared/src/api/index'
)
const { getInvitePreview } = await import('../src/lib/api')

setApiUrl('http://test.local')

const originalFetch = globalThis.fetch
function stubFetch(status: number, body: string, statusText = '') {
  globalThis.fetch = (async () =>
    new Response(body, { status, statusText })) as unknown as typeof fetch
}
afterEach(() => {
  globalThis.fetch = originalFetch
})

async function rejection(p: Promise<unknown>): Promise<InstanceType<typeof ApiError>> {
  try {
    await p
  } catch (e) {
    return e as InstanceType<typeof ApiError>
  }
  throw new Error('expected the call to reject')
}

describe('shared request() with an unusable error body (2153)', () => {
  test('403 with an empty body: no code, status kept, message names the status', async () => {
    stubFetch(403, '')
    const err = await rejection(request('/api/v1/x'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBeUndefined()
    expect(err.status).toBe(403)
    expect(err.message).toContain('403')
  })

  test('502 with an HTML body: no code, status kept, message names the status', async () => {
    stubFetch(502, '<html><body><h1>502 Bad Gateway</h1></body></html>')
    const err = await rejection(request('/api/v1/x'))
    expect(err.code).toBeUndefined()
    expect(err.status).toBe(502)
    expect(err.message).toContain('502')
    expect(err.message).not.toContain('<html')
  })

  test('JSON that is not an object (a bare string) has no code either', async () => {
    stubFetch(500, '"boom"')
    const err = await rejection(request('/api/v1/x'))
    expect(err.code).toBeUndefined()
    expect(err.message).toContain('500')
  })

  test('a JSON account_deleted 403 still fires the account-deleted path with the body', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerAccountDeletedHandler((body: Record<string, unknown>) => {
      seen.push(body)
    })
    stubFetch(
      403,
      JSON.stringify({ error: 'account_deleted', message: 'Gone.', deleted_at: '2026-10-01' }),
    )
    const err = await rejection(request('/api/v1/x'))
    expect(err.code).toBe('account_deleted')
    expect(err.message).toBe('Gone.')
    expect(seen.length).toBe(1)
    expect(seen[0].deleted_at).toBe('2026-10-01')
  })
})

describe('src/lib/api.ts local copy (2153)', () => {
  test('getInvitePreview: a 404 with an empty body names the status, no fake message', async () => {
    stubFetch(404, '')
    const err = await rejection(getInvitePreview('tok'))
    expect(err.status).toBe(404)
    expect(err.message).toContain('404')
    expect(err.message).not.toContain('invalid response')
  })
})
