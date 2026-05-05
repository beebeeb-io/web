/**
 * Client-side bulk download: decrypts multiple files and packages them as a
 * ZIP archive using fflate (8 KB gzipped, zero dependencies).
 *
 * The archive is built entirely in the browser — no server changes required.
 * Folder selections are expanded recursively, preserving directory structure.
 */

import { zipSync, strToU8, type Zippable } from 'fflate'
import { decryptToBlob } from './encrypted-download'
import { listFiles, type DriveFile } from './api'
import { decryptFilename, fromBase64 } from './crypto'

// ─── Constants ───────────────────────────────────────────────────────────────

export const ZIP_SIZE_WARNING_BYTES = 1_073_741_824 // 1 GiB

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkDownloadOptions {
  /** Called after each file is processed. */
  onProgress?: (done: number, total: number, currentName: string) => void
  /** Name for the output zip file (default: beebeeb-files.zip). */
  zipFilename?: string
}

export interface BulkDownloadResult {
  /** Number of files that failed to decrypt / download. */
  errorCount: number
  /** True if the estimated total size exceeded the warning threshold. */
  sizeWarning: boolean
}

// ─── Folder expansion ─────────────────────────────────────────────────────────

interface QueueEntry {
  file: DriveFile
  /** ZIP path prefix, e.g. "Documents/Reports/" */
  prefix: string
}

/**
 * Recursively expand any folders in `items`, returning a flat list of
 * non-folder files with their zip-path prefixes.
 *
 * Folder names are decrypted on the fly using the per-file key. If
 * decryption fails (key unavailable, encoding error), a fallback name
 * based on the folder ID is used so the download still proceeds.
 */
async function expandToFiles(
  items: DriveFile[],
  getFileKey: (id: string) => Promise<Uint8Array>,
  prefix = '',
): Promise<QueueEntry[]> {
  const queue: QueueEntry[] = []

  for (const item of items) {
    if (!item.is_folder) {
      queue.push({ file: item, prefix })
      continue
    }

    // Decrypt folder name for the path
    let folderName = `folder-${item.id.slice(0, 8)}`
    try {
      const key = await getFileKey(item.id)
      const parsed = JSON.parse(item.name_encrypted) as { nonce: string; ciphertext: string }
      folderName = await decryptFilename(key, fromBase64(parsed.nonce), fromBase64(parsed.ciphertext))
    } catch {
      // Use fallback name — continue rather than failing the whole zip
    }

    // Sanitise for zip path (no slashes inside segment names)
    const safeName = folderName.replace(/[/\\]/g, '_')
    const childPrefix = `${prefix}${safeName}/`

    const children = await listFiles(item.id).catch(() => [])
    const nested = await expandToFiles(children, getFileKey, childPrefix)
    queue.push(...nested)
  }

  return queue
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Download and decrypt `items`, then package them into a ZIP file and
 * trigger a browser download.
 *
 * - Single non-folder file: just calls regular download (no zip overhead).
 *   Callers should handle this case before calling `downloadAsZip` if
 *   they want the single-file fast path.
 * - Folders: expanded recursively, structure preserved in zip paths.
 * - Failed files: skipped, listed in `_errors.txt` inside the zip.
 * - Size > 1 GiB: `sizeWarning: true` in the result (caller shows warning).
 *
 * @param items      - DriveFile objects (may include folders)
 * @param getFileKey - async function that returns the decryption key for a file ID
 * @param options    - progress callback and output filename
 */
export async function downloadAsZip(
  items: DriveFile[],
  getFileKey: (fileId: string) => Promise<Uint8Array>,
  options: BulkDownloadOptions = {},
): Promise<BulkDownloadResult> {
  const { onProgress, zipFilename = 'beebeeb-files.zip' } = options

  // ── Expand folders to a flat file list ───────────────────────────────────
  const entries = await expandToFiles(items, getFileKey)

  if (entries.length === 0) {
    return { errorCount: 0, sizeWarning: false }
  }

  // ── Size check ────────────────────────────────────────────────────────────
  const totalEstimatedBytes = entries.reduce((s, e) => s + (e.file.size_bytes ?? 0), 0)
  const sizeWarning = totalEstimatedBytes > ZIP_SIZE_WARNING_BYTES

  // ── Decrypt and collect ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zipFiles: Record<string, any> = {}
  const errors: string[] = []

  for (let i = 0; i < entries.length; i++) {
    const { file, prefix } = entries[i]

    // Placeholder name while we decrypt
    const fallbackName = `file-${file.id.slice(0, 8)}`
    onProgress?.(i, entries.length, fallbackName)

    try {
      const key = await getFileKey(file.id)
      const { plaintext, filename } = await decryptToBlob(
        file.id,
        key,
        file.name_encrypted,
        file.mime_type,
        file.chunk_count,
        file.size_bytes,
      )

      const bytes = new Uint8Array(await plaintext.arrayBuffer())

      // Deduplicate zip paths — if a name already exists (e.g. two files
      // called "report.pdf" in the same folder), append the file ID suffix.
      let zipPath = `${prefix}${filename}`
      if (zipPath in zipFiles) {
        const dot = filename.lastIndexOf('.')
        const base = dot > 0 ? filename.slice(0, dot) : filename
        const ext = dot > 0 ? filename.slice(dot) : ''
        zipPath = `${prefix}${base}-${file.id.slice(0, 6)}${ext}`
      }

      // Store with level-1 compression (fast; skip for already-compressed
      // binary formats where compression is wasteful)
      const skipCompression = /\.(zip|gz|bz2|zst|7z|rar|png|jpg|jpeg|webp|mp4|mov|mkv|pdf)$/i.test(filename)
      zipFiles[zipPath] = [bytes, { level: skipCompression ? 0 : 1 }]

      onProgress?.(i + 1, entries.length, filename)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${prefix}${fallbackName}: ${msg}`)
      onProgress?.(i + 1, entries.length, fallbackName)
    }
  }

  // ── Append error manifest if any downloads failed ─────────────────────────
  if (errors.length > 0) {
    const lines = [
      'The following files could not be downloaded:',
      '',
      ...errors,
      '',
      'Try downloading them individually from the Beebeeb web app.',
    ]
    zipFiles['_errors.txt'] = strToU8(lines.join('\n'))
  }

  // ── Build zip and trigger browser download ────────────────────────────────
  const zipped = zipSync(zipFiles as Zippable)
  // `slice` on the underlying ArrayBuffer narrows its type to ArrayBuffer,
  // which satisfies the Blob constructor's BlobPart type constraint.
  const zipBuffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  const blob = new Blob([zipBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = zipFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return { errorCount: errors.length, sizeWarning }
}
