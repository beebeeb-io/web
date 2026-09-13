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
  registerAccountDeletedHandler,
  markSessionConfirmed,
  clearSessionConfirmed,
  setApiUrl,
} = await import('../packages/shared/src/api/index')

setApiUrl('http://test.local')
let fired = 0
registerSessionExpiredHandler(() => {
  fired++
})
let accountDeletedBodies: Record<string, unknown>[] = []
registerAccountDeletedHandler((body) => {
  accountDeletedBodies.push(body)
})

// File-level (not per-describe): both describe blocks below need the fetch
// mock live. A per-describe beforeAll/afterAll pair works fine for a single
// describe, but a SECOND describe in the same file starts running only
// AFTER the first one's afterAll already restored globalThis.fetch to the
// real implementation — its tests would then hit a real network call
// against http://test.local and hang until bun's per-test timeout, which is
// exactly what happened here before this was hoisted (every
// account_deleted-handler test below timed out at 5000ms with 0 bodies
// received, not because the handler was broken, but because the mock fetch
// was already gone by the time those tests ran).
beforeAll(() => {
  globalThis.fetch = mockFetch
})
afterAll(() => {
  globalThis.fetch = originalFetch
  mock.restore()
})

describe('request() 401 → session-expiry gate (0741)', () => {
  beforeEach(() => {
    fired = 0
    accountDeletedBodies = []
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

/**
 * Task 1404 — Codex review (PR #33) findings on the original implementation:
 *
 *   1. "Handle deletion after the initial boot request" — account_deleted
 *      handling lived ONLY in auth-context.tsx's mount-only boot(), so a tab
 *      already open when the account got deleted elsewhere (another device,
 *      or a second tab's delete-account flow) never saw the honest copy on
 *      its LATER authenticated calls.
 *   2. "Read the legacy token before clearing it" — boot()'s own re-fetch
 *      hack cleared the token, then tried to re-read it to build a second
 *      request's Authorization header, losing the dates for a legacy-
 *      bearer-token session.
 *
 * The fix moves account_deleted handling into request() itself, mirroring
 * the 401 session-expiry gate above: ANY call through request() that gets
 * the 403 fires a central notifier with the full parsed body — token-
 * clearing order doesn't matter to it, because the body is a local
 * variable, never re-derived from the (now possibly-cleared) token. Reuses
 * this file's mock.module registration for `./token` rather than a separate
 * test file registering its own (bun's mock.module is process-global —
 * "last one wins" would silently disconnect whichever file's mockToken
 * variable from what request() actually uses; see upload-share-mocks.ts's
 * header comment for the same gotcha elsewhere in this suite).
 */
describe('request() 403 account_deleted → central handler (task 1404)', () => {
  const ACCOUNT_DELETED_BODY = {
    error: 'account_deleted',
    message: 'This account was deleted and is scheduled for permanent erasure.',
    deleted_at: '2026-09-01T00:00:00Z',
    shred_after: '2026-10-01T00:00:00Z',
  }

  beforeEach(() => {
    fired = 0
    accountDeletedBodies = []
    mockToken = null
    clearSessionConfirmed()
    response = { status: 200, body: {} }
  })

  test('fires from an ARBITRARY endpoint, not just getMe() — proves centralization (finding 1)', async () => {
    response = { status: 403, body: ACCOUNT_DELETED_BODY }
    // Any authenticated path — a sync poll, a file listing, whatever a tab
    // that was already open happens to call next. Not /auth/me.
    await expect(request('/api/v1/sync/ops')).rejects.toThrow()
    expect(accountDeletedBodies.length).toBe(1)
    expect(accountDeletedBodies[0].deleted_at).toBe('2026-09-01T00:00:00Z')
    expect(accountDeletedBodies[0].shred_after).toBe('2026-10-01T00:00:00Z')
  })

  test('a legacy bearer token is cleared but the handler still gets both dates (finding 2)', async () => {
    mockToken = 'legacy-token'
    response = { status: 403, body: ACCOUNT_DELETED_BODY }
    await expect(request('/api/v1/auth/me')).rejects.toThrow()
    // Ordering bug (finding 2): the old boot() code cleared the token FIRST,
    // then tried to re-read it to build a second request's Authorization
    // header — losing the dates for a legacy-token session. The fix carries
    // the body as a local variable, never re-derived from the token, so
    // clearing it first changes nothing about what the handler receives.
    expect(mockToken).toBeNull() // token WAS cleared…
    expect(accountDeletedBodies.length).toBe(1)
    expect(accountDeletedBodies[0].deleted_at).toBe('2026-09-01T00:00:00Z') // …but the dates survived
    expect(accountDeletedBodies[0].shred_after).toBe('2026-10-01T00:00:00Z')
  })

  test('an UNRELATED 403 does not fire the account_deleted handler', async () => {
    response = { status: 403, body: { error: 'confirmation_required', message: 'nope' } }
    await expect(request('/api/v1/auth/account')).rejects.toThrow()
    expect(accountDeletedBodies.length).toBe(0)
  })

  test('a 401 does not fire the account_deleted handler (distinct from session expiry)', async () => {
    response = { status: 401, body: { error: 'unauthorized' } }
    await expect(request('/api/v1/auth/me')).rejects.toThrow()
    expect(accountDeletedBodies.length).toBe(0)
  })
})
