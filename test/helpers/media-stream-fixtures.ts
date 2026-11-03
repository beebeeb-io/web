/**
 * LD-0001 PR-A (task LD-0001): fixtures for the random-access stream reader.
 *
 * Everything here runs the REAL core WASM build (`packages/beebeeb-wasm`) under
 * bun. A fixture is written exactly the way the web uploader writes a file:
 * `WasmChunkEncryptor.withChunkSize` for v1, plus `withRecordedPin(2)` for a
 * v2-pinned file (what a replace of a v2 file does). No hand-built frames.
 *
 * `FakeChunkSource` plays the server. It can swap, drop, resize, stall or 409 a
 * chunk, and records every request so a test can assert the pin and order.
 * `FakeClock` is the injected clock (never bun's fake timers).
 */
import { loadWasm } from './wasm-crypto-mirror'
import type { ContentOps, ContentPin } from '../../src/lib/content-crypto'
import type {
  ChunkFrameSource,
  Clock,
} from '../../src/lib/media-stream/source'
import type {
  StreamReader,
  StreamReaderFactory,
} from '../../src/lib/media-stream/session'

const wasm = loadWasm()

export const CHUNK_OVERHEAD = 28

/** Deterministic bytes: index i → (i * mul + add) & 0xff. */
export function patternBytes(size: number, mul = 31, add = 11): Uint8Array {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = (i * mul + add) & 0xff
  return out
}

export function seededKey(seed: number): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 0; i < out.length; i++) out[i] = (i * 17 + seed * 7 + 3) & 0xff
  return out
}

export function deterministicFileId(tag: string): string {
  // A UUID-shaped id; core only treats it as bytes.
  let h = 0
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hex = h.toString(16).padStart(8, '0')
  return `${hex}-0000-4000-8000-${(h ^ 0x5a5a5a5a).toString(16).padStart(12, '0').slice(0, 12)}`
}

export interface Fixture {
  masterKey: Uint8Array
  fileKey: Uint8Array
  fileId: string
  plaintext: Uint8Array
  chunkSize: number
  frames: Uint8Array[]
  chunkCount: number
  pin: ContentPin
}

export interface FixtureOptions {
  masterKey?: Uint8Array
  fileId?: string
  plaintext?: Uint8Array
  chunkSize?: number
  pin?: ContentPin
}

/** Encrypt a fixture with the same core writer the web uploader uses. */
export function encryptFixture(opts: FixtureOptions = {}): Fixture {
  const masterKey = opts.masterKey ?? seededKey(7)
  const fileId = opts.fileId ?? deterministicFileId('fixture')
  const plaintext = opts.plaintext ?? patternBytes(150)
  const chunkSize = opts.chunkSize ?? 64
  const pin = opts.pin ?? 0
  let enc = wasm.WasmChunkEncryptor.withChunkSize(
    masterKey,
    fileId,
    BigInt(plaintext.length),
    BigInt(chunkSize),
  )
  if (pin === 2) enc = enc.withRecordedPin(2)
  const frames: Uint8Array[] = []
  for (let off = 0; off < plaintext.length; off += chunkSize) {
    frames.push(enc.pushChunk(plaintext.slice(off, off + chunkSize)) as Uint8Array)
  }
  enc.finish()
  return {
    masterKey,
    fileKey: wasm.derive_file_key(masterKey, new TextEncoder().encode(fileId)) as Uint8Array,
    fileId,
    plaintext,
    chunkSize,
    frames,
    chunkCount: frames.length,
    pin,
  }
}

// ── Clock ────────────────────────────────────────────────────────────────────

interface Timer {
  at: number
  cb: () => void
}

/** A manual clock. `advance` fires due timers oldest-first. */
export class FakeClock implements Clock {
  #t = 0
  #next = 1
  #timers = new Map<number, Timer>()

  now(): number {
    return this.#t
  }

  setTimeout(cb: () => void, ms: number): unknown {
    const id = this.#next++
    this.#timers.set(id, { at: this.#t + Math.max(0, ms), cb })
    return id
  }

  clearTimeout(id: unknown): void {
    this.#timers.delete(id as number)
  }

  /** Fire every timer due within `ms`, in time order. */
  advance(ms: number): void {
    this.#t += ms
    for (;;) {
      let dueId: number | null = null
      let due: Timer | null = null
      for (const [id, timer] of this.#timers) {
        if (timer.at <= this.#t && (!due || timer.at < due.at)) {
          dueId = id
          due = timer
        }
      }
      if (dueId === null || !due) return
      this.#timers.delete(dueId)
      this.#t = Math.max(this.#t, due.at)
      due.cb()
    }
  }

  get pendingTimers(): number {
    return this.#timers.size
  }
}

/** Let promise continuations run without touching the injected clock. */
export async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
}

// ── Fake chunk source ────────────────────────────────────────────────────────

