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
  ownerRepairContentKey,
  UnverifiedFileMetadataError,
  type ContentPin,
} from './crypto'
import { getToken, getApiUrl, ApiError } from './api'
import { dispatchDecrypted } from './decrypt-events'
import { markOwnerRepairReadOnly } from './owner-repair'

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

function parseHeaderInt(value: string | null): number | null {
  if (!value) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : null
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
 * SF-0002: a version's first frame did not authenticate under the key the
 * caller has. Ask core for the owner key of THAT frame (the caller passes the
 * master key only when it holds one). A key that resolves as `upper_repair`
 * also marks the file read-only for the rest of this session. Null when the
 * frame is not a repaired row, so the caller rethrows the original error.
 */
async function contentKeyFromFrame(
  masterKey: Uint8Array | undefined,
  content: FileContentRef,
  firstChunkFrame: Uint8Array,
): Promise<Uint8Array | null> {
  if (!masterKey) return null
  try {
    const repair = await ownerRepairContentKey(masterKey, content.fileId, firstChunkFrame)
    if (!(repair.key instanceof Uint8Array)) return null
    if (repair.convention === 'upper_repair') markOwnerRepairReadOnly(content.fileId)
    return repair.key
  } catch {
    return null
  }
}

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
  // in files.size_bytes). If encryptedBytes.length === sizeBytes, then
  // sizeBytes IS the encrypted total — subtract chunk overhead to recover
  // the plaintext size. Otherwise, treat sizeBytes as the plaintext size.
  const encryptedTotal = encryptedBytes.length
  const isEncryptedSizeStored = encryptedTotal === sizeBytes
  const effectivePlaintextSize = isEncryptedSizeStored
    ? sizeBytes - chunkCount * CHUNK_OVERHEAD
    : sizeBytes

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
      try {
        decryptedParts.push(await decryptor.pushFrame(frame))
      } catch (err) {
        // SF-0002: only a first frame that fails may resolve as a repaired
        // version; every later frame keeps the key chunk 0 proved.
        const repaired = i === 0 ? await contentKeyFromFrame(masterKey, content, frame) : null
        if (!repaired) throw err
        await decryptor.dispose()
        decryptor = await startDecryptStream(repaired, content.fileId, content.pin)
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

// ─── Streaming infrastructure ───────────────────────

/**
 * Optional progress callback. Reports bytes of plaintext written to the
 * output stream so far, plus the (best-effort) total plaintext size.
 */
export type DownloadProgress = (bytesWritten: number, totalBytes: number | null) => void

export interface EncryptedDownloadOptions {
  onProgress?: DownloadProgress
  signal?: AbortSignal
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
  // Buffer of unconsumed encrypted bytes from the network. We keep it as a
  // growable Uint8Array to avoid per-chunk allocations for small reads.
  let buffer: Uint8Array = new Uint8Array(0)
  let chunkIndex = 0
  let bytesWritten = 0
  let done = false

  const append = (next: Uint8Array) => {
    if (buffer.length === 0) {
      buffer = next
      return
    }
    const merged = new Uint8Array(buffer.length + next.length)
    merged.set(buffer, 0)
    merged.set(next, buffer.length)
    buffer = merged
  }

  const onAbort = () => {
    try { reader.cancel(signal?.reason ?? 'aborted') } catch {}
  }
  if (signal) {
    if (signal.aborted) {
      onAbort()
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

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

      while (buffer.length < encryptedChunkSize && !done) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) { done = true; break }
        if (value && value.length) append(value)
      }
      if (buffer.length < encryptedChunkSize) {
        throw new Error(
          `Chunk ${chunkIndex}: expected ${encryptedChunkSize} bytes, only ${buffer.length} available before stream end`,
        )
      }

      // The whole wire frame (nonce || ciphertext || tag), copied so it owns
      // its buffer (the decryptor transfers it to the crypto worker).
      const frame = buffer.slice(0, encryptedChunkSize)
      // Advance the buffer.
      buffer = buffer.length === encryptedChunkSize
        ? new Uint8Array(0)
        : buffer.slice(encryptedChunkSize)

      let plaintext: Uint8Array
      try {
        plaintext = await decryptor.pushFrame(frame)
      } catch (err) {
        // SF-0002: only chunk 0 may switch keys (to the repaired version's
        // owner key); later frames keep the key chunk 0 proved.
        const repaired = chunkIndex === 0 ? await contentKeyFromFrame(masterKey, content, frame) : null
        if (!repaired) throw err
        await decryptor.dispose()
        decryptor = await startDecryptStream(repaired, content.fileId, content.pin)
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
  } catch (err) {
    if (decryptor) await decryptor.dispose()
    throw err
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
    try { reader.releaseLock() } catch {}
  }
}

// ─── Public API ─────────────────────────────────────

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
  masterKey?: Uint8Array,
): Promise<void> {
  // 1. The file's authenticated metadata: name, MIME type and content pin.
  //    Refused (nothing is downloaded) when it cannot be verified.
  const meta = await openFileMetadata(fileId, fileKey, nameEncryptedJson)
  const filename = meta.name
  // Prefer explicit mimeType arg (legacy files) over encrypted metadata
  const effectiveMime = mimeType || meta.mimeType || 'application/octet-stream'

  // 2. Download the encrypted blob from the API
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/download`, {
    headers,
    signal: opts?.signal,
    credentials: 'include',
  })
  if (!res.ok) {
    throw new ApiError(res.statusText, res.status)
  }

  const effectiveChunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? chunkCount
  const headerChunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size'))
  const effectiveChunkSize = headerChunkSize ?? CHUNK_SIZE

  // Account for the legacy "encrypted total stored in size_bytes" case so the
  // streaming path sees the same plaintext size the buffered path does.
  const contentLengthHeader = parseHeaderInt(res.headers.get('Content-Length'))
  const overhead = effectiveChunkCount * CHUNK_OVERHEAD
  const effectivePlaintextSize = (contentLengthHeader !== null && contentLengthHeader === sizeBytes)
    ? sizeBytes - overhead
    : sizeBytes

  const controller = canStreamToDisk() ? await awaitController() : null

  // ─── Streaming path ──────────────────────────────
  if (controller && res.body) {
    let handles: StreamingDownloadHandles | null = null
    try {
      const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      handles = await startStreamingDownload(id, filename, effectiveMime, effectivePlaintextSize, controller)
      const writer = handles.writer

      const onAbortHandler = () => {
        void handles?.abort(opts?.signal?.reason ?? 'aborted')
      }
      if (opts?.signal) opts.signal.addEventListener('abort', onAbortHandler, { once: true })

      try {
        await pipeDecryptedChunks(
          res.body,
          fileKey,
          meta.content,
          effectiveChunkCount,
          effectivePlaintextSize,
          effectiveChunkSize,
          opts?.signal,
          async chunk => { await writer.write(chunk) },
          opts?.onProgress
            ? (written: number) => opts.onProgress!(written, effectivePlaintextSize)
            : undefined,
          masterKey,
        )
        await handles.close()
      } finally {
        if (opts?.signal) opts.signal.removeEventListener('abort', onAbortHandler)
      }

      dispatchDecrypted(fileId)
      return
    } catch (err) {
      // Stream path failed (registration, transfer, network, abort, ...).
      // Tear down the partial download and propagate the error so callers
      // see the same contract regardless of which path was taken.
      try { await handles?.abort(err) } catch {}
      throw err
    }
  }

  // ─── Fallback (Blob) path ────────────────────────
  if (effectivePlaintextSize > 200 * 1024 * 1024) {
    // Surface a console warning so we can debug user reports; we cannot avoid
    // the in-memory buffer here without SW support.
    // eslint-disable-next-line no-console
    console.warn(
      '[encryptedDownload] Falling back to in-memory download for large file ' +
      `(${(effectivePlaintextSize / 1024 / 1024).toFixed(0)} MB) — browser does not support streaming saves.`,
    )
  }

  const encryptedBlob = await res.arrayBuffer()
  const encryptedBytes = new Uint8Array(encryptedBlob)

  const decrypted = await decryptEncryptedBytes(
    fileKey,
    meta.content,
    encryptedBytes,
    effectiveChunkCount,
    sizeBytes,
    effectiveChunkSize,
    masterKey,
  )

  // Fire a single progress event after decryption so observers still see
  // completion when the SW path was unavailable.
  opts?.onProgress?.(decrypted.length, decrypted.length)

  const blob = new Blob([decrypted as BlobPart], { type: effectiveMime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  dispatchDecrypted(fileId)
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
  masterKey?: Uint8Array,
): Promise<{ plaintext: Blob; filename: string }> {
  const meta = await openFileMetadata(fileId, fileKey, nameEncryptedJson)
  const filename = meta.name
  const blobMime = mimeType || meta.mimeType || 'application/octet-stream'

  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${getApiUrl()}/api/v1/files/${fileId}/download`, { headers, credentials: 'include' })
  if (!res.ok) throw new ApiError(res.statusText, res.status)

  const encryptedBytes = new Uint8Array(await res.arrayBuffer())
  const effectiveChunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? chunkCount
  const effectiveChunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size')) ?? CHUNK_SIZE

  const decrypted = await decryptEncryptedBytes(
    fileKey,
    meta.content,
    encryptedBytes,
    effectiveChunkCount,
    sizeBytes,
    effectiveChunkSize,
    masterKey,
  )

  const plaintext = new Blob([decrypted as BlobPart], { type: blobMime })
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
  masterKey?: Uint8Array,
): Promise<Blob> {
  const meta = await openFileMetadata(fileId, fileKey, nameEncryptedJson)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(
    `${getApiUrl()}/api/v1/files/${fileId}/versions/${versionId}/download`,
    { headers, credentials: 'include' },
  )
  if (!res.ok) throw new ApiError(res.statusText, res.status)

  const encryptedBytes = new Uint8Array(await res.arrayBuffer())
  const effectiveChunkCount = parseHeaderInt(res.headers.get('X-Chunk-Count')) ?? chunkCount
  const effectiveChunkSize = parseHeaderInt(res.headers.get('X-Chunk-Size')) ?? CHUNK_SIZE

  const decrypted = await decryptEncryptedBytes(
    fileKey,
    meta.content,
    encryptedBytes,
    effectiveChunkCount,
    sizeBytes,
    effectiveChunkSize,
    masterKey,
  )

  const plaintext = new Blob([decrypted as BlobPart], { type: mimeType || meta.mimeType || 'application/octet-stream' })
  dispatchDecrypted(fileId)
  return plaintext
}
