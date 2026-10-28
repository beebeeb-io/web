/**
 * Task 2237b — guest folder search.
 *
 * The folder's search index is the fast path: it is encrypted under the folder
 * key, so a link holder can query it without ever holding the owner's master
 * key. The listing walk is only a fallback for links whose index is missing or
 * unreadable, and that walk is hard-bounded so a huge folder can never make the
 * browser crawl forever.
 */
import { SEARCH_INDEX_MAX_ENTRIES } from './shared-folder-index'

export type GuestSearchResult =
  | { mode: 'index'; ids: string[]; partial: boolean }
  | { mode: 'listing'; names: { fileId: string; name: string }[]; partial: false }
  | {
      mode: 'listing'
      names: { fileId: string; name: string }[]
      partial: true
      note: 'over_limit'
    }

/** The slice of the shared index the search needs. */
export interface GuestSearchIndex {
  query(term: string): Promise<string[]>
}

export interface GuestSearchArgs {
  term: string
  index: GuestSearchIndex | null
  folderKey: Uint8Array
  /**
   * One call returns the folder's listing in order. Callers page the listing
   * (200 rows at a time) behind this function; the walk here never sees more
   * than `SEARCH_INDEX_MAX_ENTRIES + 1` rows.
   */
  listAll: (parentId: string | null) => Promise<{ fileId: string; name: string }[]>
  entryCount: number
}

const PARTIAL_BANNER =
  'Search may be incomplete — this folder has more items than we index in your browser.'

export function partialBannerText(): string {
  return PARTIAL_BANNER
}

export function noResultsText(term: string): string {
  return `Nothing matches “${term}”.`
}

/**
 * Prefer the index; fall back to a bounded listing walk only when the index is
 * absent or cannot answer.
 */
export async function searchGuestFolder(args: GuestSearchArgs): Promise<GuestSearchResult> {
  const term = args.term.trim()
  if (term === '') {
    return { mode: 'index', ids: [], partial: false }
  }

  if (args.index) {
    try {
      const ids = await args.index.query(term)
      return {
        mode: 'index',
        ids,
        partial: args.entryCount > SEARCH_INDEX_MAX_ENTRIES,
      }
    } catch {
      // A garbage or unreadable index falls through to the listing walk.
    }
  }

  const needle = term.toLowerCase()
  let rows: { fileId: string; name: string }[]
  try {
    rows = await args.listAll(null)
  } catch {
    rows = []
  }

  const names: { fileId: string; name: string }[] = []
  let walked = 0
  let overLimit = false
  for (const row of rows) {
    walked += 1
    if (walked > SEARCH_INDEX_MAX_ENTRIES) {
      overLimit = true
      break
    }
    if (row.name.toLowerCase().includes(needle)) names.push(row)
  }
  if (!overLimit && (args.entryCount > SEARCH_INDEX_MAX_ENTRIES || rows.length > SEARCH_INDEX_MAX_ENTRIES)) {
    overLimit = true
  }

  return overLimit
    ? { mode: 'listing', names, partial: true, note: 'over_limit' }
    : { mode: 'listing', names, partial: false }
}

/** True when the term should be treated as an active search. */
export function isSearchTerm(term: string): boolean {
  return term.trim() !== ''
}
