import { describe, expect, test } from 'bun:test'
import { applyKnownLargeThumbFlags, recordLargeThumbFlags } from '../src/lib/sync-thumb-flags'

/**
 * e2e classification 2026-09-26 (thumbnail-variant.spec red/flaky on main).
 *
 * GET /api/v1/sync/snapshot does not carry `has_large_thumbnail` (the server's
 * snapshot SELECT lists has_thumbnail only), while GET /api/v1/files does.
 * The drive renders listFiles and then REPLACES the list with sync nodes
 * whenever the snapshot lands or the tree bumps — dropping the flag. The
 * preview gates `/thumbnail/large` on it, so a web-uploaded photo silently
 * opened at the medium list resolution. An instrumented failing run showed
 * the sync refresh passing through an EMPTY list first
 * (`refreshFromSync [true] -> []`, then `[] -> [null]`), so the known values
 * must outlive the list state — they live in a map, not in `prev`.
 */
type F = { id: string; name?: string; has_large_thumbnail?: boolean }

describe('recordLargeThumbFlags + applyKnownLargeThumbFlags', () => {
  test('a sync node that omits the flag gets the value listFiles delivered', () => {
    const known = new Map<string, boolean>()
    recordLargeThumbFlags(known, [{ id: 'a', has_large_thumbnail: true }])
    const out = applyKnownLargeThumbFlags<F>([{ id: 'a', name: 'x' }], known)
    expect(out[0].has_large_thumbnail).toBe(true)
  })

  test('survives an intermediate empty sync list (the observed failing sequence)', () => {
    const known = new Map<string, boolean>()
    recordLargeThumbFlags(known, [{ id: 'a', has_large_thumbnail: true }])
    // refresh 1: tree momentarily empty
    const empty = applyKnownLargeThumbFlags<F>([], known)
    recordLargeThumbFlags(known, empty)
    // refresh 2: node back, still without the flag
    const out = applyKnownLargeThumbFlags<F>([{ id: 'a' }], known)
    expect(out[0].has_large_thumbnail).toBe(true)
  })

  test('an explicit value always wins and is remembered', () => {
    const known = new Map<string, boolean>([['a', true]])
    const out = applyKnownLargeThumbFlags<F>([{ id: 'a', has_large_thumbnail: false }], known)
    expect(out[0].has_large_thumbnail).toBe(false)
    recordLargeThumbFlags(known, out)
    expect(applyKnownLargeThumbFlags<F>([{ id: 'a' }], known)[0].has_large_thumbnail).toBe(false)
  })

  test('an unknown file stays unknown (no invented true)', () => {
    const known = new Map<string, boolean>([['a', true]])
    expect(applyKnownLargeThumbFlags<F>([{ id: 'b' }], known)[0].has_large_thumbnail).toBeUndefined()
  })

  test('order and other fields are preserved; inputs are not mutated', () => {
    const known = new Map<string, boolean>([['a', false], ['b', true]])
    const nodeB: F = { id: 'b', name: 'two' }
    const out = applyKnownLargeThumbFlags<F>([{ id: 'a', name: 'one' }, nodeB], known)
    expect(out.map((f) => [f.id, f.name, f.has_large_thumbnail])).toEqual([
      ['a', 'one', false],
      ['b', 'two', true],
    ])
    expect('has_large_thumbnail' in nodeB).toBe(false)
  })
})
