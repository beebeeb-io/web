

// ── SessionStorage keys ─────────────────────────────────────────────────────

export const VERIFIER_KEY = 'bb_dbx_pkce_verifier'
export const TOKEN_KEY    = 'bb_dbx_token'
export const ACCOUNT_KEY  = 'bb_dbx_account'

// ── PKCE helpers ─────────────────────────────────────────────────────────────

export function generateVerifier(): string {
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function generateChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ── Dropbox API helpers ──────────────────────────────────────────────────────

export interface DbxEntry {
  '.tag': 'file' | 'folder'
  name: string
  path_lower: string
  id: string
  size?: number
  server_modified?: string
}

export interface DbxListResult {
  entries: DbxEntry[]
  cursor: string
  has_more: boolean
}

export async function dbxListFolder(token: string, path: string): Promise<DbxListResult> {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path,
      recursive: false,
      include_media_info: false,
      include_deleted: false,
      include_has_explicit_shared_members: false,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Dropbox list error (${res.status}): ${text.slice(0, 120)}`)
  }
  return res.json() as Promise<DbxListResult>
}

export async function dbxListFolderContinue(token: string, cursor: string): Promise<DbxListResult> {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cursor }),
  })
  if (!res.ok) throw new Error(`Dropbox continue error (${res.status})`)
  return res.json() as Promise<DbxListResult>
}

export { formatBinarySize as formatBytes } from '../../../lib/format'
