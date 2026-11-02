/**
 * Task 2275 L15, option A: the web client publishes an owner's upload key only
 * when the destination is anchored to something the user did IN THIS TAB.
 *
 * An anchor is the tab's click trail: the folders the user clicked through in
 * folder view or in an in-app move/upload picker. A trail rebuilt from the
 * server's parent_id walk, a reload, a deep link or `?folder=`, a pinned folder,
 * Recent, Quick Access, search or the command palette never anchors, and
 * nothing anchors while a navigation is in flight (the URL folder differs from
 * the trail's last segment). When a create is not anchored its publish is
 * DEFERRED, never published on trust of the server's parent id.
 */
export const PUBLISH_QUEUE_KEY = 'beebeeb.owner-publish-queue.v1'
export const PUBLISH_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PUBLISH_QUEUE_MAX = 100_000
const TRAIL_MAX = 64

export interface DeferredPublish {
  /** The item whose key is still unpublish. */
  id: string
  /** The destination the user created it under, pinned at enqueue. */
  parentId: string
  /** The shared root proven at enqueue; a pre-L15 row has none. */
  rootId: string
  /** When the deferral was made (7-day bound). */
  at: number
  /** This client's own create, not a server report. */
  own: true
}

/** Folders the user clicked through in this tab, oldest first. */
let trail: string[] = []
/** The folder the URL shows, when the app has told us. */
let urlFolder: string | null = null

export function noteFolderClick(folderId: string): void {
  if (trail[trail.length - 1] !== folderId) trail.push(folderId)
  if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX)
}

/** The app's location changed; a URL folder the trail has not reached means in flight. */
export function noteUrlFolder(folderId: string | null): void {
  urlFolder = folderId
}

/** No navigation is in flight: the URL's folder is the trail's last segment. */
export function navigationSettled(): boolean {
  return trail.length > 0 && (urlFolder === null || trail[trail.length - 1] === urlFolder)
}

/** Did the user reach this folder by clicking in THIS tab? */
export function isAnchoredFolder(folderId: string): boolean {
  return trail.includes(folderId)
}

/**
 * May a publish happen for an item created under `folderId`, whose proven root
 * is `rootId`? Only when the tab's own click trail contains the destination or
 * its root, the trail is settled, and the root is non-null (checked elsewhere).
 */
export function canPublishAnchored(folderId: string, rootId: string): boolean {
  if (!navigationSettled()) return false
  return isAnchoredFolder(folderId) || isAnchoredFolder(rootId)
}

export function resetAnchorsForTests(): void {
  trail = []
  urlFolder = null
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** Deferrals still live: pre-L15 rows (no pinned root) and expired rows are dropped. */
export function readDeferredPublishes(store: Store, now = Date.now()): DeferredPublish[] {
  let rows: DeferredPublish[] = []
  try {
    const raw = store.getItem(PUBLISH_QUEUE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) rows = parsed as DeferredPublish[]
  } catch {
    rows = []
  }
  return rows.filter(
    (row) =>
      row != null &&
      typeof row.id === 'string' &&
      typeof row.parentId === 'string' &&
      typeof row.rootId === 'string' &&
      row.rootId.length > 0 && // pre-L15 rows carried rootId:null and are dropped
      row.own === true &&
      now - row.at < PUBLISH_QUEUE_TTL_MS,
  )
}

export function writeDeferredPublishes(store: Store, rows: DeferredPublish[]): void {
  store.setItem(PUBLISH_QUEUE_KEY, JSON.stringify(rows.slice(-PUBLISH_QUEUE_MAX)))
}

export function deferPublish(store: Store, row: DeferredPublish, now = Date.now()): void {
  const rows = readDeferredPublishes(store, now)
  rows.push(row)
  writeDeferredPublishes(store, rows)
}

/** A18: an item this client moved or trashed loses its deferral here. */
export function dropDeferredForItems(store: Store, ids: Iterable<string>, now = Date.now()): void {
  const drop = new Set(ids)
  const rows = readDeferredPublishes(store, now).filter((row) => !drop.has(row.id))
  writeDeferredPublishes(store, rows)
}

export function localStorageQueue(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
