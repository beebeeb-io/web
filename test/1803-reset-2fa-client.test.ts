import { describe, expect, test, afterEach } from 'bun:test'

/**
 * Task 1803 — client half of "a reset ends at the 2FA challenge" (server 1730).
 *
 * Asserted at the HTTP level (what actually leaves the browser, and what the
 * client does with each answer), same pattern as test/1704-set-password-page:
 * no React rendering exists in this suite, so the page flows themselves are
 * proven in the browser (e2e/1803-reset-2fa.spec.ts).
 */

interface CapturedCall {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function capturingFetch(
  calls: CapturedCall[],
  responder: (url: string) => { status: number; body: unknown },
) {
  return (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : {},
    })
    const { status, body } = responder(String(url))
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const originalFetch = globalThis.fetch

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}
;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()

afterEach(() => {
  globalThis.fetch = originalFetch
  ;(globalThis.localStorage as unknown as MemoryStorage).clear()
})

const UID = '11111111-1111-1111-1111-111111111111'
const CHALLENGE = { user_id: UID, email: 'user@example.com', requires_2fa: true, partial_token: 'partial-abc' }
const SESSION = { user_id: UID, email: 'user@example.com', session_token: 'fresh-session' }

function headerOf(call: CapturedCall, name: string): string | undefined {
  const k = Object.keys(call.headers).find((h) => h.toLowerCase() === name.toLowerCase())
  return k ? call.headers[k] : undefined
}

describe('reset finalizers declare the reset-2fa capability (task 1803)', () => {
  test('setPasswordFinalize sends X-Beebeeb-Capabilities: reset-2fa', async () => {
    const { setPasswordFinalize } = await import('../src/lib/api')
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({ status: 200, body: SESSION }))
    await setPasswordFinalize('tok', 'upload')
    expect(calls.length).toBe(1)
    expect(headerOf(calls[0], 'X-Beebeeb-Capabilities')).toBe('reset-2fa')
    // The capability header is not a body field and nothing else leaked in.
    expect(Object.keys(calls[0].body).sort()).toEqual(['opaque_registration', 'token'])
  })

  test('recoverWithPhraseFinalize sends X-Beebeeb-Capabilities: reset-2fa', async () => {
    const { recoverWithPhraseFinalize } = await import('../src/lib/api')
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({ status: 200, body: { user_id: UID, session_token: 's' } }))
    await recoverWithPhraseFinalize('rec', 'upload', 'check', 'pub')
    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/recover-with-phrase-finalize')
    expect(headerOf(calls[0], 'X-Beebeeb-Capabilities')).toBe('reset-2fa')
  })
})

describe('a requires_2fa answer opens NO session on the client (task 1803)', () => {
  test('setPasswordFinalize: challenge is returned, no bearer is stored', async () => {
    const { setPasswordFinalize } = await import('../src/lib/api')
    globalThis.fetch = capturingFetch([], () => ({ status: 200, body: CHALLENGE }))
    const res = await setPasswordFinalize('tok', 'upload')
    expect(res.requires_2fa).toBe(true)
    expect(res.requires_2fa && res.partial_token).toBe('partial-abc')
    expect(localStorage.getItem('bb_session')).toBe(null)
  })

  test('recoverWithPhraseFinalize: challenge is returned, no bearer is stored', async () => {
    const { recoverWithPhraseFinalize } = await import('../src/lib/api')
    globalThis.fetch = capturingFetch([], () => ({
      status: 200,
      body: { user_id: UID, requires_2fa: true, partial_token: 'partial-xyz' },
    }))
    const res = await recoverWithPhraseFinalize('rec', 'upload', 'check', 'pub')
    expect(res.requires_2fa).toBe(true)
    expect(res.requires_2fa && res.partial_token).toBe('partial-xyz')
    expect(localStorage.getItem('bb_session')).toBe(null)
  })

  test('without 2FA the session path is unchanged: bearer + email stored', async () => {
    const { setPasswordFinalize } = await import('../src/lib/api')
    globalThis.fetch = capturingFetch([], () => ({ status: 200, body: SESSION }))
    const res = await setPasswordFinalize('tok', 'upload')
    expect(res.requires_2fa).toBeFalsy()
    expect(res.session_token).toBe('fresh-session')
    expect(localStorage.getItem('bb_email')).toBe('user@example.com')
  })
})

