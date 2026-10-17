import { describe, expect, test, afterEach } from 'bun:test'
import { createToken } from '../src/lib/api'
import {
  PAT_ACCESS_NOTICE,
  PAT_EXPIRY_OPTIONS,
  PAT_MAX_LIFETIME_DAYS,
  buildCreateTokenBody,
} from '../src/lib/pat'

/**
 * Task 1789 (web half of server PR #188). After #188, POST /api/v1/tokens
 * answers 400 to any non-empty `scopes` and always returns `scopes: []`.
 * The client must never send scopes, and the copy must not imply they exist.
 */

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function capture(): { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(init!.body as string))
    return new Response(
      JSON.stringify({ id: 't1', token: 'bb_pat_x', name: 'CI', scopes: [], expires_at: null }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return { bodies }
}

describe('createToken never sends scopes (1789)', () => {
  test('body has name and expires_in_days only', async () => {
    const { bodies } = capture()
    await createToken(buildCreateTokenBody('  CI  ', 90), 'confirm-1')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({ name: 'CI', expires_in_days: 90 })
    expect('scopes' in bodies[0]).toBe(false)
  })

  test('a stray scopes field from a legacy caller is dropped, not forwarded', async () => {
    const { bodies } = capture()
    await createToken(
      { name: 'CI', expires_in_days: null, scopes: ['files:read'] } as never,
      'confirm-1',
    )
    expect('scopes' in bodies[0]).toBe(false)
    expect(bodies[0]).toEqual({ name: 'CI', expires_in_days: null })
  })
})

describe('expiry options match the server contract (1789)', () => {
  test('every explicit option is within 1..=366, and Never is null', () => {
    expect(PAT_MAX_LIFETIME_DAYS).toBe(366)
    const explicit = PAT_EXPIRY_OPTIONS.filter((o) => o.days !== null)
    expect(explicit.length).toBe(3)
    for (const o of explicit) {
      expect(o.days!).toBeGreaterThanOrEqual(1)
      expect(o.days!).toBeLessThanOrEqual(PAT_MAX_LIFETIME_DAYS)
    }
    expect(PAT_EXPIRY_OPTIONS.filter((o) => o.days === null)).toHaveLength(1)
  })

  test('out-of-range lifetimes are refused client-side', () => {
    for (const bad of [0, -1, 367, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => buildCreateTokenBody('x', bad)).toThrow(RangeError)
    }
    expect(buildCreateTokenBody('x', 366).expires_in_days).toBe(366)
    expect(buildCreateTokenBody('x', 1).expires_in_days).toBe(1)
  })
})

describe('copy does not imply scopes (1789)', () => {
  test('notice says full access and no limiting, and avoids scope vocabulary', () => {
    expect(PAT_ACCESS_NOTICE).toContain('same access to your account')
    expect(PAT_ACCESS_NOTICE).toContain('cannot limit')
    expect(PAT_ACCESS_NOTICE.toLowerCase()).not.toContain('scope')
    expect(PAT_ACCESS_NOTICE).not.toMatch(/—/)
  })
})
