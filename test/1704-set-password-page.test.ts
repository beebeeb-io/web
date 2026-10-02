import { describe, expect, test, afterEach } from 'bun:test'

/**
 * Task 1704 SLICE 1 — client half of the email-based self-service password
 * reset (the /set-password/:token page + its two API calls).
 *
 * Governing model: decisions/2026-10-02-vault-key-password-recovery-and-admin-
 * reset-policy.md (AMENDMENT). The emailed link is the entry proof for ALL
 * password resets; the vault is NEVER touched — the client sends only the
 * one-time token plus the OPAQUE RegistrationUpload, and must NOT send
 * recovery_check / x25519_public_key (an email-only reset keeps those set-
 * once bindings untouched server-side; the vault re-wraps later via the
 * /recover-with-phrase ceremony, slice 3).
 *
 * Conventions followed:
 * - `capturingFetch` swaps `globalThis.fetch` and asserts at the HTTP level
 *   — what actually leaves the browser (pattern: test/1536-pat-create-step-up).
 * - No React rendering exists in this suite (checked: no @testing-library
 *   dependency — see test/1471-isloggedin-auth-context.test.ts's header
 *   note), so the page COMPONENT's own logic is covered by the two exported
 *   pure helpers it uses (`validateSetPasswordInput`,
 *   `describeSetPasswordError`) plus `bunx tsc --noEmit`; full component
 *   behaviour is verified in the browser (e2e), not here.
 */

interface CapturedCall {
  url: string
  method?: string
  headers: Record<string, string>
  body: unknown
}

function capturingFetch(
  calls: CapturedCall[],
  responder: (url: string) => { status: number; body: unknown },
) {
  return (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers as Record<string, string> | undefined) ?? {}
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url: String(url), method: init?.method, headers, body })
    const { status, body: respBody } = responder(String(url))
    return new Response(JSON.stringify(respBody), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const originalFetch = globalThis.fetch

// Minimal in-memory localStorage stub — `setToken`/`setEmail` write there on
// success (same shape as test/1471-isloggedin-auth-context.test.ts).
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

const TOKEN = 'one-time-link-token-abc'

describe('set-password API half (task 1704) — zero key material on the wire', () => {
  test('setPasswordOpaqueRegister posts {token, client_message} to the bridge endpoint', async () => {
    const { setPasswordOpaqueRegister } = await import('../src/lib/api')
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 200,
      body: { server_message: 'c2VydmVyLW1lc3NhZ2U=' },
    }))

    const res = await setPasswordOpaqueRegister(TOKEN, 'Y2xpZW50LW1lc3NhZ2U=')

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/set-password-opaque-register')
    expect(calls[0].method).toBe('POST')
    expect(Object.keys(calls[0].body as object).sort()).toEqual(['client_message', 'token'])
    expect(res.server_message).toBe('c2VydmVyLW1lc3NhZ2U=')
  })

  test('setPasswordFinalize posts ONLY {token, opaque_registration} — no recovery_check, no x25519, no password field', async () => {
    const { setPasswordFinalize } = await import('../src/lib/api')
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 200,
      body: {
        user_id: '11111111-1111-1111-1111-111111111111',
        email: 'user@example.com',
        session_token: 'fresh-session-token',
      },
    }))

    const res = await setPasswordFinalize(TOKEN, 'b3BhcXVlLXVwbG9hZA==')

    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/set-password-finish')
    expect(calls[0].method).toBe('POST')
    const body = calls[0].body as Record<string, unknown>
    // THE zero-key-material assertion (task AC): the finish wire carries the
    // token and the OPAQUE upload and NOTHING else.
    expect(Object.keys(body).sort()).toEqual(['opaque_registration', 'token'])
    expect(Object.keys(body)).not.toContain('recovery_check')
    expect(Object.keys(body)).not.toContain('x25519_public_key')
    expect(JSON.stringify(body)).not.toContain('password')

    // The fresh session + account email are stored locally (login parity with
    // recoverWithPhraseFinalize, incl. the bb_email stamp for passkey lookup).
    expect(res.session_token).toBe('fresh-session-token')
    expect(localStorage.getItem('bb_email')).toBe('user@example.com')
  })

  test('a 400 from finalize surfaces as ApiError (the page maps it to the honest expired/used copy)', async () => {
    const { setPasswordFinalize, ApiError } = await import('../src/lib/api')
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 400,
      body: { error: 'invalid or expired set-password link' },
    }))

    let caught: unknown = null
    try {
      await setPasswordFinalize(TOKEN, 'b3BhcXVlLXVwbG9hZA==')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as InstanceType<typeof ApiError>).status).toBe(400)
    // A refused call must not store a session.
    expect(localStorage.getItem('bb_session')).toBe(null)
  })
})

describe('set-password page helpers (task 1704)', () => {
  test('validateSetPasswordInput rejects short and mismatched passwords', async () => {
    const { validateSetPasswordInput } = await import('../src/pages/set-password')
    expect(validateSetPasswordInput('short', 'short')).toMatch(/at least 8/i)
    expect(validateSetPasswordInput('long-enough-password', 'different')).toMatch(/do not match/i)
    expect(validateSetPasswordInput('long-enough-password', 'long-enough-password')).toBe(null)
  })

  test('describeSetPasswordError maps honest statuses to honest copy', async () => {
    const { describeSetPasswordError, ApiError } = await import('../src/pages/set-password')
    const invalid = new ApiError('invalid or expired set-password link', 400)
    const limited = new ApiError('rate limit', 429)
    expect(describeSetPasswordError(invalid)).toMatch(/expired|already used|invalid/i)
    expect(describeSetPasswordError(invalid)).toMatch(/request a new/i)
    expect(describeSetPasswordError(limited)).toMatch(/wait an hour/i)
    // A plain Error's own message is surfaced verbatim (honest passthrough).
    expect(describeSetPasswordError(new Error('boom'))).toBe('boom')
  })
})
