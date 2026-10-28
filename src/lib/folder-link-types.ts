/**
 * Task 2237b — typed surface for shared-folder links.
 *
 * The access level is stored as a string in a few places (the link row, the
 * invite row, the proof). Anything we do not recognise must degrade to the
 * least powerful level instead of throwing: a typo in a stored value must never
 * grant add or edit.
 */

export const FOLDER_ACCESS_LEVELS = ['view', 'add', 'edit'] as const
export type FolderAccessLevel = (typeof FOLDER_ACCESS_LEVELS)[number]

export function parseFolderAccessLevel(value: unknown): FolderAccessLevel {
  return value === 'add' || value === 'edit' || value === 'view' ? value : 'view'
}

/** Adding a file or folder to the shared tree. */
export function canAdd(level: FolderAccessLevel): boolean {
  return level === 'add' || level === 'edit'
}

/** Renaming, moving or deleting items already in the shared tree. */
export function canEdit(level: FolderAccessLevel): boolean {
  return level === 'edit'
}

export interface FolderLink {
  id: string
  folder_id: string
  access_level: FolderAccessLevel
  label_encrypted: string | null
  expires_at: string | null
  max_opens: number | null
  open_count: number
  download_count: number
  paused: boolean
  cap_bytes: number | null
  cap_used_bytes: number
  passphrase_protected: boolean
  created_at: string
  revoked_at: string | null
  wrapped_folder_key: string | null
  owner_wrapped_key: string | null
  owner_wrapped_token: string | null
}

export interface FolderLinkCreated extends FolderLink {
  token: string
  key_version: number
}

export interface CreateFolderLinkRequest {
  /**
   * The link's share id, a client-generated UUIDv4 (decision L6a). Both owner
   * copies are sealed under it, so the server stores exactly this id; a taken
   * one answers 409 `id_taken`.
   */
  id: string
  folder_id: string
  access_level?: FolderAccessLevel
  label_encrypted?: string
  expires_in_hours?: number
  max_opens?: number
  passphrase?: string
  cap_bytes?: number
  wrapped_folder_key: string
  owner_wrapped_key?: string
  owner_wrapped_token?: string
  token?: string
  /**
   * Child file keys wrapped under the folder key. The public listing can only
   * give a guest the keys the owner published, so the first link carries the
   * whole subtree's wraps (server writes them once, never replacing).
   */
  folder_keys?: { file_id: string; encrypted_file_key: string }[]
  /**
   * Contract 2237 §1: declares the `folder_keys` wraps as L7. A link exists
   * only for a folder with custody, so a create always sends it.
   */
  format?: 'l7'
}

export interface UpdateFolderLinkRequest {
  access_level?: FolderAccessLevel
  label_encrypted?: string
  expires_in_hours?: number | null
  cap_bytes?: number | null
  paused?: boolean
}

export type FolderLinkErrorCode =
  | 'folder_key_missing'
  | 'too_many_links'
  | 'token_taken'
  | 'cap_below_used'
  | 'nested_share'
  | 'shared_folders_v1'
  | 'folder_gone'

const FOLDER_LINK_ERROR_CODES: readonly FolderLinkErrorCode[] = [
  'folder_key_missing',
  'too_many_links',
  'token_taken',
  'cap_below_used',
  'nested_share',
  'shared_folders_v1',
  'folder_gone',
]

/**
 * The server's machine-readable code, or `'unknown'`. Reads `code` rather than
 * parsing the human message (see packages/shared/src/api/errors.ts).
 */
export function linkErrorCode(err: unknown): FolderLinkErrorCode | 'unknown' {
  const code = (err as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && (FOLDER_LINK_ERROR_CODES as readonly string[]).includes(code)
    ? (code as FolderLinkErrorCode)
    : 'unknown'
}

export type FolderActivityKind =
  | 'files_added'
  | 'items_renamed'
  | 'items_moved'
  | 'items_deleted'

export interface SharedFolderActivityRow {
  id: string
  kind: FolderActivityKind
  share_id: string | null
  share_label_encrypted: string | null
  actor_user_id: string | null
  actor_name_encrypted: string | null
  item_count: number
  first_at: string
  last_at: string
}

export interface SharedFolderActivityResponse {
  activity: SharedFolderActivityRow[]
}

export interface FolderMember {
  user_id: string
  public_key: string | null
  email: string
  is_owner?: boolean
  role: 'owner' | 'member'
  access_level: FolderAccessLevel
}

// ─── Public (anonymous link) response shapes ────────────────────────────────

export interface PublicFolderRoot {
  folder_id: string
  root_name_encrypted: string
  access_level: FolderAccessLevel
  label_encrypted: string | null
  expires_at: string | null
  /** True when this link needs a passphrase before its wrap opens. */
  passphrase_protected: boolean
  wrapped_folder_key: string
  key_version: number
  cap_bytes: number | null
  cap_used_bytes: number
  /**
   * The shared root's own name key wrapped under the folder key (base64), so
   * the guest can read the folder's name: the folder key is random (decision
   * L1), not the root's own key. Null for links made before owners published
   * it; absent from an older server.
   */
  root_wrapped_key?: string | null
}

export interface PublicFolderVerify {
  wrapped_folder_key: string
  key_version: number
  access_level: FolderAccessLevel
  cap_bytes: number | null
  cap_used_bytes: number
  expires_at: string | null
  root_name_encrypted: string
  proof: string
  proof_expires_at: string
}

export interface PublicFolderItem {
  id: string
  parent_id: string | null
  name_encrypted: string
  size_bytes: number
  is_folder: boolean
  chunk_count: number
  version_number: number
  has_thumbnail: boolean
  thumbnail_encrypted: string | null
  updated_at: string
  wrapped_file_key: string | null
}

export interface PublicFolderPage {
  items: PublicFolderItem[]
  next_cursor: string | null
}

export interface PublicUploadResult {
  file_id: string
  size_bytes: number
  cap_used_bytes: number
  cap_bytes: number | null
  files_added: number
}

export type Proof = { token: string; proof: string; expiresAt: number }
