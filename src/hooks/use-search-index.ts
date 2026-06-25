// ─── Search index hook (B4, task 0871) ─────────────────────────────────────
//
// The hook now re-exports the context-backed implementation in
// `src/lib/search-index-context.tsx`. There is ONE owned core-backed
// `CoreSearchIndex` for the whole app (singleton-via-context) instead of each
// surface (palette + /search + drive) fetching + decrypting its own copy.
// All crypto runs in core via `WasmSearchIndex`; the legacy single-blob index
// (`src/lib/search-index.ts`) is retained only as the rebuild-window fallback.

export {
  useSearchIndex,
  type NodeNameResolver,
  type SearchIndexEntry,
  type SearchIndexContextValue,
} from '../lib/search-index-context'
