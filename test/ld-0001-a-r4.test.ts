/**
 * LD-0001 PR-A round 4 (web #207): the delta-review fixes for the stream
 * session. Real core WASM frames; the server is a fake `ChunkFrameSource`.
 * One describe block per review row (A-R1 .. A-R4).
 */
import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import {
  encryptFixture,
  FakeChunkSource,
  FakeClock,
  inProcessReaderFactory,
  patternBytes,
  seededKey,
  settle,
  type Fixture,
} from './helpers/media-stream-fixtures'
import { createContentOps } from '../src/lib/content-crypto'
import {
  createChunkReader,
  StreamingDecryptor,
  type ChunkReaderPort,
  type DecryptorPort,
} from '../src/lib/crypto'
import { ApiError } from '../src/lib/api'
import {
  createWorkerReaderFactory,
  openStreamSession,
  type OpenStreamOptions,
  type StreamEvent,
  type StreamReaderFactory,
  type StreamRow,
  type StreamSession,
} from '../src/lib/media-stream/session'

const wasm = loadWasm()
const MiB = 1024 * 1024

function rowFor(fx: Fixture): StreamRow {
  return {
    chunk_count: fx.chunkCount,
    size_bytes: fx.plaintext.length,
    download_version: {
      object_version_id: 'ov-1',
      version_number: 1,
      chunk_count: fx.chunkCount,
      chunk_size_bytes: fx.chunkSize,
      plaintext_size_bytes: fx.plaintext.length,
      ciphertext_size_bytes: fx.frames.reduce((n, f) => n + f.length, 0),
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

type Outcome =
  | { state: 'resolved'; value: unknown }
  | { state: 'rejected'; error: unknown }
  | { state: 'pending' }

async function outcome(p: Promise<unknown>, turns = 8): Promise<Outcome> {
  const box: { result: Outcome } = { result: { state: 'pending' } }
  p.then(
    (value) => {
      box.result = { state: 'resolved', value }
    },
    (error) => {
      box.result = { state: 'rejected', error }
    },
  )
  await settle(turns)
  return box.result
}

/** A row that claims ONE chunk of `chunkSize` bytes. */
function oneChunkRow(chunkSize: number): StreamRow {
  return {
    chunk_count: 1,
    size_bytes: chunkSize,
    download_version: {
      object_version_id: 'ov-1',
      version_number: 1,
      chunk_count: 1,
      chunk_size_bytes: chunkSize,
      plaintext_size_bytes: chunkSize,
      ciphertext_size_bytes: chunkSize + 28,
      chunks: [{ index: 0, size_bytes: chunkSize + 28 }],
    },
  }
}

describe('LD-0001 r4 A-R1: a one-chunk row must hold the last chunk', () => {
  test('a_3_chunk_v2_file_served_as_one_chunk_is_refused', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    expect(fx.chunkCount).toBe(3)
    const ops = createContentOps(wasm)
    // A server that lies consistently: X-Chunk-Count 1 and a one-chunk row.
    await expect(
      open(fx, {
        source: new FakeChunkSource(fx.frames, 1),
        row: oneChunkRow(32),
        readerFactory: inProcessReaderFactory(ops),
      }),
    ).rejects.toMatchObject({ kind: 'auth', index: 0 })
    expect(ops.liveReaderCount()).toBe(0)
  })

  test('an_honest_one_chunk_v2_file_still_opens', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 4 * MiB, plaintext: patternBytes(300) })
    expect(fx.chunkCount).toBe(1)
    const session = await open(fx)
    expect(session.totalSize).toBe(300)
    expect(await session.read('r', 0, 300)).toEqual(fx.plaintext)
    await session.close()
  })

  test('v1_binds_no_last_flag_so_a_truncated_v1_row_opens_documented', async () => {
    // Format 1 (every upload today) carries no last flag: the documented v1
    // weakness of contract §5.7, the same as the whole-file path.
    const fx = encryptFixture({ pin: 0, chunkSize: 32, plaintext: patternBytes(96) })
    const session = await open(fx, { source: new FakeChunkSource(fx.frames, 1), row: oneChunkRow(32) })
    expect(session.totalSize).toBe(32)
    await session.close()
  })
})

