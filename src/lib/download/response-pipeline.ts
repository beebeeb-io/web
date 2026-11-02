// Response and repair pipeline for encrypted downloads.
//
// Extracted from src/lib/encrypted-download.ts. Covers the direct transport
// selection, the head-frame repair opener, and the whole-file buffered and
// pipelined response readers.

import { CHUNK_SIZE, startDecryptStream } from '../crypto'
import { pushHeadWithRepair } from '../owner-content-repair'
import {
  decryptEncryptedBytes,
  parseHeaderInt,
  pipeDecryptedChunks,
  plaintextSizeFor,
} from '../encrypted-download'
import type { FileContentRef, TransferProgress, WholeFileOptions } from '../encrypted-download'
import type { FrameOpener } from '../direct/download'

/** Emit at most once per 64 KiB received, plus on every part and phase change. */
const PROGRESS_BYTES_STEP = 64 * 1024

// Import/init failures only select the legacy transport before any bytes arrive.
// Negotiation/auth/version failures retain their existing terminal semantics.
export async function directResponse(
  fileKey: Uint8Array,
  content: FileContentRef,
  signal: AbortSignal,
  masterKey?: Uint8Array,
) {
  let transport: typeof import('../direct/download')
  try { transport = await import('../direct/download') }
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
export async function readDirectWholeFile(
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

export async function decryptWholeFileResponse(
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
