import { useEffect, useMemo, useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Breadcrumb } from '../breadcrumb'
import { EncryptionStatus } from '../encryption-status'
import { FILE_STATUS_BAR } from '../file-browser-row'
import { Icon } from '../icons'
import { fetchAllFolderItems, fetchFolderThumbnail } from '../../lib/folder-link-public'
import { decryptThumbnailBlob } from '../../lib/thumbnail'
import { decryptFileMetadata } from '../../lib/crypto'
import { openChildKey } from '../../lib/folder-share-crypto'
import type { FolderAccessLevel, Proof } from '../../lib/folder-link-types'
import { GuestGrid } from './guest-grid'
import { GuestPreview } from './guest-preview'
import { GuestList } from './guest-list'
import { collectGuestZipEntries, downloadGuestZip } from '../../lib/guest-zip'
import { isSearchTerm, searchGuestFolder, type GuestSearchResult } from '../../lib/guest-search'
import {
  loadSharedIndex,
  SEARCH_INDEX_MAX_ENTRIES,
  type SharedSearchIndex,
} from '../../lib/shared-folder-index'
import { publicIndexTransport } from '../../lib/shared-folder-index-shards'
import { GuestSearch, GuestSearchNoResults } from './guest-search'
import {
  GUEST_SORT_OPTIONS,
  describeGuestItem,
  popCrumb,
  pushCrumb,
  readGuestSort,
  readGuestView,
  sortGuestNodes,
  useGuestListing,
  writeGuestSort,
  writeGuestView,
  type Crumb,
  type GuestNode,
  type GuestSortKey,
  type GuestViewMode,
} from './use-guest-listing'

/**
 * Task 2237b — the guest browser.
 *
 * Breadcrumbs come from a local stack so navigating back never re-reads the
 * root name; the listing hook refetches only when the folder changes.
 */