describe('409 password_set_sign_in_required (task 1803)', () => {
  const body409 = {
    error: 'password_set_sign_in_required',
    message: 'Your password was changed. Sign in with your new password and your authentication code.',
  }

  test('surfaces as a typed ApiError that isPasswordSetSignInRequired recognises, and stores no session', async () => {
    const { setPasswordFinalize } = await import('../src/lib/api')
    const { isPasswordSetSignInRequired } = await import('../src/lib/reset-2fa')
    globalThis.fetch = capturingFetch([], () => ({ status: 409, body: body409 }))
    let caught: unknown = null
    try {
      await setPasswordFinalize('tok', 'upload')
    } catch (e) {
      caught = e
    }
    expect(isPasswordSetSignInRequired(caught)).toBe(true)
    expect(localStorage.getItem('bb_session')).toBe(null)
  })

  test('other errors are not mistaken for it', async () => {
    const { isPasswordSetSignInRequired } = await import('../src/lib/reset-2fa')
    const { ApiError } = await import('../src/lib/api')
    expect(isPasswordSetSignInRequired(new ApiError('x', 409, 'something_else'))).toBe(false)
    expect(isPasswordSetSignInRequired(new ApiError('x', 400))).toBe(false)
    expect(isPasswordSetSignInRequired(new Error('password_set_sign_in_required'))).toBe(false)
  })

  test('describeSetPasswordError never calls the link invalid once the password is set', async () => {
    const { describeSetPasswordError } = await import('../src/pages/set-password')
    const { ApiError } = await import('../src/lib/api')
    const msg = describeSetPasswordError(new ApiError('x', 409, 'password_set_sign_in_required'))
    expect(msg).toBe('Your new password is set. Sign in to continue.')
  })

  test('closed-code-step copy distinguishes timeout from attempt cap, and never asks for the password again', async () => {
    const { describeResetTwoFactorClosed, SIGN_IN_REQUIRED_MESSAGE } = await import('../src/lib/reset-2fa')
    const { TWO_FACTOR_TIMED_OUT_MESSAGE, TWO_FACTOR_TOO_MANY_MESSAGE } = await import('../src/lib/two-factor-login')
    const timedOut = describeResetTwoFactorClosed({ kind: 'restart', message: TWO_FACTOR_TIMED_OUT_MESSAGE })
    const tooMany = describeResetTwoFactorClosed({ kind: 'restart', message: TWO_FACTOR_TOO_MANY_MESSAGE })
    expect(timedOut).toMatch(/timed out/i)
    expect(tooMany).toMatch(/too many/i)
    expect(`${timedOut} ${tooMany}`).not.toMatch(/enter your password again/i)
    expect(SIGN_IN_REQUIRED_MESSAGE).toBe('Your new password is set. Sign in to continue.')
  })
})

