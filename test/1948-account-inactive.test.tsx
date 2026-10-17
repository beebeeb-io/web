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
