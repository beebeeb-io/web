/**
 * Client-side bulk download: decrypts multiple files and packages them as a
 * ZIP archive using fflate's STREAMING `Zip` class.
 *
 * Memory behaviour:
 *   - Files are decrypted one at a time. After each file is pushed into the
 *     archive, the decrypted reference is dropped so the GC can reclaim it.
 *   - The growing ZIP output is streamed to disk via the service worker
 *     download proxy (see `public/sw.js`, task 0462). Each archive chunk
 *     emitted by fflate is enqueued into the SW's response stream and the
 *     reference dropped — no full archive is held in memory.
 *   - Fallback path (no service worker, Safari without transferable streams,
 *     or registration failure): buffer chunks into a Blob and trigger a
 *     normal anchor download. This preserves correctness at the cost of
 *     peak memory (still strictly better than the previous `zipSync`
 *     implementation, which also held every decrypted file simultaneously).
 *
 * Folder selections are expanded recursively, preserving directory structure.
 */

import { Zip, ZipPassThrough, ZipDeflate, strToU8 } from 'fflate'
import { decryptToBlob } from './encrypted-download'
import { listFiles, type DriveFile } from './api'
import { decryptFileMetadata } from './crypto'

// ─── Constants ───────────────────────────────────────────────────────────────

export const ZIP_SIZE_WARNING_BYTES = 1_073_741_824 // 1 GiB

/**
 * Filename extensions whose content is already compressed. We skip DEFLATE
 * for these to save CPU and a bit of overhead — re-deflating an MP4 or
 * encrypted blob produces no meaningful size reduction.
 */
const INCOMPRESSIBLE_EXT = /\.(zip|gz|bz2|zst|7z|rar|png|jpg|jpeg|webp|mp4|mov|mkv|pdf)$/i

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkDownloadOptions {
  /** Called after each file is processed. */
  onProgress?: (done: number, total: number, currentName: string) => void
  /** Name for the output zip file (default: beebeeb-files.zip). */
  zipFilename?: string
  /** Override the archive destination (tests, and callers that own a sink). */
  sink?: ZipSink
}

/**
 * The three capabilities the packager needs. The owner drive and a folder-link
 * guest differ only in how they list children, resolve a key and fetch
 * plaintext, so both share one zip implementation.
 */
export interface BulkDownloadPorts {
  listChildren(folderId: string): Promise<DriveFile[]>
  getFileKey(file: DriveFile): Promise<Uint8Array>
  decryptToBlob(
    file: DriveFile,
    fileKey: Uint8Array,
  ): Promise<{ plaintext: Blob; filename: string }>
}

export interface BulkDownloadResult {
  /** Number of files that failed to decrypt / download. */
  errorCount: number
  /** True if the estimated total size exceeded the warning threshold. */
  sizeWarning: boolean
}

// ─── Folder expansion ─────────────────────────────────────────────────────────

export interface QueueEntry {
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
  ports: BulkDownloadPorts,
  prefix = '',
  onListError?: (prefix: string, err: unknown) => void,
): Promise<QueueEntry[]> {
  const queue: QueueEntry[] = []

  for (const item of items) {
    if (!item.is_folder) {
      queue.push({ file: item, prefix })
      continue
    }

    // Decrypt folder name for the path (folders never use the request-key path,
    // but ports.getFileKey handles that branch transparently).
    let folderName = `folder-${item.id.slice(0, 8)}`
    try {
      const key = await ports.getFileKey(item)
      const { name } = await decryptFileMetadata(key, item.name_encrypted)
      folderName = name
    } catch {
      // Use fallback name — continue rather than failing the whole zip
    }

    // Sanitise for zip path (no slashes inside segment names)
    const safeName = folderName.replace(/[/\\]/g, '_')
    const childPrefix = `${prefix}${safeName}/`

    let children: DriveFile[] = []
    try {
      children = await ports.listChildren(item.id)
    } catch (err) {
      // A folder we cannot list contributes no entries. The caller decides
      // whether that is silently tolerated (owner drive) or an error (guest).
      onListError?.(childPrefix, err)
    }
    const nested = await expandToFiles(children, ports, childPrefix, onListError)
    queue.push(...nested)
  }

  return queue
}

/** Expand a selection into the exact files the archive will carry. */
export async function expandDownloadEntries(
  items: DriveFile[],
  ports: BulkDownloadPorts,
  prefix = '',
  onListError?: (prefix: string, err: unknown) => void,
): Promise<QueueEntry[]> {
  return expandToFiles(items, ports, prefix, onListError)
}

