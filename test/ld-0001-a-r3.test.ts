/**
 * LD-0001 PR-A round 3 (web #207): the review fixes for the stream session.
 * One describe block per review row (A1-A8). Fixtures are real core WASM
 * frames; a row that needs 1 MiB chunks uses the synthetic reader instead.
 */
import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import {
  deterministicFileId,
  encryptFixture,
  FakeChunkSource,
  FakeClock,
  inProcessReaderFactory,
  patternBytes,
  seededKey,
  settle,
  syntheticReaderFactory,
  type Fixture,
} from './helpers/media-stream-fixtures'
import { createContentOps, type ContentOps } from '../src/lib/content-crypto'
import {
  createChunkReader,
  StreamingDecryptor,
  type ChunkReaderPort,
  type DecryptorPort,
} from '../src/lib/crypto'
import {
  createWorkerReaderFactory,
  openStreamSession,
  type OpenStreamOptions,
  type StreamEvent,
  type StreamObserver,
  type StreamReaderFactory,
  type StreamRow,
  type StreamSession,
} from '../src/lib/media-stream/session'

const wasm = loadWasm()
const MiB = 1024 * 1024

function rowFor(fx: Fixture): StreamRow {
  const ciphertext = fx.frames.reduce((n, f) => n + f.length, 0)
  return {
    chunk_count: fx.chunkCount,
    size_bytes: fx.plaintext.length,
    download_version: {
      object_version_id: 'ov-1',
      version_number: 1,
      chunk_count: fx.chunkCount,
      chunk_size_bytes: fx.chunkSize,
      plaintext_size_bytes: fx.plaintext.length,
      ciphertext_size_bytes: ciphertext,
      chunks: fx.frames.map((f, index) => ({ index, size_bytes: f.length })),
    },
  }
}

function open(fx: Fixture, extra: Partial<OpenStreamOptions> = {}): Promise<StreamSession> {
  return openStreamSession({
    fileId: fx.fileId,
    fileKey: fx.fileKey,
    content: { fileId: fx.fileId, pin: fx.pin },
    row: rowFor(fx),
    source: new FakeChunkSource(fx.frames),
    clock: new FakeClock(),
    readerFactory: inProcessReaderFactory(createContentOps(wasm)),
    ...extra,
  })
}

function allZero(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0)
}

function errorsOf(session: StreamSession): StreamEvent[] {
  const out: StreamEvent[] = []
  session.onEvent((event) => {
    if (event.type === 'error') out.push(event)
  })
  return out
}

interface CacheLog {
  cached: Array<{ index: number; bytes: Uint8Array }>
  wiped: Array<{ index: number; bytes: Uint8Array }>
}

function observed(): { log: CacheLog; observer: StreamObserver } {
  const log: CacheLog = { cached: [], wiped: [] }
  return {
    log,
    observer: {
      onChunkCached: (index, bytes) => log.cached.push({ index, bytes }),
      onChunkWiped: (index, bytes) => log.wiped.push({ index, bytes }),
    },
  }
}

// @@ A1
describe('LD-0001 r3 A1: a single-chunk file declares its upload stride', () => {
  test('single_chunk_300KB_with_a_4MiB_declared_stride_opens', async () => {
    for (const pin of [0, 2] as const) {
      const plaintext = patternBytes(300 * 1024)
      const fx = encryptFixture({ pin, chunkSize: 4 * MiB, plaintext })
      expect(fx.chunkCount).toBe(1)
      const row = rowFor(fx)
      expect(row.download_version!.chunk_size_bytes).toBe(4 * MiB)
      const session = await open(fx, { row })
      expect(session.totalSize).toBe(plaintext.length)
      expect(session.chunkSize).toBe(plaintext.length)
      expect(await session.read('r', 0, 4096)).toEqual(plaintext.slice(0, 4096))
      expect(await session.read('r', plaintext.length - 10, 4096)).toEqual(plaintext.slice(-10))
      await session.close()
    }
  })

  test('single_chunk_larger_than_its_declared_stride_is_refused', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 4 * MiB, plaintext: patternBytes(300 * 1024) })
    const row = rowFor(fx)
    await expect(
      open(fx, {
        row: { ...row, download_version: { ...row.download_version!, chunk_size_bytes: 256 * 1024 } },
      }),
    ).rejects.toMatchObject({ kind: 'auth', index: 0 })
  })
})

// @@ A2
describe('LD-0001 r3 A2: a superseded read-ahead never ends the session', () => {
  test('seek_back_into_an_aborted_read_ahead_serves_bytes', async () => {
    const S = 32
    const N = 48
    const fx = encryptFixture({ pin: 2, chunkSize: S, plaintext: patternBytes(S * N) })
    const source = new FakeChunkSource(fx.frames)
    for (let i = 6; i <= 13; i++) source.deferred.add(i)
    const session = await open(fx, { source })
    const errors = errorsOf(session)

    expect(await session.read('a', 5 * S, 4)).toEqual(fx.plaintext.slice(5 * S, 5 * S + 4))
    await settle(4)
    expect(source.calls).toEqual(expect.arrayContaining([6, 7, 8, 9]))

    // Seek far ahead: the 6..13 read-ahead is superseded and aborted.
    const far = session.read('b', 40 * S, 4)
    expect(source.aborted).toEqual(expect.arrayContaining([6, 7, 8, 9]))
    for (let i = 6; i <= 13; i++) source.deferred.delete(i)

    // Seek back into the aborted window.
    const back = await session.read('c', 7 * S, 4)
    expect(back).toEqual(fx.plaintext.slice(7 * S, 7 * S + 4))
    expect(await far).toEqual(fx.plaintext.slice(40 * S, 40 * S + 4))
    expect(errors).toEqual([])
    await session.close()
  })
})