describe("LD-0001 r4 A-R2: 'auth' means a frame failed authentication, nothing else", () => {
  const refusals: Array<[number, string]> = [
    [401, 'unauthorized'],
    [403, 'unavailable'],
    [404, 'unavailable'],
    [410, 'unavailable'],
    [400, 'unavailable'],
  ]

  test('http_refusals_during_setup_are_never_auth', async () => {
    for (const [status, kind] of refusals) {
      const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
      const source = new FakeChunkSource(fx.frames)
      source.fetchFrame = async () => {
        throw new ApiError('refused', status)
      }
      await expect(open(fx, { source })).rejects.toMatchObject({ kind })
    }
  })

  test('a_refused_part_mid_stream_is_unavailable_not_auth', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const source = FakeChunkSource.lazy(
      (index) => (index === 1 ? undefined : fx.frames[index]) as Uint8Array,
      3,
    )
    const session = await open(fx, { source })
    const errors: StreamEvent[] = []
    session.onEvent((e) => {
      if (e.type === 'error') errors.push(e)
    })
    await expect(session.read('r', 32, 4)).rejects.toMatchObject({ kind: 'unavailable', index: 1 })
    expect(errors).toEqual([{ type: 'error', kind: 'unavailable', index: 1 }])
    await session.close()
  })

  test('a_reader_factory_that_fails_to_load_is_internal', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const factory: StreamReaderFactory = async () => {
      throw new Error('the crypto worker failed to load')
    }
    await expect(open(fx, { readerFactory: factory })).rejects.toMatchObject({ kind: 'internal', index: 0 })
  })

  test('a_worker_failure_mid_stream_is_internal', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const base = inProcessReaderFactory(createContentOps(wasm))
    const factory: StreamReaderFactory = async (args) => {
      const out = await base(args)
      const inner = out.reader
      return {
        ...out,
        reader: {
          openAt: async (index, isLast, frame) => {
            if (index === 1) throw new Error('postMessage to the crypto worker failed')
            return inner.openAt(index, isLast, frame)
          },
          close: () => inner.close(),
        },
      }
    }
    const session = await open(fx, { readerFactory: factory })
    await expect(session.read('r', 32, 4)).rejects.toMatchObject({ kind: 'internal', index: 1 })
    await session.close()
  })

  test('a_frame_that_fails_aead_is_still_auth', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(128) })
    // The wrong key at setup (no repair): chunk 0 does not open.
    await expect(open(fx, { fileKey: seededKey(99) })).rejects.toMatchObject({ kind: 'auth', index: 0 })
    // A swapped frame mid-stream.
    const swapped = [...fx.frames]
    ;[swapped[1], swapped[2]] = [swapped[2], swapped[1]]
    const source = new FakeChunkSource(swapped)
    source.deferred.add(2)
    const session = await open(fx, { source })
    await expect(session.read('r', 32, 4)).rejects.toMatchObject({ kind: 'auth', index: 1 })
    await session.close()
  })

  test('records_that_disagree_are_unavailable_not_auth', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    // X-Chunk-Count disagrees with the row: no frame failed authentication.
    await expect(open(fx, { source: new FakeChunkSource(fx.frames, 2) })).rejects.toMatchObject({
      kind: 'unavailable',
    })
    await expect(open(fx, { row: { ...rowFor(fx), size_bytes: 95 } })).rejects.toMatchObject({
      kind: 'unavailable',
    })
  })
})

