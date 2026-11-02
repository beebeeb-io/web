// ─── Encrypted download ────────────────────────────
// Downloads encrypted file data, decrypts chunks + filename, triggers browser download.
//
// For large files the function streams the network response through a
// decrypt-as-you-go pipeline whose output is fed to a Service-Worker-backed
// download URL. The browser then writes the decrypted bytes straight to disk
// without ever buffering the whole file in memory.
//
// Browsers that do not support a controllable service worker or transferable
// ReadableStreams (e.g. Safari < 15.4, in-app browsers, ad-blocker-disabled
// SWs) fall back to the original Blob path.
//
// Every content read here goes through core's pin-aware reader (task 1908 /
// 1943): the file's authenticated metadata is read FIRST with core's FILE
// reader (`readFileMetadata`), which yields the name, the MIME type and the
// file's chunk-format pin; the content is then opened frame by frame by a
// `StreamingDecryptor` bound to that file id and pin, and `finish()` checks the
// file was not cut short. Any failure discards the plaintext already produced.
// The generic no-AAD chunk open (no position, v1 only) is never used for content.

import {
  CHUNK_SIZE,
  readFileMetadata,
  startDecryptStream,
  UnverifiedFileMetadataError,
  type ContentPin,
} from './crypto'
import { getToken, getApiUrl, ApiError } from './api'
import { dispatchDecrypted } from './decrypt-events'
import { mediaKind, TooLargeToPreviewError } from './preview-load-policy'
import type { FrameOpener } from './direct/download'
import { pushHeadWithRepair } from './owner-content-repair'
import { withServerBusyRetry } from './server-busy-retry'

export { UnverifiedFileMetadataError }

/** Which file's content is being read, and how (core 1908). */
export interface FileContentRef {
  /** The id the file was uploaded under: every v2 frame binds it. */
  fileId: string
  /** The chunk-format pin from `readFileMetadata` of this file, never a server field. */
  pin: ContentPin
}

/** Shown when a file's metadata (and so its pin) cannot be verified. */
export const UNVERIFIED_FILE_COPY = "We couldn't verify this file's encrypted details, so we didn't open it."

/**
 * Read a file's authenticated metadata before touching its content: the name
 * and MIME type to save it under, and the pin every content reader of the file
 * needs (core `decrypt_file_metadata`). If it cannot be read (a plaintext or
 * foreign name, an unknown format), the content is not opened at all: falling
 * back to "unrecorded" would let a server that replaced the name re-enable
 * format detection.
 */
export async function openFileMetadata(
  fileId: string,
  fileKey: Uint8Array,
  nameEncryptedJson: string,
): Promise<{ name: string; mimeType: string | null; content: FileContentRef }> {
  try {
    const meta = await readFileMetadata(fileKey, nameEncryptedJson)
    return { name: meta.name, mimeType: meta.mimeType, content: { fileId, pin: meta.pin } }
  } catch (err) {
    throw new UnverifiedFileMetadataError(UNVERIFIED_FILE_COPY, { cause: err })
  }
}

// AES-256-GCM: 12-byte nonce, 16-byte auth tag
const NONCE_LENGTH = 12
const GCM_TAG_LENGTH = 16
const CHUNK_OVERHEAD = NONCE_LENGTH + GCM_TAG_LENGTH

