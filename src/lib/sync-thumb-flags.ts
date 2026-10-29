/**
 * Keep a file's known `has_large_thumbnail` across sync-sourced list refreshes.
 *
 * GET /api/v1/sync/snapshot does not carry `has_large_thumbnail` (its SELECT
 * lists has_thumbnail only), while GET /api/v1/files does. The drive shows the
 * listFiles result and then REPLACES it with sync nodes whenever the snapshot
 * lands or the tree bumps — which dropped the flag to `undefined`. The preview
 * gates `/thumbnail/large` on that flag, so a web-uploaded photo silently
 * opened at the medium list resolution (found classifying
 * thumbnail-variant.spec red on main, 2026-09-26).
 *
 * The known values live in a map owned by the page, not in the previous list
 * state: an instrumented failing run showed a sync refresh passing through an
 * EMPTY list before the node came back, which would wipe anything carried
 * only in `prev`.
 *
 * `undefined` means "this source does not know", never "no large variant". An
 * explicit boolean always wins (and is remembered); a file we have never seen
 * a value for stays unknown.
 */
export interface ThumbFlagged {
  id: string
  has_large_thumbnail?: boolean
}

/** Remember every explicit `has_large_thumbnail` in `files`. */
export function recordLargeThumbFlags(known: Map<string, boolean>, files: readonly ThumbFlagged[]): void {
  for (const f of files) {
    if (typeof f.has_large_thumbnail === 'boolean') known.set(f.id, f.has_large_thumbnail)
  }
}

/** Fill in `has_large_thumbnail` where `next` omits it and a value is known. */
export function applyKnownLargeThumbFlags<T extends ThumbFlagged>(next: T[], known: ReadonlyMap<string, boolean>): T[] {
  if (known.size === 0) return next
  return next.map((f) => {
    if (typeof f.has_large_thumbnail === 'boolean') return f
    const k = known.get(f.id)
    return k === undefined ? f : { ...f, has_large_thumbnail: k }
  })
}
