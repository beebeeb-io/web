import { describe, expect, test } from 'bun:test'
import { fetchRemainingPages } from '../src/lib/bundle-pages'

describe('fetchRemainingPages (share Download-all)', () => {
  test('fetches each remaining page exactly once', async () => {
    let calls = 0
    const r = await fetchRemainingPages<number>(1, async (c) => {
      calls++
      return { items: [c], next_cursor: c < 3 ? c + 1 : null }
    })
    expect(calls).toBe(3)
    expect(r).toEqual({ items: [1, 2, 3], next: null })
  })
  test('stops on error instead of looping (old bug: 633 calls)', async () => {
    let calls = 0
    const r = await fetchRemainingPages<number>(5, async () => { calls++; throw new Error('429') })
    expect(calls).toBe(1)
    expect(r.next).toBe(5)
  })
  test('stops when the cursor does not advance', async () => {
    let calls = 0
    await fetchRemainingPages<number>(2, async () => { calls++; return { items: [], next_cursor: 2 } })
    expect(calls).toBe(1)
  })
})