export function parseHeaderInt(value: string | null): number | null {
  if (!value) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * GET an encrypted body (`/api/v1/files/{id}/download`, or one version's
 * `/versions/{vid}/download`) with the session's auth, the way the downloads
 * below do, retrying a `429 server_busy` (task 1870) and honouring `signal`.
 * The response is returned unread; the caller checks `ok`. Used by the
 * SF-0002 write-time check; the download paths below keep their own fetch
 * until they are consolidated (LD-0001 / W1 own them).
 */
export function requestEncryptedBody(path: string, signal?: AbortSignal): Promise<Response> {
  return withServerBusyRetry(() => {
    const headers: Record<string, string> = {}
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    return fetch(`${getApiUrl()}${path}`, { headers, signal, credentials: 'include' })
  }, signal)
}

export function inferChunkCountFromEncryptedSize(
  encryptedSize: number,
  plaintextSize: number,
): number {
  const overheadSize = encryptedSize - plaintextSize
  if (overheadSize <= 0 || overheadSize % CHUNK_OVERHEAD !== 0) {
    throw new Error('Encrypted file size does not match chunk metadata')
  }
  return overheadSize / CHUNK_OVERHEAD
}

/**
 * The one legacy `size_bytes` rule (round-2 review, item 13). An older server
 * stored the ENCRYPTED total in `files.size_bytes`; when the observed ciphertext
 * length equals that value, the plaintext size is the value minus the per-chunk
 * overhead. Both the array-buffer path and the streaming path ask here, so they
 * cannot disagree.
 */
export function plaintextSizeFor(
  sizeBytes: number,
  ciphertextTotal: number | null,
  chunkCount: number,
): number {
  return ciphertextTotal !== null && ciphertextTotal === sizeBytes
    ? sizeBytes - chunkCount * CHUNK_OVERHEAD
    : sizeBytes
}

// SF-0002's repair lives in owner-content-repair.ts (the crypto-worker rule),
// re-exported here because every content reader in this module uses it.
export { pushHeadWithRepair, type ContentDecryptor } from './owner-content-repair'


export async function decryptEncryptedBytes(
  fileKey: Uint8Array,
  content: FileContentRef,
  encryptedBytes: Uint8Array,
  chunkCount: number,
  sizeBytes: number,
  chunkSize = CHUNK_SIZE,
  masterKey?: Uint8Array,
): Promise<Uint8Array> {
  // Detect whether sizeBytes is the plaintext size (legacy/correct) or the
  // encrypted total size (an older server bug stored encrypted blob bytes
  // in files.size_bytes). `plaintextSizeFor` owns that rule for every path.
  const encryptedTotal = encryptedBytes.length
  const effectivePlaintextSize = plaintextSizeFor(sizeBytes, encryptedTotal, chunkCount)

  const decryptedParts: Uint8Array[] = []
  let offset = 0

  let decryptor = await startDecryptStream(fileKey, content.fileId, content.pin)
  try {
    for (let i = 0; i < chunkCount; i++) {
      // Calculate the plaintext size for this chunk
      const isLastChunk = i === chunkCount - 1
      let plaintextSize: number
      if (chunkCount === 1) {
        plaintextSize = effectivePlaintextSize
      } else if (isLastChunk) {
        plaintextSize = effectivePlaintextSize - i * chunkSize
      } else {
        plaintextSize = chunkSize
      }

      // The encrypted chunk size: nonce + plaintext + GCM tag
      const encryptedChunkSize = NONCE_LENGTH + plaintextSize + GCM_TAG_LENGTH

      // Guard: make sure we have enough bytes
      if (offset + encryptedChunkSize > encryptedBytes.length) {
        throw new Error(
          `Chunk ${i}: expected ${encryptedChunkSize} bytes at offset ${offset}, ` +
          `but only ${encryptedBytes.length - offset} remain`,
        )
      }

      // The whole wire frame (nonce || ciphertext || tag), as a copy that owns
      // its buffer: the decryptor transfers it to the crypto worker.
      const frame = encryptedBytes.slice(offset, offset + encryptedChunkSize)
      if (i === 0) {
        // SF-0002: only a first frame that fails may resolve as a repaired
        // version; every later frame keeps the key chunk 0 proved.
        const head = await pushHeadWithRepair(decryptor, frame, fileKey, content, masterKey)
        decryptor = head.decryptor
        decryptedParts.push(head.plaintext)
      } else {
        decryptedParts.push(await decryptor.pushFrame(frame))
      }

      offset += encryptedChunkSize
    }
    // v2: fails when the file ended before its last chunk (truncation).
    await decryptor.finish()
  } catch (err) {
    await decryptor.dispose()
    // A failed read never hands out a prefix: wipe what was already opened.
    for (const part of decryptedParts) part.fill(0)
    throw err
  }

  const totalSize = decryptedParts.reduce((sum, p) => sum + p.length, 0)
  const decrypted = new Uint8Array(totalSize)
  let writeOffset = 0
  for (const part of decryptedParts) {
    decrypted.set(part, writeOffset)
    writeOffset += part.length
    part.fill(0)
  }

  return decrypted
}

// ─── Whole-file progress (LD-0001 PR-C) ─────────────

/**
 * One progress sample for a whole-file preview load. `receivedBytes` counts
 * ciphertext bytes that arrived from the network; `decryptedChunks` counts
 * plaintext parts opened so far. The rule (§7): never report `decrypting`
 * while `receivedBytes < totalBytes`.
 */
export interface TransferProgress {
  phase: 'downloading' | 'decrypting' | 'done'
  receivedBytes: number
  totalBytes: number | null
  decryptedChunks: number
  totalChunks: number
}

export interface WholeFileOptions {
  onProgress?: (p: TransferProgress) => void
  signal?: AbortSignal
  /**
   * SF-0002: the owner master key, held only when the caller resolved an OWNER
   * content key. It lets chunk 0 fall back to the key of a repaired version
   * (see `pushHeadWithRepair`); without it a repaired row simply fails to open.
   */
  masterKey?: Uint8Array
  /**
   * Reject a video/audio file larger than this without fetching the body. The
   * decision is made from the file's AUTHENTICATED metadata (the encrypted
   * name/MIME read before any content), never the caller's UI row.
   */
  mediaCapBytes?: number
  /**
   * The row's legacy server `mime_type` (C5). The cap reads
   * `rowMimeType ?? authenticated MIME` with the authenticated name: exactly
   * the rule the preview's renderer uses, so the two always agree on what is
   * media.
   */
  rowMimeType?: string | null
}

/** Emit at most once per 64 KiB received, plus on every part and phase change. */
const PROGRESS_BYTES_STEP = 64 * 1024

// ─── Streaming infrastructure ───────────────────────

/**
 * Optional progress callback. Reports bytes of plaintext written to the
 * output stream so far, plus the (best-effort) total plaintext size.
 */
export type DownloadProgress = (bytesWritten: number, totalBytes: number | null) => void

export interface EncryptedDownloadOptions {
  onProgress?: DownloadProgress
  signal?: AbortSignal
  /** Download this past version instead of the live file (round 3, C1). */
  versionId?: string
  /**
   * SF-0002: the owner master key, held only when the caller resolved an OWNER
   * content key. It lets chunk 0 fall back to the key of a repaired version.
   */
  masterKey?: Uint8Array
  /**
   * Refuse rather than buffer (round 3, C2): when the browser cannot stream
   * the save to disk (no service-worker controller, no transferable
   * streams), throw TooLargeToDownloadHereError instead of reading the whole
   * body into memory. The over-cap card always sets it.
   */
  neverBuffer?: boolean
}

/** The over-cap Download could not stream to disk in this browser window (C2). */
export class TooLargeToDownloadHereError extends Error {
  constructor() {
    super('This file is too large to download in this browser window. Reload the page and try again.')
    this.name = 'TooLargeToDownloadHereError'
  }
}

/** The whole-body download URL of the live file, or of one past version. */
export function downloadUrlFor(fileId: string, versionId: string | null): string {
  return versionId
    ? `${getApiUrl()}/api/v1/files/${fileId}/versions/${versionId}/download`
    : `${getApiUrl()}/api/v1/files/${fileId}/download`
}

/** True when we believe the streaming path is safe to use. */
function canStreamToDisk(): boolean {
  if (typeof navigator === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (typeof ReadableStream === 'undefined') return false
  if (typeof TransformStream === 'undefined') return false
  // ReadableStream must be transferable via postMessage. Detect heuristically:
  // browsers that support it expose a structured-clone-safe transfer when the
  // ReadableStream is listed in the `transfer` array. We can't probe without
  // actually trying, so we run a tiny self-test once and cache the result.
  return _transferableStreamProbe()
}

let _streamSupportCached: boolean | null = null
function _transferableStreamProbe(): boolean {
  if (_streamSupportCached !== null) return _streamSupportCached
  try {
    const rs = new ReadableStream()
    // structuredClone with transfer is the cleanest probe and avoids a
    // round-trip to the SW.
    structuredClone(rs, { transfer: [rs] })
    _streamSupportCached = true
  } catch {
    _streamSupportCached = false
  }
  return _streamSupportCached
}

/** Resolve to the controlling service worker, waiting briefly if needed. */
async function awaitController(timeoutMs = 1500): Promise<ServiceWorker | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller
  // The SW may be installing on first visit; give it a moment to take control.
  return new Promise<ServiceWorker | null>(resolve => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(navigator.serviceWorker.controller)
    }, timeoutMs)
    const onChange = () => {
      clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(navigator.serviceWorker.controller)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
  })
}

