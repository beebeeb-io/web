import { afterEach, describe, expect, test } from 'bun:test'

import { ApiError } from '@beebeeb/shared'

import { stepUpGrantFields } from '../src/lib/api'
import { authorizeCliRelay } from '../src/lib/cli-auth-api'

// Task 1734 (round 2). The relay call tolerates exactly ONE oddity from a
// server older than the fix: a 200 with an EMPTY body. It must not turn into a
// blanket "ignore any SyntaxError", which would call a mangled answer a success.

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function answerWith(status: number, body: string, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status, headers })
  }) as typeof fetch
  return calls
}

const BODY = {
  user_code: 'ABCD-EFGH',
  nonce_b64: 'bm9uY2U=',
  encrypted_payload_b64: 'Y2lwaGVy',
  browser_ecdh_public_b64: 'cHVi',
}

describe('authorizeCliRelay', () => {
  test('an empty 200 (a server from before the fix) is a success', async () => {
    const calls = answerWith(200, '')
    await expect(authorizeCliRelay(BODY)).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].url.endsWith('/api/v1/auth/cli-authorize')).toBe(true)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.credentials).toBe('include')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(BODY)
  })

  test('a JSON 200 (the fixed server) is a success', async () => {
    answerWith(200, '{"authorized":true}', { 'content-type': 'application/json' })
    await expect(authorizeCliRelay(BODY)).resolves.toBeUndefined()
  })

  test('a 200 whose body is NOT JSON is not swallowed', async () => {
    answerWith(200, '<html>an error page from a proxy</html>')
    await expect(authorizeCliRelay(BODY)).rejects.toBeInstanceOf(SyntaxError)
  })

  test('a 200 with a truncated JSON body is not swallowed', async () => {
    answerWith(200, '{"authorized":')
    await expect(authorizeCliRelay(BODY)).rejects.toBeInstanceOf(SyntaxError)
  })

  test('an HTTP error with a JSON body becomes an ApiError carrying the status and message', async () => {
    answerWith(403, '{"error":"impersonated_session_blocked","message":"Stop impersonating to continue."}')
    const err = await authorizeCliRelay(BODY).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
    expect((err as ApiError).message).toBe('Stop impersonating to continue.')
  })

  test('a 404 with a plain-text body is still an ApiError, not a SyntaxError', async () => {
    answerWith(404, 'session not found or expired')
    const err = await authorizeCliRelay(BODY).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).message).toBe('session not found or expired')
  })

  test('a network failure is an ApiError with status 0', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    const err = await authorizeCliRelay(BODY).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })
})

describe('stepUpGrantFields - what the step-up mint is told it is FOR', () => {
  test('no grant sends nothing extra (the ordinary step-up is byte-identical to before)', () => {
    expect(stepUpGrantFields(undefined)).toEqual({})
    expect(JSON.stringify({ password: 'x', ...stepUpGrantFields(undefined) })).toBe('{"password":"x"}')
  })

  test('a device-approval grant sends the purpose and the code', () => {
    expect(stepUpGrantFields({ purpose: 'cli_device_approval', cliCode: 'ABCD-EFGH' })).toEqual({
      purpose: 'cli_device_approval',
      cli_code: 'ABCD-EFGH',
    })
  })
})
