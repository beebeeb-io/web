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
 *  - terminal error classes (StreamErrorKind; only `auth` is a claim about
 *    the bytes) with wipes.
 *
 * It knows nothing about the Service Worker or the player: no UI, no
 * `MessagePort`, no component. Keys never leave this module or the worker.
 */
import { isChunkAuthenticationError, type ContentPin } from '../content-crypto'
import { startDecryptStream, createChunkReader, type ChunkReader, type StreamDecryptor } from '../crypto'
import type { FileContentRef } from '../encrypted-download'
import type { ContentKey } from '../request-row'
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

/**
 * Why a stream stopped (LD-0001 r4, A-R2). Only `auth` claims anything about
 * the file's bytes; the UI copy follows these kinds.
 *  - `auth`: a frame failed AEAD authentication at its index (or chunk 0 did
 *    not authenticate as the last chunk, or the chunk format was downgraded);
 *  - `changed`: the pinned version is gone (409);
 *  - `unauthorized`: the session expired (401);
 *  - `unavailable`: the server refused a part (403, 404, 410, other 4xx), or
 *    served parts whose count or size disagree with the file's record;
 *  - `network`: the transport failed (retries exhausted, idle timeouts);
 *  - `internal`: the crypto worker or WASM failed (load, messaging).
 */
export type StreamErrorKind =
  | 'auth'
  | 'changed'
  | 'unauthorized'
  | 'unavailable'
  | 'network'
  | 'internal'

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
  fileKey: ContentKey
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
  fileKey: ContentKey
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
  /**
   * Abandons the open. During setup, an abort cancels the head and tail
   * fetches, closes a reader the worker already created (its key is wiped),
   * wipes any decrypted chunk, and rejects with the abort reason. After the
   * open resolved, it closes the session.
   */
  signal?: AbortSignal
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
 * The crypto calls the production reader factory makes: a sequential chunk-0
 * open in the worker (with the #204 repair hook when one is supplied), then the
 * worker hands back a random-access handle. The decryptor is consumed by
 * `createChunkReader`.
 */
export interface WorkerReaderDeps {
  startDecryptStream(fileKey: ContentKey, fileId: string, pin: ContentPin): Promise<StreamDecryptor>
  createChunkReader(decryptor: { handle: number; release?(): void }): Promise<ChunkReader>
}

/**
 * The production factory over injectable crypto calls (tests pass in-process
 * ports that transfer buffers the way the worker hop does).
 *
 * `pushFrame` TRANSFERS its buffer to the worker, so the first push gets a
 * copy: the repair hook and the retry must still see the whole frame. A failed
 * retry disposes its decryptor and wipes the repaired key.
 */
export function createWorkerReaderFactory(deps: WorkerReaderDeps): StreamReaderFactory {
  return async ({ fileKey, fileId, pin, headFrame, repair }) => {
    let decryptor = await deps.startDecryptStream(fileKey, fileId, pin)
    let headPlaintext: Uint8Array
    let repairedKey: Uint8Array | undefined
    try {
      headPlaintext = await decryptor.pushFrame(headFrame.slice())
    } catch (err) {
      await decryptor.dispose()
      if (!repair) throw err
      const repaired = await repair(headFrame.slice())
      if (!repaired) throw err
      let retry: StreamDecryptor | null = null
      try {
        retry = await deps.startDecryptStream(repaired, fileId, pin)
        headPlaintext = await retry.pushFrame(headFrame.slice())
      } catch (retryErr) {
        if (retry) await retry.dispose()
        repaired.fill(0)
        throw retryErr
      }
      decryptor = retry
      repairedKey = repaired
    }
    try {
      const reader = await deps.createChunkReader(decryptor)
      return { reader, headPlaintext, repairedKey }
    } catch (err) {
      await decryptor.dispose()
      headPlaintext.fill(0)
      repairedKey?.fill(0)
      throw err
    }
  }
}

export const workerReaderFactory: StreamReaderFactory = createWorkerReaderFactory({
  startDecryptStream,
  createChunkReader: (decryptor) => createChunkReader(decryptor),
})

function isTerminal(err: unknown): err is StreamSessionError {
  return err instanceof StreamSessionError
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

/** A read joins a superseded fetch at most this often before it gives up (without failing the session). */
const MAX_SUPERSEDED_REREADS = 3

/** One in-flight chunk open: its promise and the controller that can abort it. */
interface PendingFetch {
  controller: AbortController
  promise: Promise<Uint8Array>
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
    if (err.status === 401) {
      return new StreamSessionError('unauthorized', `chunk ${index}: the session expired`, index, { cause: err })
    }
    // Any other client refusal is permanent: retrying would not make the
    // server serve a chunk it says does not exist (A3). It is not a claim
    // about the bytes, so it is never 'auth'.
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      return new StreamSessionError('unavailable', `chunk ${index}: refused with ${err.status}`, index, { cause: err })
    }
    return null
  }
  return null
}