/** One archive path per file; a repeat gets " (2)", " (3)" instead of clobbering. */
export function uniqueZipPath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path)
    return path
  }
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let n = 2
  let candidate = `${dir}${stem} (${n})${ext}`
  while (used.has(candidate)) {
    n += 1
    candidate = `${dir}${stem} (${n})${ext}`
  }
  used.add(candidate)
  return candidate
}

// ─── Service-worker streaming download (0462) ────────────────────────────────

/**
 * Holds the destination for ZIP archive bytes. Two implementations: a
 * service-worker stream (preferred — bytes go straight to disk) and a
 * buffered Blob fallback (chunks accumulate in memory, anchor click at end).
 */
export interface ZipSink {
  /** True when the archive accumulates in memory (no streaming to disk). */
  buffered?: boolean
  /** Write a chunk of ZIP bytes. */
  write(chunk: Uint8Array): Promise<void>
  /** Mark the archive complete. */
  close(): Promise<void>
  /** Abort the archive (cancel the stream / discard buffered chunks). */
  abort(reason: string): Promise<void>
}

/** Detect whether we can transfer a ReadableStream to a service worker. */
function canStreamToServiceWorker(): boolean {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (typeof ReadableStream === 'undefined') return false
  // Safari did not support transferable streams until quite recently; the
  // safest feature test is to attempt a transfer with a tiny throwaway
  // stream in a try/catch. We do that lazily inside `createSwSink`.
  return true
}

/**
 * Attempt to wire up a service-worker mediated streaming download. Returns
 * null if the SW is not available, not yet controlling the page, or doesn't
 * support transferable streams.
 */