/**
 * Trigger a same-origin navigation to `url` in an invisible iframe so the
 * browser's download manager picks up the response without leaving the page.
 */
function triggerHiddenDownload(url: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = url
  document.body.appendChild(iframe)
  // Most browsers reject the navigation once Content-Disposition is parsed,
  // freeing the iframe. We still remove it after a delay as a safety net.
  setTimeout(() => {
    try { iframe.remove() } catch {}
  }, 30_000)
  return iframe
}

interface StreamingDownloadHandles {
  writer: WritableStreamDefaultWriter<Uint8Array>
  abort(reason?: unknown): Promise<void>
  close(): Promise<void>
}

/**
 * Register a streaming download with the service worker and open the
 * download URL. Returns a writer the caller can pipe decrypted bytes into.
 */
async function startStreamingDownload(
  id: string,
  filename: string,
  mimeType: string,
  totalSize: number | null,
  controller: ServiceWorker,
): Promise<StreamingDownloadHandles> {
  const ts = new TransformStream<Uint8Array, Uint8Array>()
  const readable = ts.readable
  const writer = ts.writable.getWriter()

  // Wait for the SW to ack registration before we trigger the download URL.
  await new Promise<void>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || typeof d !== 'object' || d.id !== id) return
      if (d.type === 'download-registered') {
        navigator.serviceWorker.removeEventListener('message', onMessage)
        resolve()
      } else if (d.type === 'download-error') {
        navigator.serviceWorker.removeEventListener('message', onMessage)
        reject(new Error(typeof d.error === 'string' ? d.error : 'SW download error'))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    try {
      controller.postMessage(
        {
          type: 'register-download',
          id,
          filename,
          mimeType,
          totalSize,
          stream: readable,
        },
        // Transfer the readable side to the SW.
        [readable as unknown as Transferable],
      )
    } catch (err) {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      reject(err)
    }
    // Safety timeout — SW should ack within a few ms.
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve()
    }, 2_000)
  })

  // Now navigate to the SW-served URL.
  triggerHiddenDownload(`/sw-download/${id}`)

  return {
    writer,
    async abort(reason?: unknown) {
      try { await writer.abort(reason) } catch {}
      try { controller.postMessage({ type: 'abort-download', id }) } catch {}
    },
    async close() {
      try { await writer.close() } catch {}
    },
  }
}

