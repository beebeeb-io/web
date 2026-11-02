// ─── Legacy shared-folder keys ─────────────────────
// The pre-custody row shape and the atomic upgrade that retires it (task 2255,
// L7b (a)). Moved out of api.ts unchanged; re-exported from there.

import { request } from '@beebeeb/shared'

/** One legacy (unbound) child row of a folder that has no custody record yet. */
export interface LegacyFolderKeyRow {
  file_id: string
  /** base64 of the legacy child wrap (empty AAD). */
  encrypted_file_key: string
  /** The row's L7 kind once it is re-sealed. */
  is_folder: boolean
}

/**
 * Owner, only while the folder has no custody record (task 2237b L7b (a)):
 * every legacy child row of the folder, trashed and moved-out children
 * included. 409 `custody_exists` once custody exists; 413 over the one-call cap.
 */
export async function listLegacyFolderKeys(folderId: string): Promise<LegacyFolderKeyRow[]> {
  const body = await request<{ keys: LegacyFolderKeyRow[] }>(
    `/api/v1/shared-folders/${encodeURIComponent(folderId)}/legacy-keys`,
  )
  return body.keys
}

/**
 * Owner: the custody upgrade of a folder whose legacy rows predate custody
 * (L7b (a), contract 2237 §2): the custody record AND every legacy row,
 * re-sealed as L7, in one atomic call. It always says `format: "l7"` (§1) and
 * always carries `rewrap`, even empty: an upgrade is never a plain registration.
 *
 * THE ONE PLACE to change if server #353 settles a different route or body.
 * Coded against #353 (feat/2237b-a-custody-upgrade) and the contract as of
 * 2026-10-28: `PUT .../key` with `rewrap: { keys }`; 409 `rewrap_incomplete`
 * (the rows changed), 409 `custody_exists` (upgraded elsewhere), 413 (too many).
 */
export async function upgradeSharedFolderCustody(
  folderId: string,
  upgrade: { ownerWrappedFolderKey: string; keys: { file_id: string; encrypted_file_key: string }[] },
): Promise<{ created: boolean; key_version: number; rewrapped?: number }> {
  return request(`/api/v1/shared-folders/${encodeURIComponent(folderId)}/key`, {
    method: 'PUT',
    body: JSON.stringify({
      owner_wrapped_folder_key: upgrade.ownerWrappedFolderKey,
      key_version: 1,
      format: 'l7',
      rewrap: { keys: upgrade.keys },
    }),
  })
}