async function createSwSink(
  filename: string,
  mimeType: string,
): Promise<ZipSink | null> {
  if (!canStreamToServiceWorker()) return null

  let registration: ServiceWorkerRegistration | undefined
  try {
    registration = await navigator.serviceWorker.ready
  } catch {
    return null
  }
  const worker = registration.active ?? navigator.serviceWorker.controller
  if (!worker) return null

  // Generate a download ID.
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`

  // Build the ReadableStream that the SW will consume. We retain the
  // controller so `write` / `close` / `abort` can drive it from the page.
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  // Wait for the SW to acknowledge registration (so we know it has the
  // stream before we navigate to the URL).
  const ackPromise = new Promise<boolean>((resolve) => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data
      if (!data || typeof data !== 'object' || data.id !== id) return
      if (data.type === 'download-registered') {
        navigator.serviceWorker.removeEventListener('message', onMessage)
        resolve(true)
      } else if (data.type === 'download-error') {
        navigator.serviceWorker.removeEventListener('message', onMessage)
        resolve(false)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    // Timeout — if no ack in 2 s, treat as failure and fall back.
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve(false)
    }, 2000)
  })

  // Try to transfer the stream. Browsers without transferable-stream
  // support throw a DataCloneError here.
  try {
    worker.postMessage(
      { type: 'register-download', id, filename, mimeType, stream },
      [stream as unknown as Transferable],
    )
  } catch {
    try { controller.error(new Error('stream transfer not supported')) } catch { /* noop */ }
    return null
  }

  const acked = await ackPromise
  if (!acked) {
    try { controller.error(new Error('sw registration failed')) } catch { /* noop */ }
    return null
  }

  // Trigger the browser download by opening the registered URL in an
  // invisible iframe. Using an iframe instead of an anchor avoids
  // navigating away if the SW returns 404 for any reason.
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = `/sw-download/${id}`
  document.body.appendChild(iframe)
  // Best-effort cleanup once the download is well underway.
  setTimeout(() => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
  }, 30_000)

  return {
    async write(chunk) {
      controller.enqueue(chunk)
      // Apply soft backpressure — if the SW's reader has fallen behind,
      // wait for the queue to drain a bit before pushing more.
      if (controller.desiredSize !== null && controller.desiredSize < 0) {
        await new Promise<void>((r) => setTimeout(r, 0))
      }
    },
    async close() {
      try { controller.close() } catch { /* already closed */ }
    },
    async abort(reason) {
      try { controller.error(new Error(reason)) } catch { /* noop */ }
      try { worker.postMessage({ type: 'abort-download', id }) } catch { /* noop */ }
    },
  }
}

/** Fallback sink: buffer everything into an array of Uint8Array chunks and
 *  build a Blob on `close()`. */
function createBlobSink(filename: string, mimeType: string): ZipSink {
  const chunks: Uint8Array[] = []
  let aborted = false
  return {
    buffered: true,
    async write(chunk) {
      if (!aborted) chunks.push(chunk)
    },
    async close() {
      if (aborted) return
      const blob = new Blob(chunks as BlobPart[], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    },
    async abort() {
      aborted = true
      chunks.length = 0
    },
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** A single file the packager will place in the archive. */
export interface ZipSource {
  /** Archive path for the resolved filename (folder prefixes already applied). */
  pathFor: (filename: string) => string
  /** Name shown while the file is still being decrypted. */
  fallbackName: string
  /** Resolve the plaintext at write time so only one file is held at a time. */
  load: () => Promise<{ plaintext: Blob; filename: string }>
  /**
   * Optional: stream the plaintext into the archive chunk by chunk instead of
   * loading the whole file, so memory stays at about one chunk. The filename
   * must be known up front (it names the entry before any byte is written).
   */
  streamTo?: {
    filename: string
    open: (push: (chunk: Uint8Array) => Promise<void>) => Promise<void>
  }
}

export interface PackageZipOptions extends BulkDownloadOptions {
  /** Caller's size estimate, used for the 1 GiB warning and `bufferedLimitBytes`. */
  totalEstimatedBytes?: number
  /**
   * Refuse, before anything is fetched, an archive larger than this when the
   * only available sink buffers the whole zip in memory (no service-worker
   * streaming in this browser). Unset: no limit (the owner drive's behaviour).
   */
  bufferedLimitBytes?: number
  /** The message of the `ZipTooLargeError` thrown for `bufferedLimitBytes`. */
  bufferedLimitMessage?: string
}

/** The archive is over `bufferedLimitBytes` and this browser cannot stream it. */
export class ZipTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipTooLargeError'
  }
}

/**
 * Assemble a streamed ZIP from `sources`, decrypting each file as it is added.
 *
 * This is the single archive implementation: the owner drive and a folder-link
 * guest differ only in where the sources come from.
 */
export async function packageZip(
  sources: ZipSource[],
  options: PackageZipOptions = {},
): Promise<BulkDownloadResult> {
  const {
    onProgress,
    zipFilename = 'beebeeb-files.zip',
    sink: overrideSink,
    totalEstimatedBytes = 0,
    bufferedLimitBytes,
    bufferedLimitMessage,
  } = options

  if (sources.length === 0) {
    return { errorCount: 0, sizeWarning: false }
  }

  const sizeWarning = totalEstimatedBytes > ZIP_SIZE_WARNING_BYTES

  // ── Choose sink: SW streaming preferred, Blob fallback otherwise ─────────
  const sink: ZipSink =
    overrideSink ??
    (await createSwSink(zipFilename, 'application/zip').catch(() => null)) ??
    createBlobSink(zipFilename, 'application/zip')

  if (bufferedLimitBytes !== undefined && sink.buffered && totalEstimatedBytes > bufferedLimitBytes) {
    await sink.abort('too-large').catch(() => {})
    throw new ZipTooLargeError(
      bufferedLimitMessage ?? 'This archive is too large to build in this browser.',
    )
  }

  // ── Streaming ZIP assembly ───────────────────────────────────────────────
  // fflate's `Zip` emits chunks via `ondata(err, chunk, final)` as files are
  // added and finalised. We forward each chunk to the sink. Decrypted file
  // bytes are pushed into per-file streams and the references dropped.

  const errors: string[] = []
  const usedZipPaths = new Set<string>()

  let zipError: Error | null = null
  let zipDone = false
  let resolveDone!: () => void
  const donePromise = new Promise<void>((resolve) => { resolveDone = resolve })

  // Sink writes from inside `archive.ondata` happen synchronously w.r.t.
  // fflate but async w.r.t. the SW. We chain them so back-pressure is
  // respected; otherwise the SW stream queue could grow unboundedly.
  let sinkChain: Promise<void> = Promise.resolve()
  const enqueue = (chunk: Uint8Array) => {
    sinkChain = sinkChain.then(() => sink.write(chunk)).catch((err) => {
      if (!zipError) zipError = err instanceof Error ? err : new Error(String(err))
    })
  }

  const archive = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err
      if (!zipDone) {
        zipDone = true
        resolveDone()
      }
      return
    }
    if (chunk && chunk.length > 0) {
      enqueue(chunk)
    }
    if (final && !zipDone) {
      zipDone = true
      resolveDone()
    }
  })

  /** Push a decrypted buffer through a fresh stream entry and wait for it
   *  to fully drain. We await per-entry so backpressure is preserved and
   *  the previous file's bytes are eligible for GC before we decrypt the
   *  next one. */
  function addEntry(zipPath: string, bytes: Uint8Array, compress: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry = compress
        ? new ZipDeflate(zipPath, { level: 1 })
        : new ZipPassThrough(zipPath)
      // The per-file `ondata` is wired by fflate when we call archive.add().
      // We override it AFTER add() so we can observe per-file completion.
      archive.add(entry)
      const wrapped = entry.ondata
      entry.ondata = (err, dat, final) => {
        wrapped.call(entry, err, dat, final)
        if (err) reject(err)
        else if (final) resolve()
      }
      // Push the whole decrypted buffer in one go (final=true). For very
      // large files we could chunk this further, but the per-chunk
      // decryption already produced a single Uint8Array — chunking it
      // again here would not reduce peak memory for this file.
      try {
        entry.push(bytes, true)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /** Stream one source into a fresh entry, chunk by chunk, waiting for the
   *  sink after every chunk so at most about one chunk is in flight. The entry
   *  is created on the first chunk: a wrong key or a gone file (which fail
   *  before any plaintext) leaves no partial entry behind. */
  async function streamEntry(
    source: ZipSource & { streamTo: NonNullable<ZipSource['streamTo']> },
  ): Promise<void> {
    const filename = source.streamTo.filename
    const zipPath = uniqueZipPath(source.pathFor(filename), usedZipPaths)
    const compress = !INCOMPRESSIBLE_EXT.test(filename)
    let entry: ZipDeflate | ZipPassThrough | null = null
    let finished: Promise<void> | null = null
    const begin = (): ZipDeflate | ZipPassThrough => {
      const created = compress ? new ZipDeflate(zipPath, { level: 1 }) : new ZipPassThrough(zipPath)
      archive.add(created)
      finished = new Promise<void>((resolve, reject) => {
        const wrapped = created.ondata
        created.ondata = (err, dat, final) => {
          wrapped.call(created, err, dat, final)
          if (err) reject(err)
          else if (final) resolve()
        }
      })
      entry = created
      return created
    }
    try {
      await source.streamTo.open(async (chunk) => {
        const target = entry ?? begin()
        target.push(chunk, false)
        await sinkChain
        if (zipError) throw zipError
      })
      const target = entry ?? begin()
      target.push(new Uint8Array(0), true)
      await finished
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      const started = entry as ZipDeflate | ZipPassThrough | null
      if (started) {
        // Bytes already went out: close the entry so the archive stays valid,
        // and say plainly that this copy is cut short.
        try {
          started.push(new Uint8Array(0), true)
          await finished
        } catch { /* the error manifest below still names it */ }
        throw new Error(`incomplete in this zip (${msg})`)
      }
      throw err
    }
  }

  // ── Decrypt + write each file sequentially ───────────────────────────────
  for (let i = 0; i < sources.length; i++) {
    if (zipError) break
    const source = sources[i]

    // Placeholder name while we decrypt
    const fallbackPath = source.pathFor(source.fallbackName)
    onProgress?.(i, sources.length, source.fallbackName)

    if (source.streamTo) {
      try {
        await streamEntry(source as ZipSource & { streamTo: NonNullable<ZipSource['streamTo']> })
        onProgress?.(i + 1, sources.length, source.streamTo.filename)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`${fallbackPath}: ${msg}`)
        onProgress?.(i + 1, sources.length, source.fallbackName)
      }
      continue
    }

    try {
      const { plaintext, filename } = await source.load()

      // Materialise into a Uint8Array for fflate, then drop the Blob.
      let bytes: Uint8Array | null = new Uint8Array(await plaintext.arrayBuffer())

      // Deduplicate zip paths — if a name already exists (e.g. two files
      // called "report.pdf" in the same folder), number the later ones.
      const zipPath = uniqueZipPath(source.pathFor(filename), usedZipPaths)

      const compress = !INCOMPRESSIBLE_EXT.test(filename)
      await addEntry(zipPath, bytes, compress)

      // Drop our reference — fflate has already processed the data and
      // emitted the corresponding zip chunks via the archive `ondata`.
      bytes = null

      onProgress?.(i + 1, sources.length, filename)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${fallbackPath}: ${msg}`)
      onProgress?.(i + 1, sources.length, source.fallbackName)
    }
  }

  // ── Append error manifest if any downloads failed ─────────────────────────
  if (errors.length > 0 && !zipError) {
    const lines = [
      'The following files could not be downloaded:',
      '',
      ...errors,
      '',
      'Try downloading them individually from the Beebeeb web app.',
    ]
    try {
      await addEntry('_errors.txt', strToU8(lines.join('\n')), true)
    } catch {
      // If even the error manifest fails to add, fall through to end().
    }
  }

  // ── Finalise archive ──────────────────────────────────────────────────────
  archive.end()
  await donePromise
  // Make sure every chunk has been written to the sink before closing it.
  await sinkChain

  if (zipError) {
    await sink.abort('zip-error').catch(() => {})
    throw zipError
  }

  await sink.close()

  return { errorCount: errors.length, sizeWarning }
}