/**
 * Stream-decrypt the encrypted body. Pushes each decrypted plaintext chunk
 * to `onChunk`, which is called sequentially in chunk order.
 *
 * Reads bytes from the network ReadableStream and re-frames them into
 * fixed-size encrypted chunks: each chunk is `NONCE_LENGTH +
 * plaintextSize + GCM_TAG_LENGTH` bytes. The last chunk may be smaller.
 *
 * Resolves only after core's end-of-stream check (`finish()`): a v2 file cut
 * short rejects AFTER its earlier chunks were handed to `onChunk`, so the
 * caller must abort its sink (the streaming download) on any rejection.
 */
export async function pipeDecryptedChunks(
  body: ReadableStream<Uint8Array>,
  fileKey: Uint8Array,
  content: FileContentRef,
  chunkCount: number,
  plaintextSize: number,
  chunkSize: number,
  signal: AbortSignal | undefined,
  onChunk: (chunk: Uint8Array) => Promise<void>,
  onProgress: ((bytesWritten: number) => void) | undefined,
  masterKey?: Uint8Array,
): Promise<void> {
  const reader = body.getReader()

  /** Always safe to call; the stream may already be closed or errored. */
  const cancelBody = async (reason?: unknown) => {
    try { await reader.cancel(reason) } catch {}
  }

  if (signal?.aborted) {
    await cancelBody(signal.reason ?? 'aborted')
    try { reader.releaseLock() } catch {}
    throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  }

  const onAbort = () => { void cancelBody(signal?.reason ?? 'aborted') }
  if (signal) signal.addEventListener('abort', onAbort, { once: true })

  // Bytes read from the network but not yet consumed by a frame. Each network
  // read is copied ONCE, straight into the frame being assembled (round-2
  // review, item 1): the old growable buffer re-copied its whole contents on
  // every read, which made a 32 MiB frame quadratic (7.8 s/frame measured).
  let leftover: Uint8Array | null = null
  let chunkIndex = 0
  let bytesWritten = 0
  let streamDone = false

  let decryptor: Awaited<ReturnType<typeof startDecryptStream>> | null = null
  try {
    decryptor = await startDecryptStream(fileKey, content.fileId, content.pin)
    while (chunkIndex < chunkCount) {
      // Determine size of the next encrypted chunk on the wire.
      const isLast = chunkIndex === chunkCount - 1
      let thisPlaintextSize: number
      if (chunkCount === 1) {
        thisPlaintextSize = plaintextSize
      } else if (isLast) {
        thisPlaintextSize = plaintextSize - chunkIndex * chunkSize
      } else {
        thisPlaintextSize = chunkSize
      }
      const encryptedChunkSize = NONCE_LENGTH + thisPlaintextSize + GCM_TAG_LENGTH

      // ONE frame-sized allocation; every read lands directly in it.
      const frame = new Uint8Array(encryptedChunkSize)
      let filled = 0
      while (filled < encryptedChunkSize) {
        if (leftover !== null) {
          const take = Math.min(leftover.byteLength, encryptedChunkSize - filled)
          frame.set(leftover.subarray(0, take), filled)
          filled += take
          leftover = take === leftover.byteLength ? null : leftover.subarray(take)
          continue
        }
        if (streamDone) break
        const { value, done: streamDoneNow } = await reader.read()
        if (streamDoneNow) { streamDone = true; break }
        if (!value || value.byteLength === 0) continue
        leftover = value
      }
      if (filled < encryptedChunkSize) {
        throw new Error(
          `Chunk ${chunkIndex}: expected ${encryptedChunkSize} bytes, only ${filled} available before stream end`,
        )
      }

      let plaintext: Uint8Array
      if (chunkIndex === 0) {
        // SF-0002: only chunk 0 may switch keys (to the repaired version's
        // owner key); later frames keep the key chunk 0 proved.
        const head = await pushHeadWithRepair(decryptor, frame, fileKey, content, masterKey)
        decryptor = head.decryptor
        plaintext = head.plaintext
      } else {
        plaintext = await decryptor.pushFrame(frame)
      }
      await onChunk(plaintext)
      bytesWritten += plaintext.length
      onProgress?.(bytesWritten)
      chunkIndex++
    }
    // v2: fails when the file ended before its last chunk (truncation).
    // finish() consumes the decryptor whatever it returns: nothing to dispose.
    const finishing = decryptor
    decryptor = null
    await finishing.finish()
    // The last frame is in: close the body so a source that streams past the
    // file (or is still open) is released (round-2 review, item 8).
    await cancelBody()
  } catch (err) {
    if (decryptor) await decryptor.dispose()
    // Any error path releases the body, not just the abort handler (item 8).
    await cancelBody(err)
    // An abort is not a truncation: callers and the UI must see AbortError
    // even when the loop ended by hitting the (cancelled) stream end (item 9).
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    throw err
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
    await reader.cancel().catch(() => {})
    try { reader.releaseLock() } catch {}
  }
}

// Import/init failures only select the legacy transport before any bytes arrive.
// Negotiation/auth/version failures retain their existing terminal semantics.
async function directResponse(
  fileKey: Uint8Array,
  content: FileContentRef,
  signal: AbortSignal,
  masterKey?: Uint8Array,
) {
  let transport: typeof import('./direct/download')
  try { transport = await import('./direct/download') }
  catch (error) {
    if (signal.aborted) throw signal.reason ?? error
    return null
  }
  return transport.directResponse(content.fileId, content.pin, signal,
    () => openRepairingStream(fileKey, content, masterKey))
}

