/**
 * LD-0001 PR-A: the random-access stream session (contract §3, §5, §6).
 *
 * It owns:
 *  - setup: chunk 0 and the tail fetched in parallel (both pinned), chunk 0
 *    opened sequentially (the only place a repair key may ever be tried), then
 *    a worker-owned reader handle; the tail opened with `is_last = true`;
 *  - every count/size cross-check from §5.2-5.4 before `src` is allowed;
 *  - an LRU of decrypted chunks bounded by the §3 budget, with read-ahead for
 *    the most recent pull;
 *  - stateless, offset-addressed reads that never cross a chunk boundary and
 *    never exceed 1 MiB;
 *  - terminal error classes (`auth`, `changed`, `network`) with wipes.
 *
 * It knows nothing about the Service Worker or the player: no UI, no
 * `MessagePort`, no component. Keys never leave this module or the worker.
 */
import type { ContentPin } from '../content-crypto'
import { startDecryptStream, createChunkReader, type ChunkReader } from '../crypto'
import type { FileContentRef } from '../encrypted-download'
import { ApiError } from '../api'
import {
  CHUNK_OVERHEAD,
  chunkForOffset,
  streamBounds,
  type StreamBounds,
} from './bounds'
import {
  realClock,
  StreamChangedError,
  type ChunkFrameSource,
  type Clock,
} from './source'

/** At most this many plaintext bytes cross in one `data` message (contract §3). */
export const MAX_MESSAGE_BYTES = 1024 * 1024

const MiB = 1024 * 1024
const RETRY_ATTEMPTS = 3
const RETRY_BACKOFF_MS = 400

export type StreamErrorKind = 'auth' | 'changed' | 'network'

/** A terminal session error. It carries a kind and at most a chunk index — never plaintext or keys (M6). */
export class StreamSessionError extends Error {
  readonly kind: StreamErrorKind
  readonly index?: number

  constructor(kind: StreamErrorKind, message: string, index?: number, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StreamSessionError'
    this.kind = kind
    this.index = index
  }
}

export type StreamEvent =
  | { type: 'received'; bytes: number }
  | { type: 'verified'; index: number }
  | { type: 'error'; kind: StreamErrorKind; index: number }

/** What the session needs from a reader: open one frame at its own index. */
export interface StreamReader {
  openAt(index: number, isLast: boolean, frame: Uint8Array): Promise<Uint8Array>
  close(): Promise<void>
}

export interface StreamHeadArgs {
  fileKey: Uint8Array
  fileId: string
  pin: ContentPin
  headFrame: Uint8Array
  /**
   * Try the SF-0002 owner-repair key for chunk 0 and return it, or `null` when
   * there is none. Passed ONLY for setup's chunk 0 (A25). It stays undefined
   * until web #204 lands; the session never invents a repair path for a tail or
   * a later chunk.
   */
  repair?: (frame: Uint8Array) => Promise<Uint8Array | null>
}

export interface StreamReaderSetup {
  reader: StreamReader
  /** Chunk 0's plaintext, already opened by the factory. */
  headPlaintext: Uint8Array
  /** The page's copy of the repaired key, wiped as soon as the reader exists. */
  repairedKey?: Uint8Array
}

export type StreamReaderFactory = (args: StreamHeadArgs) => Promise<StreamReaderSetup>

/** The row fields the session needs (`download_version` is absent on older responses). */
export interface StreamRow {
  chunk_count: number
  size_bytes: number
  download_version: {
    object_version_id: string
    version_number: number
    chunk_count: number
    chunk_size_bytes: number
    plaintext_size_bytes: number
    ciphertext_size_bytes: number
    chunks: Array<{ index: number; size_bytes: number }>
  } | null
}

/** Test-only observation of the cache buffers (proves the wipes in T12). */
export interface StreamObserver {
  onChunkCached?(index: number, buffer: Uint8Array): void
  onChunkWiped?(index: number, buffer: Uint8Array): void
}

export interface OpenStreamOptions {
  fileId: string
  fileKey: Uint8Array
  /** Reserved for the SF-0002 repair path (web #204); unused until it lands. */
  masterKey?: Uint8Array
  /** From `openFileMetadata`: the file id and the authenticated content pin. */
  content: FileContentRef
  row: StreamRow
  source: ChunkFrameSource
  clock?: Clock
  /** Production: the crypto worker. Tests: the same ops in process. */
  readerFactory?: StreamReaderFactory
  /** SF-0002 chunk-0 repair, tried only for setup's chunk 0. */
  repair?: (frame: Uint8Array) => Promise<Uint8Array | null>
  observer?: StreamObserver
}