describe('LD-0001 r4 A-R3: a reader created before a failed reply is closed', () => {
  test('a_reader_created_before_a_rejected_create_reply_is_closed_by_handle', async () => {
    const ops = createContentOps(wasm)
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const decryptorPort: DecryptorPort = {
      decryptorPushFrame: async (handle, frame) => ops.decryptorPushFrame(handle, frame),
      decryptorFinish: async (handle) => ops.decryptorFinish(handle),
      decryptorDispose: async (handle) => ops.decryptorDispose(handle),
    }
    const readerPort: ChunkReaderPort = {
      // The worker builds the reader (and moves the key copy into it), then the
      // reply never makes it back to the page.
      createChunkReader: async (handle) => {
        ops.createChunkReader(handle)
        throw new Error('the reply from the crypto worker was lost')
      },
      openChunkAt: async (handle, index, isLast, frame) => ops.openChunkAt(handle, index, isLast, frame),
      closeChunkReader: async (handle) => ops.closeChunkReader(handle),
    }
    const factory = createWorkerReaderFactory({
      startDecryptStream: async (fileKey, fileId, pin) =>
        new StreamingDecryptor(ops.createDecryptor(fileKey, fileId, pin), decryptorPort),
      createChunkReader: (decryptor) => createChunkReader(decryptor, readerPort),
    })
    await expect(open(fx, { readerFactory: factory })).rejects.toThrow()
    expect(ops.liveReaderCount()).toBe(0)
    expect(ops.liveDecryptorCount()).toBe(0)
  })
})

describe('LD-0001 r4 A-R4: aborts are honoured everywhere', () => {
  test('close_removes_the_post_open_abort_listener', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const controller = new AbortController()
    const signal = controller.signal
    const live = new Set<unknown>()
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      if (type === 'abort') live.add(listener)
      add(type, listener, options)
    }) as typeof signal.addEventListener
    signal.removeEventListener = ((type: string, listener: EventListener, options?: EventListenerOptions) => {
      if (type === 'abort') live.delete(listener)
      remove(type, listener, options)
    }) as typeof signal.removeEventListener
    const session = await open(fx, { signal })
    expect(live.size).toBe(1)
    await session.close()
    expect(live.size).toBe(0)
  })

  test('a_fetch_that_lands_after_its_abort_is_never_decrypted', async () => {
    const S = 32
    const N = 48
    const fx = encryptFixture({ pin: 2, chunkSize: S, plaintext: patternBytes(S * N) })
    const spies = { openAt: [] as Array<{ index: number; isLast: boolean }>, repairs: 0 }
    let release7!: () => void
    const gate7 = new Promise<void>((resolve) => {
      release7 = resolve
    })
    const source = new FakeChunkSource(fx.frames)
    const base = source.fetchFrame.bind(source)
    // Chunk 7's request ignores its abort and answers late (a fetch already in
    // the network stack when the read-ahead was superseded).
    source.fetchFrame = async (index, signal) => {
      if (index === 7) {
        await gate7
        return { frame: fx.frames[7].slice(), chunkCount: N }
      }
      return base(index, signal)
    }
    const session = await open(fx, { source, readerFactory: inProcessReaderFactory(createContentOps(wasm), spies) })
    await session.read('a', 5 * S, 4)
    await settle(2)
    const far = session.read('b', 40 * S, 4)
    release7()
    await settle(6)
    expect(spies.openAt.some((o) => o.index === 7)).toBe(false)
    expect(await far).toEqual(fx.plaintext.slice(40 * S, 40 * S + 4))
    await session.close()
  })

  test('an_abort_during_a_retry_backoff_ends_the_open_at_once', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const source = new FakeChunkSource(fx.frames)
    source.transientFailures.set(0, 1)
    const clock = new FakeClock()
    const controller = new AbortController()
    const pending = open(fx, { source, clock, signal: controller.signal })
    await settle(4)
    // Chunk 0 failed once and now sleeps its 400 ms backoff on the fake clock.
    expect(clock.pendingTimers).toBeGreaterThan(0)
    controller.abort()
    const result = await outcome(pending)
    expect(result.state).toBe('rejected')
    expect(((result as { error: { name?: string } }).error).name).toBe('AbortError')
    expect(clock.pendingTimers).toBe(0)
  })
})