/**
 * SF-0002's repair, for the direct path: chunk 0 may switch to the key of a
 * repaired version (see `pushHeadWithRepair`); every later frame keeps the key
 * chunk 0 proved. Without it a repaired row could never be streamed from S3.
 */
async function openRepairingStream(
  fileKey: Uint8Array,
  content: FileContentRef,
  masterKey: Uint8Array | undefined,
): Promise<FrameOpener> {
  let inner = await startDecryptStream(fileKey, content.fileId, content.pin)
  let headPending = true
  return {
    async pushFrame(frame: Uint8Array) {
      if (!headPending) return inner.pushFrame(frame)
      headPending = false
      const head = await pushHeadWithRepair(inner, frame, fileKey, content, masterKey)
      inner = head.decryptor
      return head.plaintext
    },
    finish: () => inner.finish(),
    dispose: () => inner.dispose(),
  }
}

// ─── Whole-file pipelined read ─────────────────────

/**
 * Read a whole-file response through the pipelined decryptor and return the
 * plaintext copy. Ciphertext is counted as it arrives; `onProgress` reports
 * downloading, then decrypting, then done. Every plaintext part is wiped after
 * it is copied into the result, and on any failure (M7).
 */
/**
 * Read a whole response body (the buffered path, C3), reporting the bytes
 * received on the first read and then every PROGRESS_BYTES_STEP.
 */
async function readWholeBody(res: Response, onReceived: (receivedBytes: number) => void): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let received = 0
  let lastReported = -1
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      parts.push(value)
      received += value.byteLength
      if (lastReported < 0 || received - lastReported >= PROGRESS_BYTES_STEP) {
        lastReported = received
        onReceived(received)
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Released already.
    }
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/**
 * The direct transport hands out already-decrypted frames, so a whole-file read
 * reports arrival as `downloading` and then `done`: there is no separate
 * decrypt phase to report, because decryption happened inside the download.
 */
async function readDirectWholeFile(
  res: Response,
  chunkCount: number,
  opts?: WholeFileOptions,
): Promise<Uint8Array> {
  const totalBytes = parseHeaderInt(res.headers.get('Content-Length'))
  const plaintext = await readWholeBody(res, (receivedBytes) => {
    opts?.onProgress?.({
      phase: 'downloading',
      receivedBytes,
      totalBytes,
      decryptedChunks: 0,
      totalChunks: chunkCount,
    })
  })
  opts?.onProgress?.({
    phase: 'done',
    receivedBytes: plaintext.length,
    totalBytes: plaintext.length,
    decryptedChunks: chunkCount,
    totalChunks: chunkCount,
  })
  return plaintext
}

/**
 * No usable Content-Length: read the body whole, then decrypt it. The legacy
 * `size_bytes` rule runs against the REAL body length here (item 4).
 */
async function decryptBufferedResponseBody(
  res: Response,
  fileKey: Uint8Array,
  content: FileContentRef,
  totalChunks: number,
  sizeBytes: number,
  chunkSize: number,
  opts?: WholeFileOptions,
): Promise<Uint8Array> {
  // C3: this path still reports byte progress from the real body (with no
  // total, so the copy says `Downloading 12.4 MB`), and its `done` runs
  // inside the wipe like the pipelined path's.
  const encryptedBytes = await readWholeBody(res, (receivedBytes) => {
    opts?.onProgress?.({ phase: 'downloading', receivedBytes, totalBytes: null, decryptedChunks: 0, totalChunks })
  })
  opts?.onProgress?.({
    phase: 'decrypting',
    receivedBytes: encryptedBytes.length,
    totalBytes: encryptedBytes.length,
    decryptedChunks: 0,
    totalChunks,
  })
  const decrypted = await decryptEncryptedBytes(
    fileKey, content, encryptedBytes, totalChunks, sizeBytes, chunkSize,
    opts?.masterKey,
  )
  try {
    opts?.onProgress?.({
      phase: 'done',
      receivedBytes: encryptedBytes.length,
      totalBytes: encryptedBytes.length,
      decryptedChunks: totalChunks,
      totalChunks,
    })
  } catch (err) {
    decrypted.fill(0)
    throw err
  }
  return decrypted
}

