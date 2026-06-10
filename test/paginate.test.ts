import { describe, expect, test } from 'bun:test'
import { collectPaged } from '../src/lib/paginate'

// A fake paged source: `pages[i]` is one page; the cursor is just the next page
// index as a string, so we can assert the exact cursor threading (no dup/skip).
function pagedSource(pages: number[][]) {
  const calls: (string | undefined)[] = []
  const fetchPage = async (cursor?: string) => {
    calls.push(cursor)
    const idx = cursor === undefined ? 0 : Number(cursor)
    const items = pages[idx] ?? []
    const nextCursor = idx + 1 < pages.length ? String(idx + 1) : null
    return { items, nextCursor }
  }
  return { fetchPage, calls }
}

describe('collectPaged — keyset pagination loop (0739)', () => {
  test('accumulates every item across pages, in order, until next_cursor is null', async () => {
    const { fetchPage, calls } = pagedSource([[1, 2], [3, 4], [5]])
    const all = await collectPaged(fetchPage, 1000)
    expect(all).toEqual([1, 2, 3, 4, 5])
    // First call passes no cursor; each later call passes the prior page's cursor.
    expect(calls).toEqual([undefined, '1', '2'])
  })

  test('a single page stops at the null cursor (one fetch, no dup/skip)', async () => {
    const { fetchPage, calls } = pagedSource([[1, 2, 3]])
    expect(await collectPaged(fetchPage, 1000)).toEqual([1, 2, 3])
    expect(calls).toEqual([undefined])
  })

  test('honours the maxTotal outer bound and stops paginating early', async () => {
    // 5 pages × 100 = 500 available; cap at 250.
    const pages = Array.from({ length: 5 }, (_, p) => Array.from({ length: 100 }, (_, i) => p * 100 + i))
    const { fetchPage, calls } = pagedSource(pages)
    const all = await collectPaged(fetchPage, 250)
    expect(all.length).toBe(250)
    expect(all[0]).toBe(0)
    expect(all[249]).toBe(249)
    expect(calls.length).toBeLessThan(5) // stopped before fetching all pages
  })

  test('empty first page returns empty', async () => {
    const { fetchPage } = pagedSource([[]])
    expect(await collectPaged(fetchPage, 1000)).toEqual([])
  })
})