describe('the reset 2FA step never trips the global session-expiry handler (task 1803 round 2, Codex P2)', () => {
  // A signed-in user whose vault is locked can start a reset: getMe() has
  // already marked the page load session-confirmed. Finalize then deletes every
  // old session, so the first WRONG code at /auth/2fa/verify is an EXPECTED 401
  // that must reach the step (which shows the retry message), not bounce the
  // person to /login via the shared request client.
  const WRONG_CODE_401 = { error: 'Invalid or expired code' }
  const body409 = { error: 'password_set_sign_in_required', message: 'Your password was changed.' }

  async function armSignedInPage() {
    const shared = await import('@beebeeb/shared')
    let expired = 0
    shared.registerSessionExpiredHandler(() => {
      expired += 1
    })
    shared.markSessionConfirmed() // what getMe() did for the signed-in, locked-vault page
    shared.setToken('legacy-bearer-of-the-old-session')
    return { shared, expiredCount: () => expired }
  }

  afterEach(async () => {
    const shared = await import('@beebeeb/shared')
    shared.clearSessionConfirmed()
    shared.registerSessionExpiredHandler(() => {})
  })

  test('setPasswordFinalize challenge -> wrong code is a plain 401 for the step, handler not fired', async () => {
    const { setPasswordFinalize, verify2fa, ApiError } = await import('../src/lib/api')
    const { expiredCount } = await armSignedInPage()
    globalThis.fetch = capturingFetch([], (url) =>
      url.includes('/2fa/verify') ? { status: 401, body: WRONG_CODE_401 } : { status: 200, body: CHALLENGE },
    )
    const res = await setPasswordFinalize('tok', 'upload')
    expect(res.requires_2fa).toBe(true)
    let caught: unknown = null
    try {
      await verify2fa('partial-abc', '000000')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as InstanceType<typeof ApiError>).status).toBe(401)
    expect((caught as Error).message).not.toBe('Session expired')
    expect(expiredCount()).toBe(0)
    expect(localStorage.getItem('bb_session')).toBe(null)
  })

  test('recoverWithPhraseFinalize challenge -> wrong code, handler not fired', async () => {
    const { recoverWithPhraseFinalize, verify2fa } = await import('../src/lib/api')
    const { expiredCount } = await armSignedInPage()
    globalThis.fetch = capturingFetch([], (url) =>
      url.includes('/2fa/verify')
        ? { status: 401, body: WRONG_CODE_401 }
        : { status: 200, body: { user_id: UID, requires_2fa: true, partial_token: 'partial-xyz' } },
    )
    const res = await recoverWithPhraseFinalize('rec', 'upload', 'check', 'pub')
    expect(res.requires_2fa).toBe(true)
    await expect(verify2fa('partial-xyz', '000000')).rejects.toThrow(/Invalid or expired code/)
    expect(expiredCount()).toBe(0)
  })

  test('409 password_set_sign_in_required also ends the obsolete session state', async () => {
    const { setPasswordFinalize, getMe } = await import('../src/lib/api')
    const { expiredCount } = await armSignedInPage()
    globalThis.fetch = capturingFetch([], (url) =>
      url.includes('/set-password-finish') ? { status: 409, body: body409 } : { status: 401, body: { error: 'nope' } },
    )
    await expect(setPasswordFinalize('tok', 'upload')).rejects.toThrow()
    expect(localStorage.getItem('bb_session')).toBe(null)
    // Any later 401 on this page is an anonymous one, not "your session expired".
    let laterErr: unknown = null
    try {
      await getMe()
    } catch (e) {
      laterErr = e
    }
    expect(laterErr).not.toBeNull()
    expect((laterErr as Error).message).not.toBe('Session expired')
    expect(expiredCount()).toBe(0)
  })

  test('control: without a reset challenge a confirmed-session 401 STILL fires the handler', async () => {
    const { verify2fa } = await import('../src/lib/api')
    const { expiredCount } = await armSignedInPage()
    globalThis.fetch = capturingFetch([], () => ({ status: 401, body: WRONG_CODE_401 }))
    await expect(verify2fa('partial', '000000')).rejects.toThrow(/Session expired/)
    expect(expiredCount()).toBe(1)
  })

  test('control: a non-2FA finalize keeps the fresh session (nothing is cleared)', async () => {
    const { setPasswordFinalize } = await import('../src/lib/api')
    await armSignedInPage()
    globalThis.fetch = capturingFetch([], () => ({ status: 200, body: SESSION }))
    await setPasswordFinalize('tok', 'upload')
    expect(localStorage.getItem('bb_session')).toBe('fresh-session')
  })
})
