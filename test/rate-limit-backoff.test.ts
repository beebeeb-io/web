import { describe, expect, test } from 'bun:test'
import { ApiError } from '@beebeeb/shared'
import { backoffDelayMs, parseRetryAfter, withRateLimitBackoff } from '../src/lib/rate-limit-backoff'

describe('withRateLimitBackoff', () => {
  test('429 forever: waits grow 2s..60s, so only a few calls a minute', async () => {
    let calls = 0
    const waits: number[] = []
    const ac = new AbortController()
    const p = withRateLimitBackoff(
      async () => { calls++; throw new ApiError('slow down', 429) },
      { signal: ac.signal, sleep: async (ms) => { waits.push(ms); if (waits.length === 8) ac.abort() } },
    )
    await expect(p).rejects.toThrow()
    expect(waits).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
    expect(calls).toBe(8)
    // virtual minute: calls fitting in 60 s of waiting
    let t = 0, inMinute = 0
    for (const w of waits) { t += w; if (t <= 60_000) inMinute++ }
    expect(inMinute + 1).toBeLessThanOrEqual(5)
  })

  test('honours Retry-After, capped at 60s', async () => {
    expect(backoffDelayMs(0, 7)).toBe(7000)
    expect(backoffDelayMs(0, 600)).toBe(60000)
    expect(parseRetryAfter('12')).toBe(12)
    expect(parseRetryAfter('Wed, 21 Oct')).toBeNull()
  })

  test('429 then success retries once', async () => {
    let calls = 0
    const v = await withRateLimitBackoff(
      async () => { if (++calls === 1) throw new ApiError('x', 429); return 'ok' },
      { sleep: async () => {} },
    )
    expect(v).toBe('ok')
    expect(calls).toBe(2)
  })

  test.each([400, 403, 404, 410, 500])('%i stops after one call', async (status) => {
    let calls = 0
    await expect(
      withRateLimitBackoff(async () => { calls++; throw new ApiError('no', status) }, { sleep: async () => {} }),
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
