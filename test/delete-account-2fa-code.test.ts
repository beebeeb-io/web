import { afterEach, describe, expect, test } from 'bun:test'
import { deleteAccountPermanently } from '../src/lib/api-account'
import { classifyDeleteError, isPlausibleSecondFactorCode } from '../src/lib/delete-second-factor'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function captureBody(): { bodies: string[]; headers: Record<string, string>[] } {
  const seen = { bodies: [] as string[], headers: [] as Record<string, string>[] }
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seen.bodies.push(String(init?.body ?? ''))
    seen.headers.push({ ...(init?.headers as Record<string, string>) })
    return new Response(JSON.stringify({ message: 'ok', shred_after: 'x' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return seen
}

describe('deleteAccountPermanently request body', () => {
  test('sends the trimmed code next to the confirmation', async () => {
    const seen = captureBody()
    await deleteAccountPermanently('DELETE', 'tok', ' 123456 ')
    expect(seen.bodies.length).toBe(1)
    expect(JSON.parse(seen.bodies[0])).toEqual({ confirmation: 'DELETE', code: '123456' })
  })

  test('sends no code field for an account without 2FA', async () => {
    const seen = captureBody()
    await deleteAccountPermanently('DELETE', 'tok')
    expect(seen.bodies.length).toBe(1)
    expect(JSON.parse(seen.bodies[0])).toEqual({ confirmation: 'DELETE' })
  })
})

describe('delete error handling', () => {
  test('accepts 6 and 8 digit codes only', () => {
    const accepted = ['123456', '12345678', ' 123456 '].filter(isPlausibleSecondFactorCode)
    const refused = ['', '12345', '1234567', 'abcdef', '123 456'].filter(isPlausibleSecondFactorCode)
    expect(accepted.length).toBe(3)
    expect(refused.length).toBe(0)
  })

  test('a wrong code is retyped; an expired step-up starts over', () => {
    expect(classifyDeleteError(400, 'invalid_totp_code', 'Invalid code').restartStepUp).toBe(false)
    expect(classifyDeleteError(403, 'second_factor_required', 'x').restartStepUp).toBe(false)
    expect(classifyDeleteError(403, 'confirmation_required', 'x').restartStepUp).toBe(true)
  })
})