/** The owner drive's sources: the vault's own list and decrypt routes. */
export function ownerDownloadPorts(
  getFileKeyForFile: (file: DriveFile) => Promise<Uint8Array>,
  masterKey?: Uint8Array,
): BulkDownloadPorts {
  if (!masterKey) return { ...OWNER_DOWNLOAD_PORTS, getFileKey: getFileKeyForFile }
  return {
    ...OWNER_DOWNLOAD_PORTS,
    getFileKey: getFileKeyForFile,
    decryptToBlob: (file, fileKey) =>
      decryptToBlob(
        file.id,
        fileKey,
        file.name_encrypted,
        file.mime_type ?? undefined,
        file.chunk_count,
        file.size_bytes,
        masterKey,
      ),
  }
}

/**
 * The two ports that do not need the vault's key context. `getFileKey` throws
 * here on purpose: an owner key comes from the unlocked vault, never from a
 * module-level default, so callers go through `ownerDownloadPorts`.
 */
export const OWNER_DOWNLOAD_PORTS: BulkDownloadPorts = {
  listChildren: (folderId) => listFiles(folderId),
  getFileKey: async () => {
    throw new Error('The owner file key must be supplied by the caller (use ownerDownloadPorts).')
  },
  decryptToBlob: (file, fileKey) =>
    decryptToBlob(
      file.id,
      fileKey,
      file.name_encrypted,
      file.mime_type ?? undefined,
      file.chunk_count,
      file.size_bytes,
    ),
}

