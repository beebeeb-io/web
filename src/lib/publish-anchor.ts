/**
 * Task 2275 L15, option A: the web client publishes an owner's upload key only
 * when the destination is anchored to something the user did IN THIS TAB.
 *
 * An anchor is the tab's CURRENT click path: the chain of folders the user
 * clicked into, each one reached as the child of the previous, ending at the
 * destination. It is not a history of every folder the tab ever opened. A path
 * rebuilt from the server's parent_id walk, a reload, a deep link or
 * `?folder=`, a pinned folder, Recent, Quick Access, search or the command
 * palette never anchors, and nothing anchors while a navigation is in flight
 * (the URL folder differs from the path's last segment). A navigation that is
 * not a child click resets the path, so an earlier visit to R cannot anchor a
 * create made somewhere else; a URL that leaves the path's last segment drops
 * it, so Back or Recent back to a visited folder cannot revive it. A create
 * that is not anchored is owner-only: it is never published and never queued. Only an anchored create whose
 * destination is not yet proven is deferred.
 */
export const PUBLISH_QUEUE_KEY = 'beebeeb.owner-publish-queue.v1'
export const PUBLISH_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PUBLISH_QUEUE_MAX = 100_000
const PATH_MAX = 64

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

/**
 * The current click path, oldest first. Only child clicks extend it; clicking
 * an ancestor already on it (breadcrumb/back) truncates to that ancestor; any
 * other click starts a new path.
 */
let path: string[] = []
/** The folder the URL shows, when the app has told us. */
let urlFolder: string | null = null
/** Has the app told us the URL's folder? `null` then means My files, not unknown. */
let urlKnown = false

export function noteFolderClick(folderId: string): void {
  // A click only extends a path that still leads to the URL's folder. While a
  // navigation is in flight (or the folder was reached from elsewhere) the old
  // path no longer leads here, so neither a re-click of a folder on it nor a
  // click of an ancestor may revive it: this click starts a new path.
  if (!navigationSettled()) {
    path = [folderId]
    return
  }
  if (folderId === path[path.length - 1]) return
  const at = path.indexOf(folderId)
  if (at >= 0) {
    // Breadcrumb/back to a folder on the path: everything below it was left.
    path = path.slice(0, at + 1)
    return
  }
  // A child click from the folder the URL currently shows.
  path.push(folderId)
  if (path.length > PATH_MAX) path.splice(0, path.length - PATH_MAX)
}

/**
 * The app's location changed. A URL that leaves the path's last segment means
 * the user left the trail without a click (Back/forward, Recent, a deep link),
 * so the trail is dropped: the URL coming back to a folder it once visited is
 * not a new click and must not anchor. (An in-flight click still settles: the
 * app changes the URL to the folder it just noted.)
 */
export function noteUrlFolder(folderId: string | null): void {
  if (path.length > 0 && folderId !== path[path.length - 1]) path = []
  urlFolder = folderId
  urlKnown = true
}

/**
 * No navigation is in flight: the URL's folder is the path's last segment. A
 * URL of My files (no folder) settles nothing — the path's last segment is not
 * where the user is.
 */
export function navigationSettled(): boolean {
  if (path.length === 0) return false
  if (!urlKnown) return true
  return path[path.length - 1] === urlFolder
}

/** Is this folder on the tab's current click path? */
export function isAnchoredFolder(folderId: string): boolean {
  return path.includes(folderId)
}

/**
 * May a publish happen for an item created under `folderId`, whose proven root
 * is `rootId`? Only when the tab's current click path ends at the destination
 * and contains R itself. R anywhere earlier in the tab's history is not an
 * anchor: the user has since navigated away, and the server's parent walk can
 * place any folder under R, so seeing D says nothing about R.
 */
export function canPublishAnchored(folderId: string, rootId: string): boolean {
  if (!navigationSettled()) return false
  if (path[path.length - 1] !== folderId) return false
  return isAnchoredFolder(rootId)
}

export function resetAnchorsForTests(): void {
  path = []
  urlFolder = null
  urlKnown = false
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
