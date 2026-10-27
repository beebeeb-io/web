/**
 * Task 2238 — the honest page for a folder link created BEFORE this task.
 *
 * Until 2238, "Share link" on a folder minted a `share_type: 'file'` share
 * whose target is the folder's own row. That link is permanently broken: the
 * server refuses to download a folder (`400 cannot download a folder`, shares.rs
 * download handler). The recipient used to see that raw refusal (or a
 * verification error), which reads like a bug on their side.
 *
 * Such a link cannot be repaired server-side — a file share has one wrapped key
 * and no item list — so the page says what is true instead: the link predates
 * folder links, and the owner has to make a new one. New folder links are
 * snapshot bundles (folder-bundle.ts) and never reach this page.
 *
 * Two signals, both real (no guessing):
 *   1. `is_folder` on the share metadata — the server reports it once
 *      share.rs's single-file branch includes the column. Detected on load.
 *   2. The download refusal's own message, for a page loaded against a server
 *      that does not send `is_folder` yet. Detected on the first download.
 */
/** The one sentence the recipient sees, verbatim (spec 2026-10-27 §9). */
export const LEGACY_FOLDER_LINK_COPY =
  'This link was made before folder links existed; ask the owner for a new link'

/** The server's refusal for a download of a folder row (`cannot download a folder`). */
export function isFolderDownloadRefusal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && /cannot download a folder/i.test(message)
}

/**
 * True when this file share's target is a folder. `is_folder` is optional on the
 * wire: a server built before 2238 does not send it, hence the two-signal check
 * in the page (metadata first, download refusal second).
 */
export function isFolderTarget(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  return (data as { is_folder?: unknown }).is_folder === true
}