async function decryptWholeFileResponse(
  res: Response,
  fileKey: Uint8Array,
  content: FileContentRef,
  chunkCount: number,
  sizeBytes: number,
  opts?: WholeFileOptions,
): Promise<Uint8Array> {
  const effectiveChunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? chunkCount
  const effectiveChunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size')) ?? CHUNK_SIZE
  const contentLength = parseHeaderInt(res.headers.get('Content-Length'))
  const totalChunks = effectiveChunkCount

  if (!res.body || contentLength === null) {
    return decryptBufferedResponseBody(
      res, fileKey, content, totalChunks, sizeBytes, effectiveChunkSize, opts,
    )
  }

  const totalBytes = contentLength
  const effectivePlaintextSize = plaintextSizeFor(sizeBytes, totalBytes, totalChunks)

  // Allocate the output BEFORE the body is read (round-2 review item 3): peak
  // memory is one plaintext copy plus one part, and an allocation failure now
  // happens before any download starts.
  const out = new Uint8Array(effectivePlaintextSize)
  let writeOffset = 0
  let receivedBytes = 0
  let decryptedChunks = 0
  let lastEmittedBytes = 0
  let lastPhase: TransferProgress['phase'] | null = null

  const phaseNow = (): TransferProgress['phase'] =>
    receivedBytes >= totalBytes ? 'decrypting' : 'downloading'
  const emitNow = (phase: TransferProgress['phase']) => {
    lastEmittedBytes = receivedBytes
    lastPhase = phase
    opts?.onProgress?.({ phase, receivedBytes, totalBytes, decryptedChunks, totalChunks })
  }
  /** The byte throttle applies ONLY to `received` updates (item 5). */
  const emitReceived = () => {
    if (!opts?.onProgress) return
    const phase = phaseNow()
    if (phase === lastPhase && receivedBytes - lastEmittedBytes < PROGRESS_BYTES_STEP) return
    emitNow(phase)
  }
  /** Every decrypted part emits, however small. */
  const emitPart = () => {
    if (opts?.onProgress) emitNow(phaseNow())
  }

  // Ciphertext bytes received. The transform only counts; it never reorders or
  // copies, so pipeDecryptedChunks sees the same bytes it did before.
  const counting = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength
      controller.enqueue(chunk)
      emitReceived()
    },
  })

  // Everything after the first decrypted byte — the `done` emit included —
  // stays inside this try so any throw wipes the whole output (item 3).
  try {
    await pipeDecryptedChunks(
      res.body.pipeThrough(counting),
      fileKey,
      content,
      totalChunks,
      effectivePlaintextSize,
      effectiveChunkSize,
      opts?.signal,
      async (part) => {
        try {
          out.set(part, writeOffset)
        } finally {
          part.fill(0)
        }
        writeOffset += part.length
        decryptedChunks++
        emitPart()
      },
      undefined,
      opts?.masterKey,
    )
    decryptedChunks = totalChunks
    emitNow('done')
  } catch (err) {
    // A failed read never hands out a prefix: wipe everything already copied.
    out.fill(0)
    throw err
  }
  return out
}

// ─── Public API ─────────────────────────────────────

/** The verified file plus its open body, and the sizes both save paths read. */
interface DownloadTarget {
  meta: { name: string; mimeType: string | null; content: FileContentRef }
  filename: string
  mime: string
  direct: boolean
  res: Response
  chunkCount: number
  chunkSize: number
  plaintextSize: number
  controller: ServiceWorker | null
}

/** Verify the metadata, open the body, and read the sizes both save paths need. */
async function openDownloadTarget(
  fileId: string,
  fileKey: Uint8Array,
  nameEncryptedJson: string,
  mimeType: string | null | undefined,
  chunkCount: number,
  sizeBytes: number,
  opts?: EncryptedDownloadOptions,
): Promise<DownloadTarget> {
  // The file's authenticated metadata: name, MIME type and content pin.
  // Refused (nothing is downloaded) when it cannot be verified.
  const meta = await openFileMetadata(fileId, fileKey, nameEncryptedJson)
  // Prefer explicit mimeType arg (legacy files) over encrypted metadata
  const mime = mimeType || meta.mimeType || 'application/octet-stream'

  // C2: a caller that must never buffer learns BEFORE any fetch whether this
  // window can stream the save to disk; if not, nothing is downloaded.
  let knownController: ServiceWorker | null | undefined
  if (opts?.neverBuffer) {
    knownController = canStreamToDisk() ? await awaitController() : null
    if (!knownController) throw new TooLargeToDownloadHereError()
  }

  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const direct = await directResponse(fileKey, meta.content, opts?.signal ?? new AbortController().signal, opts?.masterKey)
  const res = direct ?? await fetch(downloadUrlFor(fileId, opts?.versionId ?? null), {
    headers,
    signal: opts?.signal,
    credentials: 'include',
  })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }

  const effectiveChunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? chunkCount
  const effectiveChunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size')) ?? CHUNK_SIZE

  // Account for the legacy "encrypted total stored in size_bytes" case so the
  // streaming path sees the same plaintext size the buffered path does.
  const contentLengthHeader = parseHeaderInt(res.headers.get('Content-Length'))
  // The direct transport hands out plaintext frames, so its Content-Length is
  // already the plaintext total; the API path needs the legacy size rule.
  const plaintextSize = direct
    ? contentLengthHeader ?? sizeBytes
    : plaintextSizeFor(sizeBytes, contentLengthHeader, effectiveChunkCount)

  const controller =
    knownController !== undefined
      ? knownController
      : canStreamToDisk()
        ? await awaitController()
        : null

  return {
    meta,
    filename: meta.name,
    mime,
    direct: direct !== null,
    res,
    chunkCount: effectiveChunkCount,
    chunkSize: effectiveChunkSize,
    plaintextSize,
    controller,
  }
}

