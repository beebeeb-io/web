/**
 * Task 1948 (1c + 2) — a stale login of an account that is no longer active, and
 * the honest copy for a refused trial at signup.
 *
 * 1c (Guus, 2026-10-17): on `403 account_suspended` the web clears the login on
 *    this device (no server call: /auth/logout would answer the same 403), public
 *    pages say ACCOUNT_INACTIVE_NOTICE, signed-in pages show a screen with Sign out
 *    and support@beebeeb.io, and nothing ever says WHY the account is not active.
 * 2  (Guus, 2026-10-17): `trial_already_used` reads TRIAL_INBOX_COPY, identical
 *    whether or not the earlier trial was this person's.
 *
 * The copy is pinned as literals here (not imported) so a changed sentence fails.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const NOTICE = 'You were signed in to an account that is no longer active, so we signed you out on this device.'
const TRIAL_INBOX_COPY =
  'This email inbox has already had a free trial, so this account starts without one. You can pick a plan now.'

// ── request(): the central handler ─────────────────────────────────────────
let mockToken: string | null = null
await mockModuleScoped('../packages/shared/src/api/token', import.meta.dir, {
  getToken: () => mockToken,
  clearToken: () => {
    mockToken = null
  },
  setToken: (t: string) => {
    mockToken = t
  },
  setTokenStorageKey: () => {},
  registerOnTokenCleared: () => {},
})

let response: { status: number; body: unknown } = { status: 200, body: {} }
const originalFetch = globalThis.fetch
const mockFetch = (async () =>
  new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch

const shared = await import('../packages/shared/src/api/index')
const { request, setApiUrl, markSessionConfirmed, clearSessionConfirmed, registerSessionExpiredHandler, registerAccountDeletedHandler } = shared
const registerAccountSuspendedHandler = (shared as Record<string, unknown>).registerAccountSuspendedHandler as
  | ((fn: (() => void) | null) => void)
  | undefined

setApiUrl('http://test.local')
let suspendedFired = 0
let expiredFired = 0
let deletedFired = 0

beforeAll(() => {
  globalThis.fetch = mockFetch
  registerSessionExpiredHandler(() => {
    expiredFired++
  })
  registerAccountDeletedHandler(() => {
    deletedFired++
  })
})
afterAll(() => {
  globalThis.fetch = originalFetch
  registerAccountSuspendedHandler?.(null)
  mock.restore()
})

describe('request() 403 account_suspended → central sign-out handler', () => {
  beforeEach(() => {
    suspendedFired = 0
    expiredFired = 0
    deletedFired = 0
    mockToken = null
    clearSessionConfirmed()
    response = { status: 200, body: {} }
    expect(typeof registerAccountSuspendedHandler).toBe('function')
    registerAccountSuspendedHandler!(() => {
      suspendedFired++
    })
  })

  test('fires from any endpoint, clears the legacy token, throws the typed error', async () => {
    mockToken = 'legacy-token-of-a-disabled-account'
    response = { status: 403, body: { error: 'account_suspended' } }
    let caught: unknown
    try {
      await request('/api/v1/files')
    } catch (err) {
      caught = err
    }
    expect(suspendedFired).toBe(1)
    expect(mockToken).toBeNull()
    expect((caught as { code?: string }).code).toBe('account_suspended')
    expect((caught as { status?: number }).status).toBe(403)
  })

  test('forgets the confirmed session: a later anonymous 401 is not "session expired"', async () => {
    markSessionConfirmed()
    response = { status: 403, body: { error: 'account_suspended' } }
    await expect(request('/api/v1/auth/me')).rejects.toThrow()
    response = { status: 401, body: { error: 'unauthorized' } }
    await expect(request('/api/v1/auth/me')).rejects.toThrow()
    expect(expiredFired).toBe(0)
  })

  test('an unrelated 403 and account_deleted do not fire it', async () => {
    response = { status: 403, body: { error: 'confirmation_required', message: 'nope' } }
    await expect(request('/api/v1/auth/account')).rejects.toThrow()
    response = {
      status: 403,
      body: { error: 'account_deleted', message: 'x', deleted_at: '2026-09-01T00:00:00Z', shred_after: '2026-10-01T00:00:00Z' },
    }
    await expect(request('/api/v1/auth/me')).rejects.toThrow()
    expect(suspendedFired).toBe(0)
    expect(deletedFired).toBe(1)
  })
})

// ── copy ────────────────────────────────────────────────────────────────────
const { ApiError } = await import('../src/lib/api')
const { userFriendlyError } = await import('../src/lib/user-friendly-error')
const { startTrialErrorCopy, trialUnavailableCopy } = await import('../src/lib/no-card-trial')

describe('copy', () => {
  test('userFriendlyError(account_suspended) is the notice, never the generic 403 line', () => {
    const msg = userFriendlyError(new ApiError('Forbidden', 403, 'account_suspended'))
    expect(msg).toBe(NOTICE)
    expect(msg).not.toBe("You don't have permission to do that.")
  })

  test('a refused trial (trial_already_used) reads the inbox copy, with and without an allowance', () => {
    const err = new ApiError('You have already used your free trial on this account.', 409, 'trial_already_used')
    expect(startTrialErrorCopy(err)).toBe(TRIAL_INBOX_COPY)
    expect(startTrialErrorCopy(err, 3_000_000)).toBe(TRIAL_INBOX_COPY)
    expect(userFriendlyError(err)).toBe(TRIAL_INBOX_COPY)
  })

  test('the trial step for a second account of the same inbox: the document says already_used, the copy is the same', () => {
    // With an entry allowance on (task 1742), the allowance is one per inbox too, so the
    // document already answers `unavailable_reason: "already_used"` for the second
    // account and no start button is drawn (seen on the real stack, run 1 of
    // e2e/1948-stale-session.spec.ts). Same server answer for "this account" and
    // "another account on this inbox", so the same words.
    expect(trialUnavailableCopy('already_used')).toBe(TRIAL_INBOX_COPY)
    expect(trialUnavailableCopy('already_used', 3_000_000)).toBe(TRIAL_INBOX_COPY)
  })
})

// ── the local sign-out + the two surfaces ──────────────────────────────────
const inactive = await import('../src/lib/account-inactive')

describe('signOutInactiveLocally', () => {
  beforeEach(() => inactive.clearSignedOutInactive())

  test('runs every local cleanup step, marks the page load, and calls no server', async () => {
    const calls: string[] = []
    const fetchBefore = globalThis.fetch
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches++
      return new Response('{}')
    }) as unknown as typeof fetch
    try {
      await inactive.signOutInactiveLocally({
        clearToken: () => calls.push('token'),
        clearSessionConfirmed: () => calls.push('confirmed'),
        clearAccountLocalState: () => calls.push('local'),
        logoutCleanup: async () => {
          calls.push('keys')
        },
        clearUser: () => calls.push('user'),
      })
    } finally {
      globalThis.fetch = fetchBefore
    }
    expect(calls).toEqual(['token', 'confirmed', 'local', 'keys', 'user'])
    expect(fetches).toBe(0)
    expect(inactive.isSignedOutInactive()).toBe(true)
  })

  test('a failing key cleanup still clears the user and keeps the mark', async () => {
    let cleared = false
    await inactive.signOutInactiveLocally({
      clearToken: () => {},
      clearSessionConfirmed: () => {},
      clearAccountLocalState: () => {},
      logoutCleanup: async () => {
        throw new Error('IndexedDB unavailable')
      },
      clearUser: () => {
        cleared = true
      },
    })
    expect(cleared).toBe(true)
    expect(inactive.isSignedOutInactive()).toBe(true)
  })

  test('ProtectedRoute: a signed-out page load goes to the inactive screen only after this handler', () => {
    expect(inactive.signedOutDestination(true)).toBe('account_inactive')
    expect(inactive.signedOutDestination(false)).toBe('login')
  })
})

const { SignedOutInactiveNotice, AccountInactiveScreen } = await import('../src/components/account-inactive')
const { MemoryRouter } = await import('react-router-dom')

describe('surfaces', () => {
  beforeEach(() => inactive.clearSignedOutInactive())

  test('public pages: the notice renders the exact sentence once marked, nothing before', () => {
    expect(renderToStaticMarkup(<SignedOutInactiveNotice />)).toBe('')
    inactive.markSignedOutInactive()
    const html = renderToStaticMarkup(<SignedOutInactiveNotice />)
    expect(html).toContain(NOTICE)
    expect(html).toContain('data-testid="account-inactive-notice"')
  })

  test('signed-in pages: not active, Sign out, support@beebeeb.io, and no reason', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AccountInactiveScreen />
      </MemoryRouter>,
    )
    expect(html).toContain('data-testid="account-inactive-screen"')
    expect(html).toContain('This account is not active')
    expect(html).toContain('Sign out')
    expect(html).toContain('mailto:support@beebeeb.io')
    for (const why of [/suspend/i, /disabl/i, /ban/i, /abuse/i, /violat/i, /deleted/i, /fraud/i]) {
      expect(html).not.toMatch(why)
    }
  })
})

// ── a refusal only signs out the login it was issued under (web#169 review, Codex P1) ──
//
// The scenario: a request of the suspended account A is already on the wire when a
// login to an ACTIVE account B completes (in this tab, or in another tab on the same
// cookie jar). Its 403 arrives late. Before this round, `request()` fired the handler
// unqualified and every tab ran the full local sign-out, incl. KeyProvider's
// fullLogout (which deletes the local vault): B was signed out and B's vault deleted.
const notifiers = await import('../packages/shared/src/api/notifiers')
type Stamp = { generation: number; userId: string | null }

/** A fetch whose answer the test releases after the request has been ISSUED. */
function deferredFetch() {
  let release!: (r: { status: number; body: unknown }) => void
  const answer = new Promise<{ status: number; body: unknown }>((r) => {
    release = r
  })
  let issued = 0
  const fn = (async () => {
    issued++
    const a = await answer
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fn, release, issued: () => issued }
}

/** One "tab": a guard with spy deps, connected to the others by a real BroadcastChannel. */
function makeTab(name: string, currentUserId: () => string | null) {
  const counts = { fullLogout: 0, clearUser: 0, clearToken: 0, received: 0 }
  const channel = new BroadcastChannel('beebeeb-auth-1948-test')
  const guard = inactive.createInactiveLoginGuard({
    currentUserId,
    broadcast: (msg) => channel.postMessage(msg),
    signOutDeps: {
      clearToken: () => counts.clearToken++,
      clearSessionConfirmed: () => {},
      clearAccountLocalState: () => {},
      logoutCleanup: async () => {
        counts.fullLogout++ // KeyProvider fullLogout: zero the key + clearVault()
      },
      clearUser: () => counts.clearUser++,
    },
  })
  const outcomes: string[] = []
  channel.onmessage = (e: MessageEvent) => {
    counts.received++
    void guard.onBroadcast(e.data).then((o) => outcomes.push(o))
  }
  return { name, guard, counts, outcomes, close: () => channel.close() }
}

/** Lets BroadcastChannel deliveries and their async handlers settle. */
const settle = () => new Promise((r) => setTimeout(r, 30))

describe('a late account_suspended only signs out the login it was issued under', () => {
  let tabs: Array<{ close: () => void }> = []
  beforeEach(() => {
    inactive.clearSignedOutInactive()
    mockToken = null
    clearSessionConfirmed()
    notifiers.setAuthIdentity(null)
  })
  afterAll(() => {
    for (const t of tabs) t.close()
    globalThis.fetch = mockFetch
    registerAccountSuspendedHandler?.(null)
  })

  test('request(): the handler gets the stamp from ISSUE time; a login in between makes it stale and keeps the new session', async () => {
    const d = deferredFetch()
    globalThis.fetch = d.fn
    const seen: Stamp[] = []
    ;(registerAccountSuspendedHandler as unknown as (fn: (s: Stamp) => void) => void)((s) => seen.push(s))
    notifiers.setAuthIdentity('user-A')
    mockToken = 'legacy-token-of-A'
    const p = request('/api/v1/files').catch((e) => e)
    expect(d.issued()).toBe(1)
    // Login B completes while A's request is still waiting for its answer.
    notifiers.bumpAuthGeneration()
    notifiers.setAuthIdentity('user-B')
    markSessionConfirmed()
    mockToken = 'token-B'
    d.release({ status: 403, body: { error: 'account_suspended' } })
    const err = (await p) as { code?: string }
    globalThis.fetch = mockFetch
    expect(err.code).toBe('account_suspended')
    expect(seen.length).toBe(1)
    expect(seen[0].userId).toBe('user-A')
    expect(notifiers.isCurrentAuthStamp(seen[0])).toBe(false)
    // B's session survives the late refusal of A's request.
    expect(mockToken).toBe('token-B')
    expect(notifiers.wasSessionConfirmed()).toBe(true)
  })

  test('same tab: A request answered 403 after login B → B is NOT signed out, fullLogout NOT called, nothing broadcast', async () => {
    let current: string | null = 'user-A'
    const tab = makeTab('X', () => current)
    const other = makeTab('Y', () => 'user-A') // would act on any broadcast for A
    tabs.push(tab, other)
    ;(registerAccountSuspendedHandler as unknown as (fn: (s: Stamp) => void) => void)((s) => {
      void tab.guard.onSuspended(s).then((o) => tab.outcomes.push(o))
    })
    const d = deferredFetch()
    globalThis.fetch = d.fn
    notifiers.setAuthIdentity('user-A')
    const p = request('/api/v1/files').catch((e) => e)
    // Login B in this tab.
    notifiers.bumpAuthGeneration()
    notifiers.setAuthIdentity('user-B')
    current = 'user-B'
    d.release({ status: 403, body: { error: 'account_suspended' } })
    await p
    globalThis.fetch = mockFetch
    await settle()
    expect(tab.outcomes).toEqual(['ignored'])
    expect(tab.counts.fullLogout).toBe(0)
    expect(tab.counts.clearUser).toBe(0)
    expect(inactive.isSignedOutInactive()).toBe(false)
    expect(other.counts.received).toBe(0)
    expect(other.counts.fullLogout).toBe(0)
  })

  test('cross-tab: tab X (A) broadcasts for A; tab Y, now signed in as B, ignores it (no sign-out, no fullLogout)', async () => {
    const x = makeTab('X', () => 'user-A')
    const y = makeTab('Y', () => 'user-B')
    tabs.push(x, y)
    ;(registerAccountSuspendedHandler as unknown as (fn: (s: Stamp) => void) => void)((s) => {
      void x.guard.onSuspended(s).then((o) => x.outcomes.push(o))
    })
    notifiers.setAuthIdentity('user-A')
    response = { status: 403, body: { error: 'account_suspended' } }
    await request('/api/v1/files').catch(() => {})
    await settle()
    // X's own login really is dead: X signs itself out (correct).
    expect(x.outcomes).toEqual(['signed_out'])
    expect(x.counts.fullLogout).toBe(1)
    // Y got the message and did nothing to B.
    expect(y.counts.received).toBe(1)
    expect(y.outcomes).toEqual(['ignored'])
    expect(y.counts.fullLogout).toBe(0)
    expect(y.counts.clearUser).toBe(0)
  })

  test('cross-tab: a broadcast without an account (unknown sender login, older bundle) is ignored', async () => {
    const y = makeTab('Y', () => 'user-B')
    const sender = new BroadcastChannel('beebeeb-auth-1948-test')
    tabs.push(y, { close: () => sender.close() })
    sender.postMessage({ type: 'account_inactive' })
    sender.postMessage({ type: 'account_inactive', userId: null })
    await settle()
    expect(y.counts.received).toBe(2)
    expect(y.outcomes).toEqual(['ignored', 'ignored'])
    expect(y.counts.fullLogout).toBe(0)
  })

  test('no regression: a matching refusal signs out here AND in a tab signed in as the same account', async () => {
    const x = makeTab('X', () => 'user-A')
    const y = makeTab('Y', () => 'user-A')
    tabs.push(x, y)
    ;(registerAccountSuspendedHandler as unknown as (fn: (s: Stamp) => void) => void)((s) => {
      void x.guard.onSuspended(s).then((o) => x.outcomes.push(o))
    })
    notifiers.setAuthIdentity('user-A')
    mockToken = 'legacy-token-of-A'
    response = { status: 403, body: { error: 'account_suspended' } }
    await request('/api/v1/files').catch(() => {})
    await settle()
    expect(mockToken).toBeNull()
    expect(x.outcomes).toEqual(['signed_out'])
    expect(x.counts.fullLogout).toBe(1)
    expect(y.outcomes).toEqual(['signed_out'])
    expect(y.counts.fullLogout).toBe(1)
    expect(inactive.isSignedOutInactive()).toBe(true)
  })

  test('two refusals of the same dead login: one sign-out, the second is stale', async () => {
    const x = makeTab('X', () => null)
    tabs.push(x)
    ;(registerAccountSuspendedHandler as unknown as (fn: (s: Stamp) => void) => void)((s) => {
      void x.guard.onSuspended(s).then((o) => x.outcomes.push(o))
    })
    // Boot: the tab does not know the account yet (getMe itself is refused).
    const d1 = deferredFetch()
    globalThis.fetch = d1.fn
    const p1 = request('/api/v1/auth/me').catch(() => {})
    const p2 = request('/api/v1/onboarding').catch(() => {})
    d1.release({ status: 403, body: { error: 'account_suspended' } })
    await Promise.all([p1, p2])
    globalThis.fetch = mockFetch
    await settle()
    expect(x.outcomes.sort()).toEqual(['ignored', 'signed_out'])
    expect(x.counts.fullLogout).toBe(1)
  })
})
