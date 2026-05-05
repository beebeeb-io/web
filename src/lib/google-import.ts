/**
 * Google Drive import helpers — pure async functions, no React.
 *
 * download + recursive folder listing.
 * The encrypt+upload loop lives in settings/import.tsx (needs useKeys hooks).
 * Token refresh is handled by the caller via `GoogleAuthError`.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GDriveImportItem {
  /** Google Drive file ID */
  fileId: string
  /** File name only, e.g. "beach.jpg" */
  name: string
  /** Slash-joined parent folder names from root, e.g. "/Photos/vacation" */
  parentPath: string
  /** File size in bytes (from Drive metadata; 0 if unknown) */
  size: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GDRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
/** Prefix for all Google Workspace document types (Docs, Sheets, Slides, etc.) */
export const GOOGLE_DOCS_MIME_PREFIX = 'application/vnd.google-apps.'

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when Google returns 401 — caller should refresh the token and retry. */
export class GoogleAuthError extends Error {
  constructor() {
    super('Google Drive access token expired')
    this.name = 'GoogleAuthError'
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download a single file from Google Drive.
 * Returns its content as a Blob (buffered in memory).
 * Throws `GoogleAuthError` on 401 so the caller can refresh + retry.
 * Throws on any other HTTP error or AbortError.
 */
export async function downloadGoogleFile(
  fileId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const url = `${GDRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })

  if (res.status === 401) throw new GoogleAuthError()
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Drive download failed (${res.status}): ${text.slice(0, 120)}`)
  }
  return res.blob()
}

// ─── Folder listing ───────────────────────────────────────────────────────────

interface GDriveApiFile {
  id: string
  name: string
  mimeType: string
  /** Google returns size as a string */
  size?: string
}

export interface GDriveListResult {
  files: GDriveApiFile[]
  nextPageToken?: string
}

/**
 * List the direct children of a Google Drive folder.
 * `folderId` = 'root' for the user's My Drive root.
 */
export async function listGoogleDriveFolder(
  folderId: string,
  token: string,
  pageToken?: string,
): Promise<GDriveListResult> {
  const q = `'${folderId}' in parents and trashed = false`
  const fields = 'nextPageToken,files(id,name,mimeType,size)'
  const params = new URLSearchParams({
    q,
    fields,
    pageSize: '200',
    ...(pageToken ? { pageToken } : {}),
  })

  const res = await fetch(`${GDRIVE_FILES}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 401) throw new GoogleAuthError()
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Drive list failed (${res.status}): ${text.slice(0, 120)}`)
  }
  return res.json() as Promise<GDriveListResult>
}

// ─── Recursive expansion ──────────────────────────────────────────────────────

/**
 * Expand a list of selected Drive items (files and/or folders) into a flat
 * list of `GDriveImportItem` (only downloadable files — not Google Docs).
 *
 * @param token       Google access token
 * @param items       Items selected in the tree (files or folders with parentPath)
 * @param onCount     Called after each file is found with the running total
 * @returns `files` — downloadable items; `skippedDocs` — count of Google Docs skipped
 */
export async function expandGoogleDrivePaths(
  token: string,
  items: Array<{
    id: string
    name: string
    mimeType: string
    parentPath: string
    size?: number
  }>,
  onCount?: (n: number) => void,
): Promise<{ files: GDriveImportItem[]; skippedDocs: number }> {
  const files: GDriveImportItem[] = []
  let skippedDocs = 0

  for (const item of items) {
    if (item.mimeType === GOOGLE_FOLDER_MIME) {
      const childPath = item.parentPath ? `${item.parentPath}/${item.name}` : `/${item.name}`
      const sub = await expandFolder(token, item.id, childPath, files, onCount)
      skippedDocs += sub.skippedDocs
    } else if (item.mimeType.startsWith(GOOGLE_DOCS_MIME_PREFIX)) {
      skippedDocs++
    } else {
      files.push({
        fileId: item.id,
        name: item.name,
        parentPath: item.parentPath,
        size: item.size ?? 0,
      })
      onCount?.(files.length)
    }
  }

  return { files, skippedDocs }
}

async function expandFolder(
  token: string,
  folderId: string,
  folderPath: string,
  out: GDriveImportItem[],
  onCount?: (n: number) => void,
): Promise<{ skippedDocs: number }> {
  let skippedDocs = 0
  let pageToken: string | undefined

  do {
    const result = await listGoogleDriveFolder(folderId, token, pageToken)

    for (const f of result.files) {
      if (f.mimeType === GOOGLE_FOLDER_MIME) {
        const subPath = `${folderPath}/${f.name}`
        const sub = await expandFolder(token, f.id, subPath, out, onCount)
        skippedDocs += sub.skippedDocs
      } else if (f.mimeType.startsWith(GOOGLE_DOCS_MIME_PREFIX)) {
        skippedDocs++
      } else {
        out.push({
          fileId: f.id,
          name: f.name,
          parentPath: folderPath,
          size: f.size ? parseInt(f.size, 10) : 0,
        })
        onCount?.(out.length)
      }
    }

    pageToken = result.nextPageToken
  } while (pageToken)

  return { skippedDocs }
}