/** Decrypt while the body arrives; each part goes straight to the SW-backed save. */
async function streamTargetToDisk(
  target: DownloadTarget,
  body: ReadableStream<Uint8Array>,
  fileKey: Uint8Array,
  controller: ServiceWorker,
  opts?: EncryptedDownloadOptions,
): Promise<void> {
  let handles: StreamingDownloadHandles | null = null
  try {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    handles = await startStreamingDownload(id, target.filename, target.mime, target.plaintextSize, controller)
    const writer = handles.writer

    const onAbortHandler = () => {
      void handles?.abort(opts?.signal?.reason ?? 'aborted')
    }
    if (opts?.signal) opts.signal.addEventListener('abort', onAbortHandler, { once: true })

    try {
      if (target.direct) {
        let written = 0
        await body.pipeTo(new WritableStream<Uint8Array>({
          async write(chunk) {
            await writer.write(chunk)
            written += chunk.length
            opts?.onProgress?.(written, target.plaintextSize)
          },
        }), { signal: opts?.signal })
      } else await pipeDecryptedChunks(
        body,
        fileKey,
        target.meta.content,
        target.chunkCount,
        target.plaintextSize,
        target.chunkSize,
        opts?.signal,
        async chunk => { await writer.write(chunk) },
        opts?.onProgress
          ? (written: number) => opts.onProgress!(written, target.plaintextSize)
          : undefined,
        opts?.masterKey,
      )
      await handles.close()
    } finally {
      if (opts?.signal) opts.signal.removeEventListener('abort', onAbortHandler)
    }
  } catch (err) {
    // Stream path failed (registration, transfer, network, abort, ...).
    // Tear down the partial download and propagate the error so callers
    // see the same contract regardless of which path was taken.
    try { await handles?.abort(err) } catch {}
    await body.cancel().catch(() => {})
    throw err
  }
}

