/**
 * Walk the remaining pages of a bundle manifest, once each.
 *
 * Replaces a `while (nextCursor != null) await loadMore()` loop that read the
 * cursor from a stale React closure: it never advanced, so "Download all" on a
 * multi-page bundle re-fetched GET /shares/{token}?cursor=N forever (~1/s).
 * Here the cursor is a local; the walk stops on an error, a missing cursor, or
 * a cursor that does not advance, and is capped.
 */
export async function fetchRemainingPages<T>(
  start: number | null,
  fetchPage: (cursor: number) => Promise<{ items?: T[]; next_cursor?: number | null }>,
  maxPages = 500,
): Promise<{ items: T[]; next: number | null }> {
  const items: T[] = []
  let cursor = start
  for (let i = 0; cursor != null && i < maxPages; i++) {
    let page
    try {
      page = await fetchPage(cursor)
    } catch {
      return { items, next: cursor }
    }
    items.push(...(page.items ?? []))
    const next = page.next_cursor ?? null
    if (next === cursor) return { items, next: null }
    cursor = next
  }
  return { items, next: cursor }
}