/**
 * A-R2: what a failed crypto call (factory, openAt) means. Only a frame that
 * failed authentication (core's error, tagged where it is thrown) is 'auth';
 * an HTTP failure keeps its class; a worker, WASM or messaging failure is
 * 'internal'.
 */
function classifyCryptoFailure(err: unknown, index: number, authMessage: string): StreamSessionError {
  if (isTerminal(err)) return err
  if (isChunkAuthenticationError(err)) {
    return new StreamSessionError('auth', authMessage, index, { cause: err })
  }
  const http = classify(err, index)
  if (http) return http
  return new StreamSessionError('internal', `chunk ${index}: the crypto worker failed`, index, { cause: err })
}

export async function openStreamSession(opts: OpenStreamOptions): Promise<StreamSession> {
  const clock = opts.clock ?? realClock
  const factory = opts.readerFactory ?? workerReaderFactory
  const N = opts.row.chunk_count
  const fileId = opts.content.fileId
  const pin = opts.content.pin
  const signal = opts.signal
  const abortReason = (): unknown =>
    signal?.reason ?? new DOMException('stream open aborted', 'AbortError')

  if (signal?.aborted) throw abortReason()
  if (!Number.isInteger(N) || N < 1) {
    throw new StreamSessionError('unavailable', `invalid chunk count ${N}`)
  }
  if (opts.row.download_version && opts.row.download_version.chunk_count !== N) {
    throw new StreamSessionError(
      'unavailable',
      'chunk count disagrees with download_version',
    )
  }
  if (opts.content.fileId !== opts.fileId) {
    throw new StreamSessionError('internal', 'content file id disagrees with the stream file id')
  }

  // ── Session state ──────────────────────────────────────────────────────────
  let closed = false
  let terminal: StreamSessionError | null = null
  let setupReader: StreamReader | null = null
  let bounds: StreamBounds = streamBounds(MiB)
  let chunkSize = 0
  let retained = 0
  /** The last chunk's plaintext size, fixed by setup; −1 until then. */
  let tailSize = -1
  /** The post-open abort listener (A7); close() removes it (A-R4). */
  let onAbortAfterOpen: (() => void) | null = null

  const listeners = new Set<(event: StreamEvent) => void>()
  const cache = new Map<number, Uint8Array>()
  const refs = new Map<number, number>()
  const pendingFetches = new Map<number, PendingFetch>()
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

  /** Drop `entry` from the map only if it is still the current one for `index`. */
  const dropPending = (index: number, entry: PendingFetch): void => {
    if (pendingFetches.get(index) === entry) pendingFetches.delete(index)
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

  /**
   * Cache `plaintext` for `index` and return the buffer readers must use. When
   * a racing open of the same index (a superseded read-ahead that finished
   * after a fresh fetch started) already cached it, the duplicate is wiped and
   * the CACHED buffer is returned — never the zeroed duplicate.
   */
  const store = (index: number, plaintext: Uint8Array): Uint8Array => {
    const existing = cache.get(index)
    if (existing) {
      plaintext.fill(0)
      return existing
    }
    cache.set(index, plaintext)
    retained += plaintext.length
    opts.observer?.onChunkCached?.(index, plaintext)
    evict()
    return plaintext
  }

  // ── Fetching ───────────────────────────────────────────────────────────────
  /**
   * A-R4: the retry backoff races the fetch's abort. An abandoned open or a
   * superseded read-ahead ends now, not after the backoff, and its timer is
   * cleared.
   */
  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      const reason = () => signal.reason ?? new DOMException('Aborted', 'AbortError')
      if (signal.aborted) {
        reject(reason())
        return
      }
      const onAbort = (): void => {
        clock.clearTimeout(timer)
        reject(reason())
      }
      const timer = clock.setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal.addEventListener('abort', onAbort, { once: true })
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
        if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_BACKOFF_MS * attempt, signal)
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
  /** The plaintext size chunk `index` must open to: S, or the tail size setup fixed. */
  function expectedPlaintextSize(index: number): number {
    return index === N - 1 ? tailSize : chunkSize
  }

  async function fetchChecked(
    index: number,
    signal: AbortSignal,
  ): Promise<{ frame: Uint8Array; chunkCount: number | null }> {
    // A re-fetched tail is held to the size setup opened (A6), like every
    // other frame is held to S + 28.
    const plaintextSize = expectedPlaintextSize(index)
    const expected = plaintextSize >= 0 ? plaintextSize + CHUNK_OVERHEAD : -1
    for (let sizeAttempt = 0; ; sizeAttempt++) {
      const out = await fetchWithRetries(index, signal)
      if (expected < 0 || out.frame.length === expected) return out
      if (sizeAttempt >= 1) {
        throw new StreamSessionError('unavailable', `chunk ${index} is not ${expected} bytes`, index)
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

  async function openAndStore(
    index: number,
    signal: AbortSignal,
    entry: PendingFetch,
  ): Promise<Uint8Array> {
    if (closed) throw closedError()
    if (terminal) throw terminal
    if (!setupReader) throw closedError()
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const fetched = await fetchChecked(index, signal)
    emit({ type: 'received', bytes: fetched.frame.length })
    if (closed) throw closedError()
    if (terminal) throw terminal
    // A-R4: a fetch that lands after its read-ahead was superseded is never
    // decrypted.
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const reader = setupReader
    if (!reader) throw closedError()
    let plaintext: Uint8Array
    try {
      plaintext = await reader.openAt(
        index,
        index === N - 1,
        fetched.frame,
      )
    } catch (err) {
      throw classifyCryptoFailure(err, index, `chunk ${index} could not be authenticated`)
    }
    if (closed) {
      plaintext.fill(0)
      throw closedError()
    }
    if (terminal) {
      plaintext.fill(0)
      throw terminal
    }
    if (plaintext.length !== expectedPlaintextSize(index)) {
      plaintext.fill(0)
      throw new StreamSessionError('unavailable', `chunk ${index} opened to the wrong size`, index)
    }
    // Settled: drop this open's pending entry BEFORE the store can evict, so
    // no later read joins a promise whose buffer an eviction already wiped.
    dropPending(index, entry)
    const cached = store(index, plaintext)
    if (!verified.has(index)) {
      verified.add(index)
      emit({ type: 'verified', index })
    }
    return cached
  }

  function ensureChunk(index: number): Promise<Uint8Array> {
    const cached = cache.get(index)
    if (cached) {
      // LRU touch.
      cache.delete(index)
      cache.set(index, cached)
      return Promise.resolve(cached)
    }
    // A superseded read-ahead leaves the map the moment it is aborted (notePull);
    // the aborted check is the second line of defence. A read never joins an
    // aborted fetch: it starts a fresh one.
    const pending = pendingFetches.get(index)
    if (pending && !pending.controller.signal.aborted) return pending.promise
    const controller = new AbortController()
    controllers.add(controller)
    const entry: PendingFetch = { controller, promise: Promise.resolve(new Uint8Array(0)) }
    entry.promise = withSlot(() => openAndStore(index, controller.signal, entry)).finally(() => {
      controllers.delete(controller)
      dropPending(index, entry)
    })
    pendingFetches.set(index, entry)
    void entry.promise.catch(() => {})
    return entry.promise
  }

  function startPrefetch(index: number): void {
    if (index < 0 || index >= N || cache.has(index)) return
    const existing = pendingFetches.get(index)
    if (existing && !existing.controller.signal.aborted) return
    const controller = new AbortController()
    prefetchControllers.set(index, controller)
    controllers.add(controller)
    const entry: PendingFetch = { controller, promise: Promise.resolve(new Uint8Array(0)) }
    entry.promise = withSlot(() => {
      if (terminal || closed) throw closedError()
      return openAndStore(index, controller.signal, entry)
    })
    pendingFetches.set(index, entry)
    void entry.promise
      .catch((err) => {
        if (terminal || closed) return
        if (err instanceof StreamSessionError && err.kind !== 'network') fail(err)
      })
      .finally(() => {
        controllers.delete(controller)
        if (prefetchControllers.get(index) === controller) prefetchControllers.delete(index)
        dropPending(index, entry)
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
        // Drop the aborted promise now, so a read of this index (a seek back)
        // starts a fresh fetch instead of joining one that will reject.
        const entry = pendingFetches.get(prefetchIndex)
        if (entry?.controller === controller) pendingFetches.delete(prefetchIndex)
      }
    }
    for (let i = from; i <= to; i++) startPrefetch(i)
    // Read-ahead belongs to the most recent pull only. A later pull replaces
    // this window; an idle reqId loses its hint and re-reads by offset.
    void latestPull
  }

  // ── Setup (§5.1-5.4) ───────────────────────────────────────────────────────
  // One controller for both setup fetches: the caller's abort cancels both,
  // and when one fetch fails the other is abandoned at once.
  const setupController = new AbortController()
  const onOpenAbort = (): void => setupController.abort(abortReason())
  signal?.addEventListener('abort', onOpenAbort, { once: true })
  const abandonSetup = (err: unknown): never => {
    setupController.abort(new DOMException('the other setup fetch failed', 'AbortError'))
    throw err
  }
  let head: { frame: Uint8Array; chunkCount: number | null }
  let tail: { frame: Uint8Array; chunkCount: number | null } | null = null
  try {
    const results = await Promise.all([
      fetchWithRetries(0, setupController.signal).catch(abandonSetup),
      N > 1
        ? fetchWithRetries(N - 1, setupController.signal).catch(abandonSetup)
        : Promise.resolve(null),
    ])
    head = results[0]
    tail = results[1]
    emit({ type: 'received', bytes: head.frame.length })
    if (tail) emit({ type: 'received', bytes: tail.frame.length })
  } catch (err) {
    if (signal?.aborted) throw abortReason()
    const mapped = isTerminal(err)
      ? err
      : classify(err, 0) ?? new StreamSessionError('network', 'setup failed', 0)
    throw mapped
  } finally {
    signal?.removeEventListener('abort', onOpenAbort)
  }

  // Read before the factory: pushing the frame to the worker transfers (and
  // empties) its buffer.
  const headFrameLength = head.frame.length
  // A zero-length file is exactly one 28-byte frame (core: an empty file still
  // has one frame). Anything shorter, or an empty head on a multi-chunk row,
  // is not a frame.
  if (headFrameLength < CHUNK_OVERHEAD || (headFrameLength === CHUNK_OVERHEAD && N > 1)) {
    throw new StreamSessionError('unavailable', 'chunk 0 is too short to be a frame', 0)
  }
  chunkSize = headFrameLength - CHUNK_OVERHEAD
  if (chunkSize > 0) bounds = streamBounds(chunkSize)

  // §5.2: X-Chunk-Count on chunk 0 and the row's counts must agree.
  if (head.chunkCount !== null && head.chunkCount !== N) {
    throw new StreamSessionError(
      'unavailable',
      `chunk 0 says ${head.chunkCount} chunks, the row says ${N}`,
      0,
    )
  }
  const dv = opts.row.download_version
  // `chunk_size_bytes` is the stride the uploader declared, not chunk 0's real
  // size. With one chunk, chunk 0 is the whole file, so S is the smaller of the
  // stride and the plaintext size (a 300 KB phone clip under a 4 MiB stride).
  const expectedChunkSize = dv
    ? N === 1
      ? Math.min(dv.chunk_size_bytes, dv.plaintext_size_bytes)
      : dv.chunk_size_bytes
    : chunkSize
  if (expectedChunkSize !== chunkSize) {
    throw new StreamSessionError(
      'unavailable',
      `chunk size ${chunkSize} disagrees with download_version`,
      0,
    )
  }

  if (signal?.aborted) throw abortReason()
  // A-R1: a one-chunk row keeps its own copy of the head, to re-open it as the
  // last chunk below (the factory transfers the frame it is given).
  const headAsLastFrame = N === 1 ? head.frame.slice() : null
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
    if (signal?.aborted) throw abortReason()
    throw classifyCryptoFailure(err, 0, 'chunk 0 could not be authenticated')
  }
  setupReader = setupHead.reader
  if (setupHead.repairedKey) setupHead.repairedKey.fill(0)

  // Every setup failure from here on wipes what it decrypted (M1): the
  // cached head and tail, a head of the wrong size, a tail that was never
  // cached. The reader is closed, so its key copy is wiped too.
  let headStored = false
  let tailPlaintext: Uint8Array | null = null
  let tailStored = false
  let totalSize = 0
  try {
    // An open abandoned while the worker built the reader closes that reader
    // here (the catch below), so no reader or key copy outlives the open.
    if (signal?.aborted) throw abortReason()
    if (setupHead.headPlaintext.length !== chunkSize) {
      throw new StreamSessionError('unavailable', 'chunk 0 decrypted to the wrong size', 0)
    }
    if (headAsLastFrame) {
      // A-R1: with one chunk, chunk 0 must BE the last chunk. The sequential
      // open accepts a v2 frame with or without its last flag, and no finish()
      // runs, so the head is opened once more at index 0 with is_last = true:
      // a v2 file cut down to its first chunk fails here. Format 1 binds no
      // last flag (the documented v1 weakness, as on the whole-file path).
      let asLast: Uint8Array
      try {
        asLast = await setupReader.openAt(0, true, headAsLastFrame)
      } catch (err) {
        throw classifyCryptoFailure(err, 0, 'chunk 0 did not authenticate as the last chunk')
      }
      asLast.fill(0)
    }
    store(0, setupHead.headPlaintext)
    headStored = true
    verified.add(0)
    emit({ type: 'verified', index: 0 })

    if (N > 1 && tail) {
      try {
        tailPlaintext = await setupReader.openAt(N - 1, true, tail.frame)
      } catch (err) {
        throw classifyCryptoFailure(err, N - 1, `chunk ${N - 1} (the last chunk) could not be authenticated`)
      }
      if (tailPlaintext.length === 0 || tailPlaintext.length > chunkSize) {
        throw new StreamSessionError('unavailable', 'the last chunk has an invalid size', N - 1)
      }
      store(N - 1, tailPlaintext)
      tailStored = true
      verified.add(N - 1)
      emit({ type: 'verified', index: N - 1 })
    }

    // §5.3: total plaintext and the row's sizes. The tail size is fixed here;
    // a later re-fetch of the tail must open to exactly this size.
    tailSize = N > 1 ? tailPlaintext!.length : chunkSize
    totalSize = (N - 1) * chunkSize + tailSize
    if (dv && dv.plaintext_size_bytes !== totalSize) {
      throw new StreamSessionError('unavailable', 'total plaintext disagrees with download_version', 0)
    }

    // The legacy "encrypted total stored in size_bytes" case (encrypted-download.ts).
    const ciphertextTotal =
      (N - 1) * (chunkSize + CHUNK_OVERHEAD) +
      (N > 1 ? tailPlaintext!.length + CHUNK_OVERHEAD : headFrameLength)
    const expectedFromRow =
      opts.row.size_bytes === ciphertextTotal
        ? opts.row.size_bytes - N * CHUNK_OVERHEAD
        : opts.row.size_bytes
    if (expectedFromRow !== totalSize) {
      throw new StreamSessionError('unavailable', 'total plaintext disagrees with size_bytes', 0)
    }
    if (signal?.aborted) throw abortReason()
  } catch (err) {
    if (!headStored) setupHead.headPlaintext.fill(0)
    if (tailPlaintext && !tailStored) tailPlaintext.fill(0)
    wipeCache()
    const reader: StreamReader | null = setupReader
    setupReader = null
    if (reader) {
      try {
        await reader.close()
      } catch {
        // Best effort: the worker wipes the key on close.
      }
    }
    throw err
  }

  // ── Reads ──────────────────────────────────────────────────────────────────
  async function read(reqId: string, offset: number, max: number): Promise<Uint8Array> {
    if (closed) throw closedError()
    if (terminal) throw terminal
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError(`invalid read length ${max}`)
    }
    if (totalSize === 0) {
      throw new RangeError(`offset ${offset} is past the end of an empty stream`)
    }
    const loc = chunkForOffset(offset, chunkSize, N, totalSize)
    const length = Math.min(max, MAX_MESSAGE_BYTES, loc.available)
    acquire(loc.index)
    try {
      for (let attempt = 1; ; attempt++) {
        // Start the requested chunk BEFORE read-ahead so a player pull never
        // queues behind its own speculative window.
        const pending = ensureChunk(loc.index)
        if (attempt === 1) notePull(reqId, loc.index)
        try {
          const chunk = await pending
          if (terminal) throw terminal
          if (closed) throw closedError()
          return chunk.slice(loc.offsetInChunk, loc.offsetInChunk + length)
        } catch (err) {
          if (terminal) throw terminal
          if (closed) throw closedError()
          // A superseded read-ahead's abort is never a session failure: open
          // the chunk again. Only a real failure ends the session.
          if (isAbortError(err)) {
            if (attempt < MAX_SUPERSEDED_REREADS) continue
            throw new StreamSessionError('network', `chunk ${loc.index} read was superseded`, loc.index)
          }
          const mapped = classify(err, loc.index) ?? new StreamSessionError('network', 'read failed', loc.index)
          fail(mapped)
          throw mapped
        }
      }
    } finally {
      release(loc.index)
    }
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    // A-R4: the caller's signal no longer holds a reference to this session.
    if (onAbortAfterOpen) {
      signal?.removeEventListener('abort', onAbortAfterOpen)
      onAbortAfterOpen = null
    }
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

  // An abort that lands after the open resolved (the caller moved on while the
  // promise was settling) closes the session instead of leaking it.
  if (signal) {
    onAbortAfterOpen = () => void close()
    signal.addEventListener('abort', onAbortAfterOpen, { once: true })
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