/** Read the whole body, decrypt it in memory, and trigger the browser save. */
async function saveTargetAsBlob(
  target: DownloadTarget,
  fileKey: Uint8Array,
  sizeBytes: number,
  opts?: EncryptedDownloadOptions,
): Promise<void> {
  const { res, direct, meta, mime, plaintextSize } = target

  if (opts?.neverBuffer) {
    // C2: never fall back to arrayBuffer() on the over-cap path.
    try {
      await res.body?.cancel()
    } catch {
      // Already closed.
    }
    throw new TooLargeToDownloadHereError()
  }
  if (plaintextSize > 200 * 1024 * 1024) {
    // Surface a console warning so we can debug user reports; we cannot avoid
    // the in-memory buffer here without SW support.
    // eslint-disable-next-line no-console
    console.warn(
      '[encryptedDownload] Falling back to in-memory download for large file ' +
      `(${(plaintextSize / 1024 / 1024).toFixed(0)} MB) — browser does not support streaming saves.`,
    )
  }

  const encryptedBlob = await res.arrayBuffer()
  const encryptedBytes = new Uint8Array(encryptedBlob)

  const decrypted = direct ? encryptedBytes : await decryptEncryptedBytes(
    fileKey,
    meta.content,
    encryptedBytes,
    target.chunkCount,
    sizeBytes,
    target.chunkSize,
    opts?.masterKey,
  )

  // Fire a single progress event after decryption so observers still see
  // completion when the SW path was unavailable.
  opts?.onProgress?.(decrypted.length, decrypted.length)

  const blob = new Blob([decrypted as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = target.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Download and decrypt a file, then trigger a browser save dialog.
 *
 * Streaming path: while the encrypted body is still arriving over the wire,
 * each chunk is decrypted and pushed to a Service-Worker-backed download
 * URL. Peak memory usage stays around one chunk size (default 4 MiB).
 *
 * Fallback path: full Blob in memory, for browsers that don't expose a
 * controllable service worker or transferable ReadableStreams.
 *
 * @param fileId              The file's UUID
 * @param fileKey             Per-file encryption key (32 bytes)
 * @param nameEncryptedJson   The encrypted filename JSON ({nonce, ciphertext} base64)
 * @param mimeType            Original MIME type for the download
 * @param chunkCount          Number of encrypted chunks stored on the server
 * @param sizeBytes           Original plaintext file size in bytes
 * @param opts                Optional progress + abort handlers
 */
export async function encryptedDownload(
  fileId: string,
  fileKey: Uint8Array,
  nameEncryptedJson: string,
  mimeType: string | null | undefined,
  chunkCount: number,
  sizeBytes: number,
  opts?: EncryptedDownloadOptions,
): Promise<void> {
  const target = await openDownloadTarget(fileId, fileKey, nameEncryptedJson, mimeType, chunkCount, sizeBytes, opts)
  if (target.controller && target.res.body) {
    await streamTargetToDisk(target, target.res.body, fileKey, target.controller, opts)
  } else {
    await saveTargetAsBlob(target, fileKey, sizeBytes, opts)
  }
  dispatchDecrypted(fileId)
}

/** What the over-cap card's Download streams to disk. */
export interface OverCapDownloadArgs {
  fileId: string
  fileKey: Uint8Array
  nameEncrypted: string
  mimeType: string | null | undefined
  /** null = the live version. */
  versionId: string | null
  chunkCount: number
  sizeBytes: number
}

/**
 * The over-cap card's Download: stream the plaintext to disk through the
 * service worker. `download` is injectable for tests.
 */
export async function streamOverCapDownload(
  args: OverCapDownloadArgs,
  opts: { signal?: AbortSignal; onProgress?: DownloadProgress } = {},
  download: typeof encryptedDownload = encryptedDownload,
): Promise<void> {
  await download(
    args.fileId,
    args.fileKey,
    args.nameEncrypted,
    args.mimeType,
    args.chunkCount,
    args.sizeBytes,
    // C1: a past version streams from its own endpoint; C2: never buffered;
    // C4: cancellable (closing the preview aborts it) and with byte progress.
    {
      versionId: args.versionId ?? undefined,
      neverBuffer: true,
      signal: opts.signal,
      onProgress: opts.onProgress,
    },
  )
}

/**
 * The whole-file media cap. Runs after `openFileMetadata` and before any fetch.
 *
 * Round 3 (C5): "is media" is decided exactly as the preview's renderer
 * decides it, `file.mime_type ?? authenticated MIME`, with the authenticated
 * name for the extension. Round 2 read the authenticated metadata only, so a
 * file the renderer plays as video (legacy row MIME) could escape the cap and
 * be buffered whole. The name is never the caller's UI name.
 */
function guardMediaCap(
  meta: { name: string; mimeType: string | null },
  sizeBytes: number,
  mediaCapBytes: number | undefined,
  rowMimeType: string | null | undefined,
): void {
  if (mediaCapBytes === undefined) return
  if (!(sizeBytes > mediaCapBytes)) return
  const kind = mediaKind(rowMimeType ?? meta.mimeType, meta.name)
  if (kind) throw new TooLargeToPreviewError(kind)
}

/**
 * Download and decrypt a shared file, returning the plaintext blob and filename.
 * Same as encryptedDownload but returns data instead of triggering a browser save.
 */
export async function decryptToBlob(
  fileId: string,
  fileKey: Uint8Array,
  nameEncryptedJson: string,
  mimeType: string | null | undefined,
  chunkCount: number,
  sizeBytes: number,
  opts?: WholeFileOptions,
): Promise<{ plaintext: Blob; filename: string }> {
  const meta = await openFileMetadata(fileId, fileKey, nameEncryptedJson)
  guardMediaCap(meta, sizeBytes, opts?.mediaCapBytes, opts?.rowMimeType)
  const filename = meta.name
  const blobMime = mimeType || meta.mimeType || 'application/octet-stream'

  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const direct = await directResponse(fileKey, meta.content, opts?.signal ?? new AbortController().signal, opts?.masterKey)
  const res = direct ?? await fetch(downloadUrlFor(fileId, null), {
    headers,
    credentials: 'include',
    signal: opts?.signal,
  })
  if (!res.ok) throw new ApiError(res.statusText, res.status)

  const decrypted = direct
    ? await readDirectWholeFile(res, chunkCount, opts)
    : await decryptWholeFileResponse(res, fileKey, meta.content, chunkCount, sizeBytes, opts)

  // C3: the Blob holds its own copy; wipe ours so one plaintext copy is alive.
  const plaintext = new Blob([decrypted as BlobPart], { type: blobMime })
  decrypted.fill(0)
  dispatchDecrypted(fileId)
  return { plaintext, filename }
}

/**
 * Download and decrypt a specific historical version of a file. Mirrors
 * decryptToBlob but hits the per-version endpoint. The version inherits
 * the parent file's mime_type — only the chunked content changes per
 * version, not the file key or filename.
 *
 * `nameEncryptedJson` is the FILE's current `name_encrypted`: every version of
 * a file id is read with the file's one recorded pin (core 1908 — the server
 * keeps one metadata blob per file, and a recorded v2 pin covers every upload
 * of that id).
 */
export async function decryptVersionToBlob(
  fileId: string,
  versionId: string,
  fileKey: Uint8Array,
  nameEncryptedJson: string,
  mimeType: string | null | undefined,
  chunkCount: number,
  sizeBytes: number,
  opts?: WholeFileOptions,
): Promise<Blob> {
  const meta = await openFileMetadata(fileId, fileKey, nameEncryptedJson)
  guardMediaCap(meta, sizeBytes, opts?.mediaCapBytes, opts?.rowMimeType)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(
    `${getApiUrl()}/api/v1/files/${fileId}/versions/${versionId}/download`,
    { headers, credentials: 'include', signal: opts?.signal },
  )
  if (!res.ok) throw new ApiError(res.statusText, res.status)

  const decrypted = await decryptWholeFileResponse(res, fileKey, meta.content, chunkCount, sizeBytes, opts)

  // C3: the Blob holds its own copy; wipe ours so one plaintext copy is alive.
  const plaintext = new Blob([decrypted as BlobPart], { type: mimeType || meta.mimeType || 'application/octet-stream' })
  decrypted.fill(0)
  dispatchDecrypted(fileId)
  return plaintext
}