export interface StreamSession {
  /** Plaintext size computed from the opened head and tail. */
  readonly totalSize: number
  readonly chunkCount: number
  /** S: chunk 0's wire size − 28. */
  readonly chunkSize: number
  /** Distinct chunk indices opened successfully in this session. */
  readonly verified: ReadonlySet<number>
  /**
   * Read at most `min(max, 1 MiB, the rest of the chunk)` plaintext bytes at
   * `offset`. Never crosses a chunk boundary. Returns a fresh copy.
   */
  read(reqId: string, offset: number, max: number): Promise<Uint8Array>
  close(): Promise<void>
  onEvent(cb: (event: StreamEvent) => void): () => void
  /** Plaintext bytes currently retained in the cache (bounded by the §3 budget). */
  retainedBytes(): number
}

/**
 * Production reader factory: sequential chunk-0 open in the worker (with the
 * #204 repair hook when one is supplied), then the worker hands back a
 * random-access handle. The decryptor is consumed by `createChunkReader`.
 */
export const workerReaderFactory: StreamReaderFactory = async ({
  fileKey,
  fileId,
  pin,
  headFrame,
  repair,
}) => {
  let key = fileKey
  let repairedKey: Uint8Array | undefined
  let decryptor = await startDecryptStream(key, fileId, pin)
  let headPlaintext: Uint8Array
  try {
    headPlaintext = await decryptor.pushFrame(headFrame)
  } catch (err) {
    await decryptor.dispose()
    if (!repair) throw err
    const repaired = await repair(headFrame)
    if (!repaired) throw err
    key = repaired
    repairedKey = repaired
    decryptor = await startDecryptStream(key, fileId, pin)
    headPlaintext = await decryptor.pushFrame(headFrame)
  }
  let reader: ChunkReader
  try {
    reader = await createChunkReader(decryptor)
  } catch (err) {
    await decryptor.dispose()
    throw err
  }
  return { reader, headPlaintext, repairedKey }
}

function isTerminal(err: unknown): err is StreamSessionError {
  return err instanceof StreamSessionError
}

/** Map a source/worker/HTTP failure to a terminal class, or `null` when it is transient. */
function classify(err: unknown, index: number): StreamSessionError | null {
  if (isTerminal(err)) return err
  if (err instanceof StreamChangedError) {
    return new StreamSessionError('changed', `chunk ${index}: ${err.message}`, index, { cause: err })
  }
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return new StreamSessionError('changed', `chunk ${index}: the file changed`, index, { cause: err })
    }
    if (err.status === 401 || err.status === 403) {
      return new StreamSessionError('auth', `chunk ${index}: not authorized`, index, { cause: err })
    }
    // Any other client refusal is permanent: retrying would not make the
    // server serve a chunk it says does not exist (A3).
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      return new StreamSessionError('auth', `chunk ${index}: refused with ${err.status}`, index, { cause: err })
    }
    return null
  }
  return null
}