// @@ A3
/** What Comlink.transfer does to the sender: the buffer moves, the sender's view is left empty. */
function detach(frame: Uint8Array): Uint8Array {
  return structuredClone(frame, { transfer: [frame.buffer] })
}

/** The production worker factory over in-process ports that transfer like the worker hop. */
function transferringWorkerFactory(ops: ContentOps): StreamReaderFactory {
  const decryptorPort: DecryptorPort = {
    decryptorPushFrame: async (handle, frame) => ops.decryptorPushFrame(handle, detach(frame)),
    decryptorFinish: async (handle) => ops.decryptorFinish(handle),
    decryptorDispose: async (handle) => ops.decryptorDispose(handle),
  }
  const readerPort: ChunkReaderPort = {
    createChunkReader: async (handle) => ops.createChunkReader(handle),
    openChunkAt: async (handle, index, isLast, frame) =>
      ops.openChunkAt(handle, index, isLast, detach(frame)),
    closeChunkReader: async (handle) => ops.closeChunkReader(handle),
  }
  return createWorkerReaderFactory({
    startDecryptStream: async (fileKey, fileId, pin) =>
      new StreamingDecryptor(ops.createDecryptor(fileKey, fileId, pin), decryptorPort),
    createChunkReader: (decryptor) => createChunkReader(decryptor, readerPort),
  })
}

describe('LD-0001 r3 A3: the chunk-0 repair path in the worker factory', () => {
  test('repair_receives_the_whole_head_frame_and_the_retry_opens', async () => {
    const ops = createContentOps(wasm)
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const seen: Uint8Array[] = []
    const repairedKey = fx.fileKey.slice()
    const session = await open(fx, {
      fileKey: seededKey(99),
      readerFactory: transferringWorkerFactory(ops),
      repair: async (frame) => {
        seen.push(frame.slice())
        return repairedKey
      },
    })
    expect(seen.length).toBe(1)
    expect(seen[0]).toEqual(fx.frames[0])
    expect(await session.read('r', 32, 32)).toEqual(fx.plaintext.slice(32, 64))
    // The page's copy of the repaired key is wiped once the reader exists.
    expect(allZero(repairedKey)).toBe(true)
    expect(ops.liveDecryptorCount()).toBe(0)
    expect(ops.liveReaderCount()).toBe(1)
    await session.close()
    expect(ops.liveReaderCount()).toBe(0)
  })

  test('a_failing_retry_leaves_no_live_decryptor_and_wipes_the_repaired_key', async () => {
    const ops = createContentOps(wasm)
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const wrongRepair = seededKey(98)
    await expect(
      open(fx, {
        fileKey: seededKey(99),
        readerFactory: transferringWorkerFactory(ops),
        repair: async () => wrongRepair,
      }),
    ).rejects.toMatchObject({ kind: 'auth', index: 0 })
    expect(ops.liveDecryptorCount()).toBe(0)
    expect(ops.liveReaderCount()).toBe(0)
    expect(allZero(wrongRepair)).toBe(true)
  })
})

// @@ A4
describe('LD-0001 r3 A4: no setup failure leaves plaintext behind', () => {
  test('every_setup_failure_after_the_head_is_cached_wipes_it', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const dv = rowFor(fx).download_version!
    const tailSwapped = new FakeChunkSource(fx.frames)
    tailSwapped.overrides.set(2, fx.frames[1])
    const cases: Array<{ extra: Partial<OpenStreamOptions>; cachedIndices: number[] }> = [
      { extra: { row: { ...rowFor(fx), download_version: { ...dv, plaintext_size_bytes: 95 } } }, cachedIndices: [0, 2] },
      { extra: { row: { ...rowFor(fx), size_bytes: 95 } }, cachedIndices: [0, 2] },
      { extra: { source: tailSwapped }, cachedIndices: [0] },
    ]
    for (const c of cases) {
      const ops = createContentOps(wasm)
      const { log, observer } = observed()
      await expect(
        open(fx, { ...c.extra, observer, readerFactory: inProcessReaderFactory(ops) }),
      ).rejects.toMatchObject({ kind: 'auth' })
      expect(log.cached.map((e) => e.index)).toEqual(c.cachedIndices)
      for (const entry of log.cached) expect(allZero(entry.bytes)).toBe(true)
      expect(ops.liveReaderCount()).toBe(0)
    }
  })

  test('a_wrong_size_head_plaintext_is_zeroed_before_the_throw', async () => {
    const ops = createContentOps(wasm)
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const base = inProcessReaderFactory(ops)
    const handed: { bytes?: Uint8Array } = {}
    const factory: StreamReaderFactory = async (args) => {
      const out = await base(args)
      const padded = new Uint8Array(out.headPlaintext.length + 1)
      padded.set(out.headPlaintext)
      padded[padded.length - 1] = 0x5a
      out.headPlaintext.fill(0)
      handed.bytes = padded
      return { ...out, headPlaintext: padded }
    }
    await expect(open(fx, { readerFactory: factory })).rejects.toMatchObject({ kind: 'auth', index: 0 })
    expect(handed.bytes).toBeDefined()
    expect(allZero(handed.bytes!)).toBe(true)
    expect(ops.liveReaderCount()).toBe(0)
  })
})

