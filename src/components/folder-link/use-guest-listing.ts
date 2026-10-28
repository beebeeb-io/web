/**
 * Task 2237b — listing state and the small pure helpers the guest browser
 * needs. Kept out of the component so paging, sorting and persistence can be
 * asserted without a DOM.
 */
import { useCallback, useEffect, useState } from 'react'
import { listFolderItems } from '../../lib/folder-link-public'
import type { Proof, PublicFolderItem } from '../../lib/folder-link-types'
import { decryptChildFileKey } from '../../lib/folder-share-crypto'
import { decryptFileMetadata } from '../../lib/crypto'

export interface GuestNode {
  item: PublicFolderItem
  name: string | null
  fileKey: Uint8Array | null
  mimeType: string | null
}

export interface GuestListing {
  nodes: GuestNode[]
  loading: boolean
  error: 'not_available' | null
  hasMore: boolean
  loadMore: () => void
}

export const GUEST_VIEW_KEY = 'beebeeb.folderLink.view'
export const GUEST_SORT_KEY = 'beebeeb.folderLink.sort'

export type GuestViewMode = 'grid' | 'list'

export function readGuestView(): GuestViewMode {
  try {
    return localStorage.getItem(GUEST_VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export function writeGuestView(mode: GuestViewMode): void {
  try {
    localStorage.setItem(GUEST_VIEW_KEY, mode)
  } catch {
    // ignore
  }
}

export type GuestSortKey = 'name-asc' | 'name-desc' | 'modified-desc' | 'size-desc'

export const GUEST_SORT_OPTIONS: { key: GuestSortKey; label: string }[] = [
  { key: 'name-asc', label: 'Name (A–Z)' },
  { key: 'name-desc', label: 'Name (Z–A)' },
  { key: 'modified-desc', label: 'Newest first' },
  { key: 'size-desc', label: 'Largest first' },
]

export function readGuestSort(): GuestSortKey {
  try {
    const stored = localStorage.getItem(GUEST_SORT_KEY)
    return GUEST_SORT_OPTIONS.some((option) => option.key === stored)
      ? (stored as GuestSortKey)
      : 'name-asc'
  } catch {
    return 'name-asc'
  }
}

export function writeGuestSort(key: GuestSortKey): void {
  try {
    localStorage.setItem(GUEST_SORT_KEY, key)
  } catch {
    // ignore
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then the chosen key. Unnamed rows sort last but stay clickable. */
export function sortGuestNodes(nodes: GuestNode[], key: GuestSortKey): GuestNode[] {
  const compare = (a: GuestNode, b: GuestNode): number => {
    const folderDelta = Number(b.item.is_folder) - Number(a.item.is_folder)
    if (folderDelta !== 0) return folderDelta
    switch (key) {
      case 'name-desc':
        return collator.compare(b.name ?? '', a.name ?? '')
      case 'modified-desc':
        return b.item.updated_at.localeCompare(a.item.updated_at)
      case 'size-desc':
        return b.item.size_bytes - a.item.size_bytes
      default:
        return collator.compare(a.name ?? '', b.name ?? '')
    }
  }
  return [...nodes].sort(compare)
}

/** Decrypt one listing row; a failed unwrap leaves it visible but inert. */
export async function describeGuestItem(
  item: PublicFolderItem,
  folderKey: Uint8Array,
): Promise<GuestNode> {
  try {
    const fileKey =
      item.is_folder || !item.wrapped_file_key
        ? null
        : await decryptChildFileKey(folderKey, item.wrapped_file_key)
    const meta = await decryptFileMetadata(fileKey ?? folderKey, item.name_encrypted)
    return { item, name: meta.name, fileKey, mimeType: meta.mimeType }
  } catch {
    return { item, name: null, fileKey: null, mimeType: null }
  }
}

export interface Crumb {
  id: string | null
  name: string
}

/**
 * One page, decrypted. Extracted from the hook so cursor paging and the
 * parent_id/limit a folder click sends can be asserted without a DOM.
 */
export async function fetchGuestPage(args: {
  token: string
  folderKey: Uint8Array
  parentId: string | null
  cursor?: string | null
  limit: number
  proof: Proof | null
}): Promise<{ nodes: GuestNode[]; nextCursor: string | null }> {
  const page = await listFolderItems(
    args.token,
    { parentId: args.parentId, cursor: args.cursor, limit: args.limit },
    args.proof,
  )
  const nodes = await Promise.all(
    page.items.map((item) => describeGuestItem(item, args.folderKey)),
  )
  return { nodes, nextCursor: page.next_cursor }
}

/** Appending is the whole "Load more" contract; the caller keeps the old rows on failure. */
export function appendGuestNodes(current: GuestNode[], incoming: GuestNode[]): GuestNode[] {
  return [...current, ...incoming]
}

/** A folder click pushes one crumb; the root crumb is never rebuilt. */
export function pushCrumb(stack: Crumb[], crumb: Crumb): Crumb[] {
  return [...stack, crumb]
}

export function popCrumb(stack: Crumb[], index: number): Crumb[] {
  return stack.slice(0, Math.max(1, index + 1))
}

export function useGuestListing(args: {
  token: string
  folderKey: Uint8Array
  parentId: string | null
  proof: Proof | null
  pageSize?: number
  /** Bumped by the page after an upload to re-read the first page. */
  refreshKey?: number
}): GuestListing {
  const pageSize = args.pageSize ?? 200
  const [nodes, setNodes] = useState<GuestNode[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not_available' | null>(null)

  useEffect(() => {
    let live = true
    setNodes([])
    setCursor(null)
    setError(null)
    setLoading(true)
    void fetchGuestPage({
      token: args.token,
      folderKey: args.folderKey,
      parentId: args.parentId,
      limit: pageSize,
      proof: args.proof,
    })
      .then((page) => {
        if (!live) return
        setNodes(page.nodes)
        setCursor(page.nextCursor)
      })
      .catch(() => {
        if (live) setError('not_available')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [args.token, args.folderKey, args.parentId, args.proof?.proof, pageSize, args.refreshKey])

  const [loadingMore, setLoadingMore] = useState(false)
  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    void fetchGuestPage({
      token: args.token,
      folderKey: args.folderKey,
      parentId: args.parentId,
      cursor,
      limit: pageSize,
      proof: args.proof,
    })
      .then((page) => {
        // A paging failure keeps the rows already shown.
        setNodes((current) => appendGuestNodes(current, page.nodes))
        setCursor(page.nextCursor)
      })
      .catch(() => setError('not_available'))
      .finally(() => setLoadingMore(false))
  }, [args.token, args.folderKey, args.parentId, args.proof, cursor, loadingMore, pageSize])

  return { nodes, loading, error, hasMore: cursor !== null, loadMore }
}

/** A row whose name could not be decrypted stays visible but cannot be opened. */
export function isNodeClickable(node: GuestNode): boolean {
  return node.name !== null
}
