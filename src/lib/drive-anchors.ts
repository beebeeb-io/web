/**
 * Contract 2275 L15 (option A): the drive's production wiring for the in-tab
 * click trail. The rule itself lives in `publish-anchor.ts`; this module is the
 * only place the page and its hooks touch it, so the wiring is testable without
 * a DOM (the bun harness has none).
 *
 * - a folder the user OPENED in the drive (`handleFolderOpen`) or via a
 *   breadcrumb (`handleBreadcrumbNav`) notes a click, and the URL's folder is
 *   that same folder, so navigation is settled;
 * - a URL-only change (a deep link, `?folder=`, a reload, Back/forward, the
 *   Quick Access or Recent jump) notes the URL folder and never a click;
 * - after a click lands, the publishes deferred for a site that is now
 *   anchored are sent (A14: an upload made before the user reached R is
 *   published once the user does).

 */
import { navigationSettled, noteFolderClick, noteUrlFolder } from './publish-anchor'
import { flushDeferredOwnerPublishes } from './owner-upload-key'

/** The user clicked into a folder in the drive or in the breadcrumb. */
export function noteDriveFolderClick(folderId: string): void {
  noteFolderClick(folderId)
  // The drive pushes /?folder=<id> for this click: the URL now shows the
  // trail's last segment, so no navigation is in flight.
  noteUrlFolder(folderId)
}

/** The location changed without a click in this tab (deep link, Back/forward). */
export function noteDriveUrlFolder(folderId: string | null): void {
  noteUrlFolder(folderId)
}

/**
 * After a drive click, publish whatever was deferred for a site the trail now
 * anchors. Returns how many wraps were published (0 when nothing was due).
 * A navigation still in flight publishes nothing.
 */
export async function publishDeferredOnAnchoredSite(masterKey: Uint8Array): Promise<number> {
  if (!navigationSettled()) return 0
  return flushDeferredOwnerPublishes(masterKey)
}
