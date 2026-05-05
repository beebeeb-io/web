/**
 * Dropbox import helpers — pure async functions, no React.
 *
 * download + recursive listing + rate-limit backoff.
 * The actual encrypt+upload loop lives in the settings/import page
 * (needs access to useKeys hooks).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportQueueItem {
  /** Dropbox path, e.g. "/Photos/beach.jpg" */
  dropboxPath: string
  /** File name only, e.g. "beach.jpg" */
  name: string
  /** Dropbox parent folder path — used to look up the Beebeeb folder ID */
  parentDropboxPath: string
  /** File size in bytes (from Dropbox metadata) */
  size: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DBX_DOWNLOAD = 'https://content.dropboxapi.com/2/files/download'
const DBX_LIST     = 'https://api.dropboxapi.com/2/files/list_folder'
const DBX_LIST_CONT= 'https://api.dropboxapi.com/2/files/list_folder/continue'

const MAX_RATE_LIMIT_RETRIES = 4

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sleepMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Exponential backoff for 429 rate-limit responses. */
async function rateLimitedFetch(
  input: RequestInfo,
  init: RequestInit,
  retries = 0,
): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 429 && retries < MAX_RATE_LIMIT_RETRIES) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10)
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** retries, 30_000)
    await sleepMs(waitMs)
    return rateLimitedFetch(input, init, retries + 1)
  }
  return res
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download a single file from Dropbox.
 * Returns its content as a Blob (buffered in memory).
 * Throws on HTTP error or AbortError if signal is aborted.
 */
export async function downloadDropboxFile(
  dropboxPath: string,
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await rateLimitedFetch(DBX_DOWNLOAD, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
    },
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Dropbox download failed (${res.status}): ${text.slice(0, 120)}`)
  }

  return res.blob()
}

// ─── Folder expansion ─────────────────────────────────────────────────────────

interface RawDbxEntry {
  '.tag': 'file' | 'folder'
  name: string
  path_lower: string
  size?: number
}

/**
 * Recursively expand a list of Dropbox paths (files and/or folders) into a
 * flat list of ImportQueueItem (only files, no folders).
 *
 * @param token       Dropbox access token
 * @param paths       Paths selected by the user (files or folders)
 * @param onCount     Called after each batch with running total of files found
 */
export async function expandDropboxPaths(
  token: string,
  paths: string[],
  onCount?: (n: number) => void,
): Promise<ImportQueueItem[]> {
  const queue: ImportQueueItem[] = []

  for (const path of paths) {
    await expandOne(token, path, queue, onCount)
  }

  return queue
}

async function expandOne(
  token: string,
  path: string,
  queue: ImportQueueItem[],
  onCount?: (n: number) => void,
): Promise<void> {
  // List the path recursively — Dropbox returns all descendants in one go
  let cursor: string | null = null
  let hasMore = true

  while (hasMore) {
    let res: Response

    if (cursor) {
      res = await rateLimitedFetch(DBX_LIST_CONT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor }),
      })
    } else {
      // Path might itself be a file (single selection)
      res = await rateLimitedFetch(DBX_LIST, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path,
          recursive: true,
          include_deleted: false,
          include_media_info: false,
        }),
      })
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // If path is a file (not a folder) list_folder returns 409 — handle gracefully
      if (res.status === 409 && !cursor) {
        // Treat this path as a single file — add it directly (size unknown from this endpoint)
        const parts = path.split('/')
        const name = parts[parts.length - 1] ?? path
        const parentDropboxPath = parts.slice(0, -1).join('/') || ''
        queue.push({ dropboxPath: path, name, parentDropboxPath, size: 0 })
        onCount?.(queue.length)
        return
      }
      throw new Error(`Dropbox expand failed (${res.status}): ${text.slice(0, 120)}`)
    }

    const data = await res.json() as { entries: RawDbxEntry[]; has_more: boolean; cursor: string }

    for (const entry of data.entries) {
      if (entry['.tag'] !== 'file') continue
      const parts = entry.path_lower.split('/')
      const name = parts[parts.length - 1] ?? entry.name
      const parentDropboxPath = parts.slice(0, -1).join('/') || ''
      queue.push({
        dropboxPath: entry.path_lower,
        name,
        parentDropboxPath,
        size: entry.size ?? 0,
      })
    }

    onCount?.(queue.length)
    hasMore = data.has_more
    cursor = data.cursor
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Format estimated remaining time from throughput + bytes left. */
export function formatEta(bytesRemaining: number, throughputBps: number): string {
  if (throughputBps <= 0) return '—'
  const secs = bytesRemaining / throughputBps
  if (secs < 60) return `< 1 min`
  if (secs < 3600) return `~${Math.ceil(secs / 60)} min`
  const h = Math.floor(secs / 3600)
  const m = Math.ceil((secs % 3600) / 60)
  return `~${h}h ${m}m`
}

export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 ** 2).toFixed(1)} MB/s`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