/**
 * Download and decrypt `items` through the given ports, then package them into
 * a ZIP file and trigger a browser download.
 *
 * - Folders: expanded recursively, structure preserved in zip paths.
 * - Failed files: skipped, listed in `_errors.txt` inside the zip.
 * - Size > 1 GiB: `sizeWarning: true` in the result (caller shows warning).
 */
export async function downloadAsZipWith(
  ports: BulkDownloadPorts,
  items: DriveFile[],
  options: BulkDownloadOptions = {},
): Promise<BulkDownloadResult> {
  const entries = await expandToFiles(items, ports)
  const totalEstimatedBytes = entries.reduce((s, e) => s + (e.file.size_bytes ?? 0), 0)

  return packageZip(
    entries.map(({ file, prefix }) => ({
      pathFor: (filename: string) => `${prefix}${filename}`,
      fallbackName: `file-${file.id.slice(0, 8)}`,
      load: async () => {
        const key = await ports.getFileKey(file)
        return ports.decryptToBlob(file, key)
      },
    })),
    { ...options, totalEstimatedBytes },
  )
}

/**
 * Download and decrypt `items`, then package them into a ZIP file and
 * trigger a browser download. Owner-vault shorthand for `downloadAsZipWith`.
 *
 * - Single non-folder file: just calls regular download (no zip overhead).
 *   Callers should handle this case before calling `downloadAsZip` if
 *   they want the single-file fast path.
 *
 * @param items      - DriveFile objects (may include folders)
 * @param getFileKeyForFile - async function that returns the decryption key for a
 *                            DriveFile (handles the request-key path for received files)
 * @param options    - progress callback and output filename
 */
export async function downloadAsZip(
  items: DriveFile[],
  getFileKeyForFile: (file: DriveFile) => Promise<Uint8Array>,
  options: BulkDownloadOptions = {},
  masterKey?: Uint8Array,
): Promise<BulkDownloadResult> {
  return downloadAsZipWith(ownerDownloadPorts(getFileKeyForFile, masterKey), items, options)
}
