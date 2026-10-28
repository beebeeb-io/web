import { useEffect, useMemo, useState } from 'react'
import { Breadcrumb } from '../breadcrumb'
import { fetchFolderThumbnail } from '../../lib/folder-link-public'
import { decryptThumbnailBlob } from '../../lib/thumbnail'
import { decryptFileMetadata } from '../../lib/crypto'
import type { FolderAccessLevel, Proof } from '../../lib/folder-link-types'
import { GuestGrid } from './guest-grid'
import { GuestList } from './guest-list'
import {
  GUEST_SORT_OPTIONS,
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
  level: FolderAccessLevel
  proof: Proof | null
  /** Ciphertext of the folder's own name, as returned by the root route. */
  rootName?: string
  onOpenFile: (node: GuestNode) => void
  onPreview: (node: GuestNode) => void
  refreshKey?: number
}) {
  const [stack, setStack] = useState<Crumb[]>([{ id: null, name: 'Shared folder' }])
  const parentId = stack[stack.length - 1]?.id ?? null
  const listing = useGuestListing({
    token: props.token,
    folderKey: props.folderKey,
    parentId,
    proof: props.proof,
  })
  const [view, setView] = useState<GuestViewMode>(readGuestView)
  const [sort, setSort] = useState<GuestSortKey>(readGuestSort)
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let live = true
    if (!props.rootName) return
    void decryptFileMetadata(props.folderKey, props.rootName)
      .then((meta) => {
        // Only the root crumb is renamed; deeper crumbs keep their own names.
        if (live) setStack((current) => [{ id: null, name: meta.name }, ...current.slice(1)])
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [props.rootName, props.folderKey])

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

  const empty = !listing.loading && listing.nodes.length === 0 && !listing.error

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumb items={stack} onNavigate={navigate} />
        </div>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(event) => {
            const next = event.target.value as GuestSortKey
            setSort(next)
            writeGuestSort(next)
          }}
          className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm"
        >
          {GUEST_SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <div
          role="group"
          aria-label="View"
          className="flex overflow-hidden rounded-lg border border-line"
        >
          <button
            type="button"
            aria-pressed={view === 'grid'}
            onClick={() => changeView('grid')}
            className={`px-2.5 py-1.5 text-sm ${view === 'grid' ? 'bg-paper-2 font-medium' : 'text-ink-3'}`}
          >
            Grid
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => changeView('list')}
            className={`border-l border-line px-2.5 py-1.5 text-sm ${view === 'list' ? 'bg-paper-2 font-medium' : 'text-ink-3'}`}
          >
            List
          </button>
        </div>
      </div>

      {listing.error ? (
        <p role="alert" className="text-sm text-ink-3">
          This link isn&apos;t available.
        </p>
      ) : null}

      {empty ? (
        <GuestEmpty level={props.level} />
      ) : view === 'grid' ? (
        <GuestGrid
          nodes={sorted}
          onOpenFolder={openFolder}
          onPreview={props.onPreview}
          thumbnails={thumbnails}
        />
      ) : (
        <GuestList nodes={sorted} onOpenFolder={openFolder} onPreview={props.onPreview} />
      )}

      {listing.hasMore ? (
        <div className="text-center">
          <button
            type="button"
            onClick={listing.loadMore}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** The empty state, exported so its copy can be asserted without a DOM. */
export function GuestEmpty(props: { level: FolderAccessLevel }) {
  return (
    <div className="rounded-lg border border-line bg-paper-2 p-6 text-center text-sm text-ink-3">
      <p>This folder is empty.</p>
      {props.level === 'add' || props.level === 'edit' ? (
        <p className="mt-1">Drop files here, or use Upload.</p>
      ) : null}
    </div>
  )
}