export function GuestBrowser(props: {
  token: string
  folderKey: Uint8Array
  /** The shared folder's id: every wrap the guest opens is bound to it (L7). */
  rootId: string
  level: FolderAccessLevel
  proof: Proof | null
  /** Ciphertext of the folder's own name, as returned by the root route. */
  rootName?: string
  /** The root's own name key wrapped under the folder key (see PublicFolderRoot). */
  rootWrappedKey?: string | null
  onOpenFile: (node: GuestNode) => void
  onPreview: (node: GuestNode) => void
  refreshKey?: number
  onNames?: (parentId: string | null, names: string[]) => void
  /** The decrypted name of the shared folder itself, once known (page title). */
  onRootName?: (name: string) => void
  /** The folder the guest is looking at (uploads land here). */
  onLocationChange?: (parentId: string | null) => void
}) {
  const [stack, setStack] = useState<Crumb[]>([{ id: null, name: 'Shared folder' }])
  const parentId = stack[stack.length - 1]?.id ?? null
  const listing = useGuestListing({
    token: props.token,
    folderKey: props.folderKey,
    rootId: props.rootId,
    parentId,
    proof: props.proof,
    refreshKey: props.refreshKey,
    onNames: props.onNames,
  })
  const [view, setView] = useState<GuestViewMode>(readGuestView)
  const [sort, setSort] = useState<GuestSortKey>(readGuestSort)
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [zipBusy, setZipBusy] = useState(false)
  const [zipMessage, setZipMessage] = useState<string | null>(null)
  const [index, setIndex] = useState<SharedSearchIndex | null>(null)
  const [indexCount, setIndexCount] = useState(0)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<GuestSearchResult | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)

  useEffect(() => {
    let live = true
    if (!props.rootName) return
    const rootName = props.rootName
    const rootWrappedKey = props.rootWrappedKey
    // The root's own name key, published by the owner under the folder key
    // (random folder key, decision L1) as an L7 wrap bound to (root, root,
    // folder). Without it the page keeps the generic title.
    if (!rootWrappedKey) return
    void (async () => {
      const nameKey = await openChildKey(
        props.folderKey,
        { rootId: props.rootId, itemId: props.rootId, isFolder: true },
        rootWrappedKey,
      )
      try {
        return await decryptFileMetadata(nameKey, rootName)
      } finally {
        nameKey.fill(0)
      }
    })()
      .then((meta) => {
        // Only the root crumb is renamed; deeper crumbs keep their own names.
        if (!live) return
        setStack((current) => [{ id: null, name: meta.name }, ...current.slice(1)])
        props.onRootName?.(meta.name)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [props.rootName, props.rootWrappedKey, props.folderKey, props.rootId])

  useEffect(() => {
    let live = true
    const urls: string[] = []
    const wanted = listing.nodes.filter(
      (node) => node.item.has_thumbnail && node.fileKey !== null,
    )
    void Promise.all(
      wanted.map(async (node) => {
        try {
          const encrypted = await fetchFolderThumbnail(
            props.token,
            node.item.id,
            props.proof,
            'small',
          )
          if (!encrypted || !node.fileKey) return null
          const plain = await decryptThumbnailBlob(encrypted, node.fileKey)
          const url = URL.createObjectURL(new Blob([plain]))
          urls.push(url)
          return [node.item.id, url] as const
        } catch {
          return null
        }
      }),
    ).then((pairs) => {
      if (!live) return
      const next = new Map<string, string>()
      for (const pair of pairs) if (pair) next.set(pair[0], pair[1])
      setThumbnails(next)
    })
    return () => {
      live = false
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [listing.nodes, props.token, props.proof])

  const sorted = useMemo(() => sortGuestNodes(listing.nodes, sort), [listing.nodes, sort])

  const onLocationChange = props.onLocationChange
  useEffect(() => {
    onLocationChange?.(parentId)
  }, [parentId, onLocationChange])

  // The shared index is loaded once per link; search stays read-only on it.
  useEffect(() => {
    let live = true
    let loaded: SharedSearchIndex | null = null
    void loadSharedIndex({
      transport: publicIndexTransport(props.token, props.proof),
      folderKey: props.folderKey,
    })
      .then((result) => {
        loaded = result.index
        if (!live) return
        setIndex(result.index)
        setIndexCount(result.fileCount)
      })
      .catch(() => undefined)
    return () => {
      live = false
      loaded?.dispose()
    }
  }, [props.token, props.folderKey, props.proof?.proof])

  // An index with no entries has never been written for this folder; the
  // listing walk is the honest source (and is bounded inside the searcher).
  const usableIndex = indexCount > 0 ? index : null

  // A term filters the folder body. The index answers when it loaded; the
  // listing walk is the bounded fallback inside `searchGuestFolder`.
  useEffect(() => {
    if (!isSearchTerm(term)) {
      setResults(null)
      setSearchBusy(false)
      return
    }
    let live = true
    setSearchBusy(true)
    void searchGuestFolder({
      term,
      index: usableIndex,
      folderKey: props.folderKey,
      entryCount: indexCount,
      listAll: async () => {
        const items = await fetchAllFolderItems(
          props.token,
          parentId,
          props.proof,
          SEARCH_INDEX_MAX_ENTRIES + 1,
        )
        const rows: { fileId: string; name: string }[] = []
        for (const item of items) {
          if (item.is_folder) continue
          const node = await describeGuestItem(item, props.folderKey, props.rootId)
          if (node.name !== null) rows.push({ fileId: item.id, name: node.name })
        }
        return rows
      },
    })
      .then((result) => {
        if (live) setResults(result)
      })
      .catch(() => {
        if (live) setResults(null)
      })
      .finally(() => {
        if (live) setSearchBusy(false)
      })
    return () => {
      live = false
    }
  }, [term, index, indexCount, props.token, props.folderKey, props.proof?.proof, parentId])

  const searchIds = useMemo(() => {
    if (!results) return null
    return results.mode === 'index'
      ? new Set(results.ids)
      : new Set(results.names.map((row) => row.fileId))
  }, [results])

  const visible = useMemo(() => {
    if (!searchIds) return sorted
    return sorted.filter((node) => searchIds.has(node.item.id))
  }, [sorted, searchIds])

  const searching = isSearchTerm(term)

  const changeView = (next: GuestViewMode) => {
    setView(next)
    writeGuestView(next)
  }

  const openFolder = (id: string) => {
    const node = listing.nodes.find((row) => row.item.id === id)
    setStack((current) => pushCrumb(current, { id, name: node?.name ?? 'Folder' }))
  }

  const navigate = (index: number) => {
    setStack((current) => popCrumb(current, index))
  }

  const openPreview = (node: GuestNode) => {
    const index = visible.findIndex((row) => row.item.id === node.item.id)
    setPreviewIndex(index >= 0 ? index : null)
    props.onPreview(node)
  }

  const previewNode = previewIndex === null ? null : visible[previewIndex] ?? null

  const empty = !listing.loading && listing.nodes.length === 0 && !listing.error
  const hasFiles = listing.nodes.some((node) => !node.item.is_folder)

  const downloadAll = async () => {
    if (zipBusy) return
    const rootName = stack[0]?.name ?? 'Shared folder'
    setZipBusy(true)
    setZipMessage(null)
    try {
      const { files, errorCount } = await collectGuestZipEntries({
        token: props.token,
        folderKey: props.folderKey,
        rootId: props.rootId,
        proof: props.proof,
        rootPath: rootName,
      })
      const result = files.length > 0 ? await downloadGuestZip(files, `${rootName}.zip`) : null
      const failures = errorCount + (result?.errorCount ?? 0)
      if (failures > 0) setZipMessage(`${failures} item${failures === 1 ? '' : 's'} could not be downloaded. Try downloading them individually.`)
    } catch (error) {
      setZipMessage(error instanceof Error ? error.message : 'The download did not finish.')
    } finally {
      setZipBusy(false)
    }
  }

  const itemCount = listing.nodes.length
  const viewButton = (mode: GuestViewMode, label: string, first: boolean) => (
    <button
      type="button"
      aria-pressed={view === mode}
      onClick={() => changeView(mode)}
      className={`min-h-11 min-w-11 px-2.5 text-[12px] transition-colors md:min-h-8 ${first ? '' : 'border-l border-line'} ${view === mode ? 'bg-paper-2 font-medium text-ink' : 'text-ink-3 hover:text-ink'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      {zipMessage ? (
        <p role="alert" className="rounded-md border border-line bg-paper-2 px-3 py-2 text-[13px] text-ink-2">
          {zipMessage}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-line bg-paper">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2 md:px-5">
          <div className="min-w-0 flex-1 basis-full overflow-x-auto md:basis-auto">
            <Breadcrumb items={stack} onNavigate={navigate} />
          </div>
          <div className="min-w-0 flex-1 basis-full md:max-w-[260px] md:basis-[220px]">
            <GuestSearch onQuery={setTerm} partial={results?.partial ?? false} busy={searchBusy} />
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Sort"
              value={sort}
              onChange={(event) => {
                const next = event.target.value as GuestSortKey
                setSort(next)
                writeGuestSort(next)
              }}
              className="min-h-11 rounded-md border border-line bg-paper px-2 text-[12px] text-ink-2 md:min-h-8"
            >
              {GUEST_SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <div role="group" aria-label="View" className="flex overflow-hidden rounded-md border border-line">
              {viewButton('grid', 'Grid', true)}
              {viewButton('list', 'List', false)}
            </div>
            {hasFiles ? (
              <BBButton
                size="sm"
                onClick={() => void downloadAll()}
                disabled={zipBusy}
                className="min-h-11 gap-1.5 text-[12px] disabled:opacity-60 md:min-h-8"
              >
                <Icon name="download" size={12} />
                {zipBusy ? 'Preparing zip…' : 'Download all'}
              </BBButton>
            ) : null}
          </div>
        </div>

        {listing.error ? (
          <p role="alert" className="px-5 py-10 text-center text-[13px] text-ink-3">
            This link isn&apos;t available.
          </p>
        ) : empty ? (
          <GuestEmpty level={props.level} />
        ) : searching && !searchBusy && visible.length === 0 ? (
          <GuestSearchNoResults term={term} />
        ) : listing.loading && listing.nodes.length === 0 ? (
          <p role="status" className="px-5 py-10 text-center text-[13px] text-ink-3">
            Decrypting folder…
          </p>
        ) : view === 'grid' ? (
          <GuestGrid nodes={visible} onOpenFolder={openFolder} onPreview={openPreview} thumbnails={thumbnails} />
        ) : (
          <GuestList nodes={visible} onOpenFolder={openFolder} onPreview={openPreview} thumbnails={thumbnails} />
        )}

        {listing.hasMore ? (
          <div className="border-t border-line px-3 py-3 text-center">
            <BBButton size="sm" onClick={listing.loadMore} className="min-h-11 md:min-h-8">
              Load more
            </BBButton>
          </div>
        ) : null}

        <div className={FILE_STATUS_BAR}>
          <span className="font-mono">
            {itemCount} item{itemCount === 1 ? '' : 's'}
            {listing.hasMore ? '+' : ''}
          </span>
          <span>·</span>
          <EncryptionStatus />
        </div>
      </section>

      {previewNode ? (
        <GuestPreview
          token={props.token}
          node={previewNode}
          proof={props.proof}
          onClose={() => setPreviewIndex(null)}
          onPrev={() =>
            setPreviewIndex((index) => (index === null ? null : Math.max(0, index - 1)))
          }
          onNext={() =>
            setPreviewIndex((index) =>
              index === null ? null : Math.min(visible.length - 1, index + 1),
            )
          }
          hasPrev={previewIndex !== null && previewIndex > 0}
          hasNext={previewIndex !== null && previewIndex < visible.length - 1}
        />
      ) : null}
    </div>
  )
}

/** The empty state, exported so its copy can be asserted without a DOM. */
export function GuestEmpty(props: { level: FolderAccessLevel }) {
  const canAdd = props.level === 'add' || props.level === 'edit'
  return (
    <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'var(--color-paper-2)', border: '1.5px dashed var(--color-line-2)' }}
      >
        <Icon name="folder" size={24} className="text-ink-3" />
      </div>
      <h2 className="mb-1.5 text-[15px] font-semibold text-ink">This folder is empty.</h2>
      <p className="max-w-[340px] text-[13px] leading-relaxed text-ink-3">
        {canAdd
          ? 'Drop files here, or use Upload.'
          : 'Nothing has been added yet. Check back later, or ask the person who shared it.'}
      </p>
    </div>
  )
}
