import { describe, expect, test, beforeEach, beforeAll, afterAll, mock } from 'bun:test'

// Mock the token module so request() doesn't touch localStorage and we control
// the bearer-token signal directly.
let mockToken: string | null = null
mock.module('../packages/shared/src/api/token', () => ({
  getToken: () => mockToken,
  clearToken: () => {
    mockToken = null
  },
  setToken: (t: string) => {
    mockToken = t
  },
  setTokenStorageKey: () => {},
  registerOnTokenCleared: () => {},
}))

// Stub fetch to return a controllable response — installed in beforeAll and
// RESTORED in afterAll so it never leaks into other test files (bun shares
// globals across files in one run).
let response: { status: number; body: unknown } = { status: 401, body: { error: 'unauthorized' } }
const originalFetch = globalThis.fetch
const mockFetch = (async () =>
  new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch

const {
  request,
  registerSessionExpiredHandler,
  markSessionConfirmed,
  clearSessionConfirmed,
  setApiUrl,
} = await import('../packages/shared/src/api/index')

setApiUrl('http://test.local')
let fired = 0
registerSessionExpiredHandler(() => {
  fired++
})

describe('request() 401 → session-expiry gate (0741)', () => {
  beforeAll(() => {
    globalThis.fetch = mockFetch
  })
  afterAll(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })
  beforeEach(() => {
    fired = 0
    mockToken = null
    clearSessionConfirmed()
    response = { status: 401, body: { error: 'unauthorized' } }
  })

  test('anonymous 401 (no token, no confirmed session) does NOT fire session-expired', async () => {
    await expect(request('/api/v1/auth/me')).rejects.toThrow()
    expect(fired).toBe(0) // the bug: pre-fix this was 1 (unconditional bounce)
  })

  test('401 after a confirmed session DOES fire session-expired (expiry preserved)', async () => {
    markSessionConfirmed()
    await expect(request('/api/v1/auth/me')).rejects.toThrow()
    expect(fired).toBe(1)
  })

  test('401 with a bearer token DOES fire session-expired (legacy expiry preserved)', async () => {
    mockToken = 'legacy-token'
    await expect(request('/api/v1/auth/me')).rejects.toThrow()
    expect(fired).toBe(1)
  })
})