export class FakeChunkSource implements ChunkFrameSource {
  frames: Uint8Array[] | null
  frameFor: ((index: number) => Uint8Array) | null
  /** What `X-Chunk-Count` says. Defaults to the real frame count. */
  chunkCount: number | null
  /** Per-index override: bytes to serve, `null` for a 409, `undefined` = normal. */
  overrides = new Map<number, Uint8Array | null>()
  /** Indices that never answer until the signal aborts. */
  stalls = new Set<number>()
  /** Indices held until `release(index)` (a read-ahead that a later pull supersedes). */
  deferred = new Set<number>()
  #releasers = new Map<number, () => void>()
  /** Indices that fail this many times before answering. */
  transientFailures = new Map<number, number>()
  calls: number[] = []
  chunkCountHeaders: Array<number | null> = []
  aborted: number[] = []

  constructor(frames: Uint8Array[] | null, chunkCount: number | null = null) {
    this.frames = frames
    this.frameFor = null
    this.chunkCount = chunkCount
  }

  static lazy(frameFor: (index: number) => Uint8Array, chunkCount: number): FakeChunkSource {
    const source = new FakeChunkSource(null, chunkCount)
    source.frameFor = frameFor
    return source
  }

  setFrames(frames: Uint8Array[]): void {
    this.frames = frames
    this.chunkCount = frames.length
  }

  release(index: number): void {
    this.#releasers.get(index)?.()
    this.#releasers.delete(index)
  }

  async fetchFrame(
    index: number,
    signal: AbortSignal,
  ): Promise<{ frame: Uint8Array; chunkCount: number | null }> {
    this.calls.push(index)
    this.chunkCountHeaders.push(this.chunkCount)
    if (this.stalls.has(index)) {
      await new Promise<never>((_, reject) => {
        const onAbort = () => {
          this.aborted.push(index)
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
    }
    if (this.deferred.has(index)) {
      await new Promise<void>((resolve, reject) => {
        this.#releasers.set(index, resolve)
        signal.addEventListener(
          'abort',
          () => {
            this.aborted.push(index)
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      })
    }
    const failures = this.transientFailures.get(index) ?? 0
    if (failures > 0) {
      this.transientFailures.set(index, failures - 1)
      throw new TypeError('network error')
    }
    const override = this.overrides.get(index)
    if (override === null) {
      const { StreamChangedError } = await import('../../src/lib/media-stream/source')
      throw new StreamChangedError('the file changed')
    }
    if (override) return { frame: override.slice(), chunkCount: this.chunkCount }
    const frame = this.frameFor ? this.frameFor(index) : this.frames?.[index]
    if (!frame) {
      const { ApiError } = await import('../../src/lib/api')
      throw new ApiError('not found', 404)
    }
    return { frame: frame.slice(), chunkCount: this.chunkCount }
  }
}

// ── In-process reader factory (real core, no worker hop) ─────────────────────

/**
 * The session's default factory crosses into the crypto worker. Under bun the
 * worker cannot load, so this factory drives the SAME `createContentOps` code
 * with the same reader-handle lifecycle, in process. It is the production
 * factory minus the postMessage hop (mirrors test/helpers/wasm-crypto-mirror.ts).
 */
export function inProcessReaderFactory(
  ops: ContentOps,
  spies: { openAt: Array<{ index: number; isLast: boolean }>; repairs: number } = {
    openAt: [],
    repairs: 0,
  },
): StreamReaderFactory {
  return async ({ fileKey, fileId, pin, headFrame, repair }) => {
    let key = fileKey
    let repairedKey: Uint8Array | undefined
    let decryptor = ops.createDecryptor(key, fileId, pin)
    let headPlaintext: Uint8Array
    try {
      headPlaintext = ops.decryptorPushFrame(decryptor, headFrame)
    } catch (err) {
      ops.decryptorDispose(decryptor)
      if (!repair) throw err
      spies.repairs++
      const repaired = await repair(headFrame)
      if (!repaired) throw err
      key = repaired
      repairedKey = repaired
      decryptor = ops.createDecryptor(key, fileId, pin)
      headPlaintext = ops.decryptorPushFrame(decryptor, headFrame)
    }
    const handle = ops.createChunkReader(decryptor)
    const reader: StreamReader = {
      openAt: async (index, isLast, frame) => {
        spies.openAt.push({ index, isLast })
        return ops.openChunkAt(handle, index, isLast, frame)
      },
      close: async () => ops.closeChunkReader(handle),
    }
    return { reader, headPlaintext, repairedKey }
  }
}

/** A non-cryptographic reader for scheduling tests at 32 MiB (no WASM cost). */
export function syntheticReaderFactory(spies: {
  openAt: Array<{ index: number; isLast: boolean }>
}): StreamReaderFactory {
  return async ({ headFrame }) => {
    return {
      headPlaintext: headFrame.slice(CHUNK_OVERHEAD),
      reader: {
        // Frames are zeros, so "decryption" is the frame minus overhead.
        openAt: async (index, isLast, frame) => {
          spies.openAt.push({ index, isLast })
          return frame.slice(CHUNK_OVERHEAD)
        },
        close: async () => {},
      },
    }
  }
}