export async function openStreamSession(opts: OpenStreamOptions): Promise<StreamSession> {
  const clock = opts.clock ?? realClock
  const factory = opts.readerFactory ?? workerReaderFactory
  const N = opts.row.chunk_count
  const fileId = opts.content.fileId
  const pin = opts.content.pin

  if (!Number.isInteger(N) || N < 1) {
    throw new StreamSessionError('auth', `invalid chunk count ${N}`)
  }
  if (opts.row.download_version && opts.row.download_version.chunk_count !== N) {
    throw new StreamSessionError(
      'auth',
      'chunk count disagrees with download_version',
    )
  }
  if (opts.content.fileId !== opts.fileId) {
    throw new StreamSessionError('auth', 'content file id disagrees with the stream file id')
  }

  // ── Session state ──────────────────────────────────────────────────────────
  let closed = false
  let terminal: StreamSessionError | null = null
  let setupReader: StreamReader | null = null
  let bounds: StreamBounds = streamBounds(MiB)
  let chunkSize = 0
  let retained = 0

  const listeners = new Set<(event: StreamEvent) => void>()
  const cache = new Map<number, Uint8Array>()
  const refs = new Map<number, number>()
  const pendingFetches = new Map<number, Promise<Uint8Array>>()
  const controllers = new Set<AbortController>()
  const prefetchControllers = new Map<number, AbortController>()
  const verified = new Set<number>()

  const emit = (event: StreamEvent): void => {
    for (const cb of listeners) {
      try {
        cb(event)
      } catch {
        // A listener must never break the stream.
      }
    }
  }

  const closedError = (): StreamSessionError =>
    new StreamSessionError('network', 'stream session closed')

  const wipeCache = (): void => {
    for (const [index, buffer] of cache) {
      opts.observer?.onChunkWiped?.(index, buffer)
      buffer.fill(0)
    }
    cache.clear()
    retained = 0
  }

  const fail = (err: StreamSessionError): void => {
    if (terminal) return
    terminal = err
    for (const controller of controllers) controller.abort(err)
    controllers.clear()
    prefetchControllers.clear()
    wipeCache()
    emit({ type: 'error', kind: err.kind, index: err.index ?? 0 })
    if (setupReader) void setupReader.close().catch(() => {})
  }

  const acquire = (index: number): void => {
    refs.set(index, (refs.get(index) ?? 0) + 1)
  }
  const release = (index: number): void => {
    const n = (refs.get(index) ?? 0) - 1
    if (n <= 0) refs.delete(index)
    else refs.set(index, n)
  }

  const evict = (): void => {
    while (retained > bounds.budgetBytes) {
      let victim: number | null = null
      for (const index of cache.keys()) {
        if ((refs.get(index) ?? 0) === 0) {
          victim = index
          break
        }
      }
      if (victim === null) return
      const buffer = cache.get(victim)
      if (!buffer) return
      cache.delete(victim)
      retained -= buffer.length
      opts.observer?.onChunkWiped?.(victim, buffer)
      buffer.fill(0)
    }
  }

  const store = (index: number, plaintext: Uint8Array): void => {
    const existing = cache.get(index)
    if (existing) {
      // Already cached (a racing prefetch): drop the duplicate.
      plaintext.fill(0)
      return
    }
    cache.set(index, plaintext)
    retained += plaintext.length
    opts.observer?.onChunkCached?.(index, plaintext)
    evict()
  }

  // ── Fetching ───────────────────────────────────────────────────────────────
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      clock.setTimeout(resolve, ms)
    })

  async function fetchWithRetries(
    index: number,
    signal: AbortSignal,
  ): Promise<{ frame: Uint8Array; chunkCount: number | null }> {
    let lastErr: unknown = null
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      if (closed) throw closedError()
      if (terminal) throw terminal
      try {
        return await opts.source.fetchFrame(index, signal)
      } catch (err) {
        if (closed) throw closedError()
        if (terminal) throw terminal
        // A superseded/closed fetch is not an attempt: never retry it (and
        // never hold its concurrency slot through a backoff).
        if (signal.aborted) throw err
        const permanent = classify(err, index)
        if (permanent) throw permanent
        lastErr = err
        if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_BACKOFF_MS * attempt)
      }
    }
    throw new StreamSessionError(
      'network',
      `chunk ${index} failed after ${RETRY_ATTEMPTS} attempts`,
      index,
      { cause: lastErr },
    )
  }

  /**
   * §5.4: every non-last frame is exactly S + 28 bytes. A mismatch is retried
   * once, then it is an error. (The head defines S; the tail is last.)
   */
  async function fetchChecked(
    index: number,
    signal: AbortSignal,
  ): Promise<{ frame: Uint8Array; chunkCount: number | null }> {
    const mustCheck = index !== N - 1 && chunkSize > 0
    for (let sizeAttempt = 0; ; sizeAttempt++) {
      const out = await fetchWithRetries(index, signal)
      if (!mustCheck || out.frame.length === chunkSize + CHUNK_OVERHEAD) return out
      if (sizeAttempt >= 1) {
        throw new StreamSessionError(
          'auth',
          `chunk ${index} is not ${chunkSize + CHUNK_OVERHEAD} bytes`,
          index,
        )
      }
    }
  }

  let activeFetches = 0
  const slotWaiters: Array<() => void> = []
  async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (activeFetches < bounds.concurrency) {
      activeFetches++
    } else {
      await new Promise<void>((resolve) => {
        slotWaiters.push(() => {
          activeFetches++
          resolve()
        })
      })
    }
    try {
      return await fn()
    } finally {
      activeFetches--
      slotWaiters.shift()?.()
    }
  }

  async function openAndStore(index: number, signal: AbortSignal): Promise<Uint8Array> {
    if (closed) throw closedError()
    if (terminal) throw terminal
    if (!setupReader) throw closedError()
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const fetched = await fetchChecked(index, signal)
    emit({ type: 'received', bytes: fetched.frame.length })
    let plaintext: Uint8Array
    try {
      plaintext = await setupReader.openAt(
        index,
        index === N - 1,
        fetched.frame,
      )
    } catch (err) {
      throw new StreamSessionError(
        'auth',
        `chunk ${index} could not be authenticated`,
        index,
        { cause: err },
      )
    }
    if (closed) {
      plaintext.fill(0)
      throw closedError()
    }
    if (terminal) {
      plaintext.fill(0)
      throw terminal
    }
    store(index, plaintext)
    if (!verified.has(index)) {
      verified.add(index)
      emit({ type: 'verified', index })
    }
    return plaintext
  }

  function ensureChunk(index: number): Promise<Uint8Array> {
    const cached = cache.get(index)
    if (cached) {
      // LRU touch.
      cache.delete(index)
      cache.set(index, cached)
      return Promise.resolve(cached)
    }
    const pending = pendingFetches.get(index)
    if (pending) return pending
    const p = withSlot(() => {
      const controller = new AbortController()
      controllers.add(controller)
      return openAndStore(index, controller.signal).finally(() => {
        controllers.delete(controller)
      })
    })
    pendingFetches.set(index, p)
    void p.catch(() => {}).finally(() => pendingFetches.delete(index))
    return p
  }

  function startPrefetch(index: number): void {
    if (cache.has(index) || pendingFetches.has(index) || index < 0 || index >= N) return
    const controller = new AbortController()
    prefetchControllers.set(index, controller)
    controllers.add(controller)
    const p = withSlot(() => {
      if (terminal || closed) throw closedError()
      return openAndStore(index, controller.signal)
    })
    pendingFetches.set(index, p)
    void p
      .catch((err) => {
        if (terminal) return
        if (err instanceof StreamSessionError && err.kind !== 'network') fail(err)
      })
      .finally(() => {
        controllers.delete(controller)
        prefetchControllers.delete(index)
        pendingFetches.delete(index)
      })
  }

  let latestPull: { reqId: string; index: number; at: number } | null = null

  function notePull(reqId: string, index: number): void {
    latestPull = { reqId, index, at: clock.now() }
    const from = index + 1
    const to = Math.min(N - 1, index + bounds.readAhead)
    for (const [prefetchIndex, controller] of prefetchControllers) {
      // A chunk an active read is waiting on (refs > 0) is never aborted: the
      // read found the prefetch's promise and must be allowed to finish.
      if ((refs.get(prefetchIndex) ?? 0) > 0) continue
      if (prefetchIndex < from || prefetchIndex > to) {
        controller.abort(new DOMException('superseded pull', 'AbortError'))
        prefetchControllers.delete(prefetchIndex)
      }
    }
    for (let i = from; i <= to; i++) startPrefetch(i)
    // Read-ahead belongs to the most recent pull only. A later pull replaces
    // this window; an idle reqId loses its hint and re-reads by offset.
    void latestPull
  }

  // ── Setup (§5.1-5.4) ───────────────────────────────────────────────────────
  const headController = new AbortController()
  const tailController = new AbortController()
  controllers.add(headController)
  controllers.add(tailController)
  let head: { frame: Uint8Array; chunkCount: number | null }
  let tail: { frame: Uint8Array; chunkCount: number | null } | null = null
  try {
    const results = await Promise.all([
      fetchWithRetries(0, headController.signal),
      N > 1 ? fetchWithRetries(N - 1, tailController.signal) : Promise.resolve(null),
    ])
    head = results[0]
    tail = results[1]
    emit({ type: 'received', bytes: head.frame.length })
    if (tail) emit({ type: 'received', bytes: tail.frame.length })
  } catch (err) {
    const mapped = isTerminal(err)
      ? err
      : classify(err, 0) ?? new StreamSessionError('network', 'setup failed', 0)
    throw mapped
  } finally {
    controllers.delete(headController)
    controllers.delete(tailController)
  }

  if (head.frame.length <= CHUNK_OVERHEAD) {
    throw new StreamSessionError('auth', 'chunk 0 is too short to be a frame', 0)
  }
  chunkSize = head.frame.length - CHUNK_OVERHEAD
  bounds = streamBounds(chunkSize)

  // §5.2: X-Chunk-Count on chunk 0 and the row's counts must agree.
  if (head.chunkCount !== null && head.chunkCount !== N) {
    throw new StreamSessionError(
      'auth',
      `chunk 0 says ${head.chunkCount} chunks, the row says ${N}`,
      0,
    )
  }
  const dv = opts.row.download_version
  if (dv && dv.chunk_size_bytes !== chunkSize) {
    throw new StreamSessionError(
      'auth',
      `chunk size ${chunkSize} disagrees with download_version`,
      0,
    )
  }

  let setupHead: StreamReaderSetup
  try {
    setupHead = await factory({
      fileKey: opts.fileKey,
      fileId,
      pin,
      headFrame: head.frame,
      repair: opts.repair,
    })
  } catch (err) {
    if (isTerminal(err)) throw err
    throw new StreamSessionError('auth', 'chunk 0 could not be authenticated', 0, { cause: err })
  }
  setupReader = setupHead.reader
  if (setupHead.repairedKey) setupHead.repairedKey.fill(0)

  if (setupHead.headPlaintext.length !== chunkSize) {
    await setupReader.close()
    throw new StreamSessionError('auth', 'chunk 0 decrypted to the wrong size', 0)
  }
  store(0, setupHead.headPlaintext)
  verified.add(0)
  emit({ type: 'verified', index: 0 })

  let tailPlaintext: Uint8Array | null = null
  if (N > 1 && tail) {
    try {
      tailPlaintext = await setupReader.openAt(N - 1, true, tail.frame)
    } catch (err) {
      await setupReader.close()
      throw new StreamSessionError(
        'auth',
        `chunk ${N - 1} (the last chunk) could not be authenticated`,
        N - 1,
        { cause: err },
      )
    }
    if (tailPlaintext.length === 0 || tailPlaintext.length > chunkSize) {
      tailPlaintext.fill(0)
      await setupReader.close()
      throw new StreamSessionError('auth', 'the last chunk has an invalid size', N - 1)
    }
    store(N - 1, tailPlaintext)
    verified.add(N - 1)
    emit({ type: 'verified', index: N - 1 })
  }

  // §5.3: total plaintext and the row's sizes.
  const totalSize = (N - 1) * chunkSize + (N > 1 ? tailPlaintext!.length : chunkSize)
  if (dv && dv.plaintext_size_bytes !== totalSize) {
    await setupReader.close()
    throw new StreamSessionError('auth', 'total plaintext disagrees with download_version', 0)
  }

  // The legacy "encrypted total stored in size_bytes" case (encrypted-download.ts).
  const ciphertextTotal =
    (N - 1) * (chunkSize + CHUNK_OVERHEAD) +
    (N > 1 ? tailPlaintext!.length + CHUNK_OVERHEAD : head.frame.length)
  const expectedFromRow =
    opts.row.size_bytes === ciphertextTotal
      ? opts.row.size_bytes - N * CHUNK_OVERHEAD
      : opts.row.size_bytes
  if (expectedFromRow !== totalSize) {
    await setupReader.close()
    throw new StreamSessionError('auth', 'total plaintext disagrees with size_bytes', 0)
  }

  // ── Reads ──────────────────────────────────────────────────────────────────
  async function read(reqId: string, offset: number, max: number): Promise<Uint8Array> {
    if (closed) throw closedError()
    if (terminal) throw terminal
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError(`invalid read length ${max}`)
    }
    const loc = chunkForOffset(offset, chunkSize, N, totalSize)
    const length = Math.min(max, MAX_MESSAGE_BYTES, loc.available)
    acquire(loc.index)
    // Start the requested chunk BEFORE read-ahead so a player pull never queues
    // behind its own speculative window.
    const pending = ensureChunk(loc.index)
    notePull(reqId, loc.index)
    try {
      const chunk = await pending
      if (terminal) throw terminal
      if (closed) throw closedError()
      return chunk.slice(loc.offsetInChunk, loc.offsetInChunk + length)
    } catch (err) {
      if (terminal) throw terminal
      if (closed) throw closedError()
      const mapped = classify(err, loc.index) ?? new StreamSessionError('network', 'read failed', loc.index)
      fail(mapped)
      throw mapped
    } finally {
      release(loc.index)
    }
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    for (const controller of controllers) {
      controller.abort(new DOMException('session closed', 'AbortError'))
    }
    controllers.clear()
    prefetchControllers.clear()
    wipeCache()
    const reader = setupReader
    setupReader = null
    if (reader) {
      try {
        await reader.close()
      } catch {
        // Best effort: the key wipe happened worker-side already.
      }
    }
  }

  return {
    totalSize,
    chunkCount: N,
    chunkSize,
    verified,
    read,
    close,
    onEvent(cb: (event: StreamEvent) => void): () => void {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    retainedBytes: () => retained,
  }
}

// Re-export so callers can classify without another import.
export { StreamChangedError, ApiError }
