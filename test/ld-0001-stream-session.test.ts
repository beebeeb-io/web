/**
 * LD-0001 PR-A: the stream session (setup §5, cache/window/timers §3,
 * stateless cursor reads, wipe §6). Fixtures are real core WASM frames; the
 * server is a fake `ChunkFrameSource`.
 *
 * T17 (`repaired_head_key_used_for_every_chunk`) is deferred to the rebase onto
 * web #204 (SF-0002): its repair helper is not on main yet.
 */
import { describe, expect, test } from 'bun:test'
import { loadWasm, hexToBytes, toHex, loadVectors } from './helpers/wasm-crypto-mirror'
import {
  encryptFixture,
  FakeChunkSource,
  FakeClock,
  inProcessReaderFactory,
  patternBytes,
  syntheticReaderFactory,
  settle,
  type Fixture,
} from './helpers/media-stream-fixtures'
import { createContentOps } from '../src/lib/content-crypto'
import { ApiError } from '../src/lib/api'
import { apiChunkSource } from '../src/lib/media-stream/source'
import {
  openStreamSession,
  StreamSessionError,
  type StreamSession,
  type StreamRow,
} from '../src/lib/media-stream/session'

const wasm = loadWasm()
const ops = createContentOps(wasm)
const vectors = loadVectors()
const MiB = 1024 * 1024

interface OpenOptions {
  source?: FakeChunkSource
  row?: Partial<StreamRow>
  readerFactory?: ReturnType<typeof inProcessReaderFactory>
  repair?: (frame: Uint8Array) => Promise<Uint8Array | null>
  clock?: FakeClock
  observer?: {
    cached: Array<{ index: number; bytes: Uint8Array }>
    wiped: Array<{ index: number; bytes: Uint8Array }>
  }
  spies?: { openAt: Array<{ index: number; isLast: boolean }>; repairs: number }
}

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

function open(fx: Fixture, opts: OpenOptions = {}): Promise<StreamSession> {
  const spies = opts.spies ?? { openAt: [], repairs: 0 }
  const observer = opts.observer
  return openStreamSession({
    fileId: fx.fileId,
    fileKey: fx.fileKey,
    content: { fileId: fx.fileId, pin: fx.pin },
    row: { ...rowFor(fx), ...opts.row },
    source: opts.source ?? new FakeChunkSource(fx.frames),
    clock: opts.clock ?? new FakeClock(),
    readerFactory: opts.readerFactory ?? inProcessReaderFactory(ops, spies),
    repair: opts.repair,
    observer: observer
      ? {
          onChunkCached: (index, bytes) => observer.cached.push({ index, bytes }),
          onChunkWiped: (index, bytes) => observer.wiped.push({ index, bytes }),
        }
      : undefined,
  })
}

function allZero(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0)
}

// ── Setup ────────────────────────────────────────────────────────────────────

describe('LD-0001 stream session setup', () => {
  test('head_and_tail_open_before_ready', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const source = new FakeChunkSource(fx.frames)
    const spies = { openAt: [] as Array<{ index: number; isLast: boolean }>, repairs: 0 }
    const session = await open(fx, { source, spies })
    // Setup fetched chunk 0 and N-1 before resolving.
    expect(new Set(source.calls)).toEqual(new Set([0, fx.chunkCount - 1]))
    // The head went through the factory; the tail through the reader with is_last=true.
    expect(spies.openAt).toEqual([{ index: fx.chunkCount - 1, isLast: true }])
    expect(session.chunkCount).toBe(fx.chunkCount)
    expect(session.chunkSize).toBe(32)
    expect(session.totalSize).toBe(fx.plaintext.length)
    expect([...session.verified].sort((a, b) => a - b)).toEqual([0, 2])
    await session.close()
  })

  test('v2_count_too_small_or_too_large_refuses_before_ready', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })

    // X-Chunk-Count says 2, the row says 3.
    const small = new FakeChunkSource(fx.frames, 2)
    await expect(open(fx, { source: small })).rejects.toMatchObject({ kind: 'auth' })

    // X-Chunk-Count says 4, the row says 3.
    const large = new FakeChunkSource(fx.frames, 4)
    await expect(open(fx, { source: large })).rejects.toMatchObject({ kind: 'auth' })

    // download_version.chunk_count disagrees with the row.
    await expect(
      open(fx, { row: { download_version: { ...rowFor(fx).download_version!, chunk_count: 2 } } }),
    ).rejects.toMatchObject({ kind: 'auth' })

    // v1 row, same rule.
    const v1 = encryptFixture({ pin: 0, chunkSize: 32, plaintext: patternBytes(96) })
    const v1Source = new FakeChunkSource(v1.frames, 2)
    await expect(open(v1, { source: v1Source })).rejects.toMatchObject({ kind: 'auth' })
  })

  test('setup_cross_checks_total_plaintext_and_chunk_size (A7)', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })

    await expect(
      open(fx, {
        row: { download_version: { ...rowFor(fx).download_version!, plaintext_size_bytes: 95 } },
      }),
    ).rejects.toMatchObject({ kind: 'auth' })

    await expect(
      open(fx, {
        row: { download_version: { ...rowFor(fx).download_version!, chunk_size_bytes: 31 } },
      }),
    ).rejects.toMatchObject({ kind: 'auth' })

    await expect(open(fx, { row: { size_bytes: 95 } })).rejects.toMatchObject({ kind: 'auth' })

    // The legacy "encrypted total stored in size_bytes" shape is tolerated.
    const encryptedTotal = rowFor(fx).download_version!.ciphertext_size_bytes
    const legacy = await open(fx, { row: { size_bytes: encryptedTotal } })
    expect(legacy.totalSize).toBe(96)
    await legacy.close()
  })
})

// ── Hostile content ──────────────────────────────────────────────────────────

describe('LD-0001 stream integrity', () => {
  test('v2_swapped_chunk_fails_at_its_index', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(128) })
    const swapped = [...fx.frames]
    ;[swapped[1], swapped[2]] = [swapped[2], swapped[1]]
    const source = new FakeChunkSource(swapped)
    // Hold the read-ahead window so the read of chunk 1 itself opens the
    // swapped frame (instead of a speculative open of chunk 2 failing first).
    source.deferred.add(2)
    const session = await open(fx, { source })
    await expect(session.read('r', 32, 32)).rejects.toMatchObject({ kind: 'auth', index: 1 })
    expect(session.retainedBytes()).toBe(0)
    await expect(session.read('r', 64, 32)).rejects.toMatchObject({ kind: 'auth' })
    await session.close()
  })

  test('v1_swapped_chunk_opens', async () => {
    // Each chunk has distinct bytes so a swap is visible in the plaintext.
    const plain = new Uint8Array(128)
    for (let i = 0; i < plain.length; i++) plain[i] = Math.floor(i / 32) + 1
    const fx = encryptFixture({ pin: 0, chunkSize: 32, plaintext: plain })
    const swapped = [...fx.frames]
    ;[swapped[1], swapped[2]] = [swapped[2], swapped[1]]
    const session = await open(fx, { source: new FakeChunkSource(swapped) })
    // Reading index 1 yields chunk 2's plaintext: v1 binds no position.
    expect(await session.read('r', 32, 32)).toEqual(plain.slice(64, 96))
    expect(await session.read('r', 64, 32)).toEqual(plain.slice(32, 64))
    await session.close()
  })

  test('every_chunk_request_carries_the_pin', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const urls: string[] = []
    const pinned = apiChunkSource(fx.fileId, 'version-1', {
      getApiUrl: () => 'http://api.test',
      getToken: () => 'tok',
      fetchImpl: (async (url: RequestInfo | URL) => {
        urls.push(String(url))
        const match = /\/chunks\/(\d+)\?/.exec(String(url))
        const index = match ? Number(match[1]) : -1
        return new Response(fx.frames[index]?.slice() ?? new Uint8Array(), {
          status: index >= 0 && index < fx.frames.length ? 200 : 404,
          headers: { 'X-Chunk-Count': String(fx.frames.length) },
        })
      }) as typeof fetch,
    })
    const session = await openStreamSession({
      fileId: fx.fileId,
      fileKey: fx.fileKey,
      content: { fileId: fx.fileId, pin: 2 },
      row: rowFor(fx),
      source: pinned,
      clock: new FakeClock(),
      readerFactory: inProcessReaderFactory(ops, { openAt: [], repairs: 0 }),
    })
    await session.read('r', 32, 32)
    expect(urls.length).toBe(3)
    for (const url of urls) {
      expect(url).toContain('?object_version_id=version-1')
    }
    await session.close()
  })

  test('pinned_409_is_changed_not_auth_error', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const source = new FakeChunkSource(fx.frames)
    source.overrides.set(1, null)
    const changed = await open(fx, { source })
    await expect(changed.read('r', 32, 1)).rejects.toMatchObject({ kind: 'changed', index: 1 })
    await expect(changed.read('r', 64, 1)).rejects.toMatchObject({ kind: 'changed' })
    expect(changed.retainedBytes()).toBe(0)
    await changed.close()
  })

  test('v2_foreign_upload_chunk_fails', async () => {
    const fb = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(128) })
    const first = encryptFixture({
      pin: 2,
      chunkSize: 32,
      plaintext: patternBytes(128),
      masterKey: fb.masterKey,
      fileId: fb.fileId,
    })
    // Same file id + key, a different upload: a different version id.
    expect(toHex(first.frames[0].slice(0, 12))).not.toBe(toHex(fb.frames[0].slice(0, 12)))
    const source = new FakeChunkSource(fb.frames)
    source.overrides.set(1, first.frames[1])
    const session = await open(fb, { source })
    await expect(session.read('r', 32, 32)).rejects.toMatchObject({ kind: 'auth', index: 1 })
    await session.close()
  })

  test('wrong_frame_size_retries_once_then_errors', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(128) })
    const source = new FakeChunkSource(fx.frames)
    const oversized = new Uint8Array(fx.frames[1].length + 1)
    oversized.set(fx.frames[1])
    source.overrides.set(1, oversized)
    const session = await open(fx, { source })
    await expect(session.read('r', 32, 32)).rejects.toMatchObject({ kind: 'auth', index: 1 })
    expect(source.calls.filter((i) => i === 1).length).toBe(2)
    await session.close()

    // A one-off wrong size is recovered by the single retry.
    const goodSource = new FakeChunkSource(fx.frames)
    const bad = new Uint8Array(fx.frames[1].length + 1)
    bad.set(fx.frames[1])
    const original = goodSource.fetchFrame.bind(goodSource)
    let firstServe = true
    goodSource.fetchFrame = async (index, signal) => {
      const out = await original(index, signal)
      if (index === 1 && firstServe) {
        firstServe = false
        const wrong = new Uint8Array(out.frame.length + 1)
        wrong.set(out.frame)
        return { frame: wrong, chunkCount: out.chunkCount }
      }
      return out
    }
    const recovered = await open(fx, { source: goodSource })
    expect(await recovered.read('r', 32, 32)).toEqual(fx.plaintext.slice(32, 64))
    await recovered.close()
  })

  test('auth_failure_mid_stream_errors_and_wipes', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(128) })
    const source = new FakeChunkSource(fx.frames)
    source.overrides.set(2, fx.frames[1]) // not frame 2 at index 2
    const observer = { cached: [] as Array<{ index: number; bytes: Uint8Array }>, wiped: [] as Array<{ index: number; bytes: Uint8Array }> }
    const session = await open(fx, { source, observer })
    await expect(session.read('r', 64, 32)).rejects.toMatchObject({ kind: 'auth', index: 2 })
    // No retry: index 2 was fetched once (setup already fetched 0 and 3).
    expect(source.calls.filter((i) => i === 2).length).toBe(1)
    expect(session.retainedBytes()).toBe(0)
    expect(observer.cached.length).toBeGreaterThan(0)
    for (const entry of observer.cached) expect(allZero(entry.bytes)).toBe(true)
    await expect(session.read('r', 0, 32)).rejects.toMatchObject({ kind: 'auth' })
    await session.close()
  })

  test('repair_only_on_setup_chunk_0', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(128) })
    const repairedKey = new Uint8Array(32).fill(4)
    const calls: number[] = []
    const repair = async (_frame: Uint8Array) => {
      calls.push(calls.length)
      return repairedKey
    }

    // A failing tail never tries repair.
    const tailBad = new FakeChunkSource(fx.frames)
    tailBad.overrides.set(3, fx.frames[1])
    await expect(open(fx, { source: tailBad, repair })).rejects.toMatchObject({
      kind: 'auth',
      index: 3,
    })
    expect(calls.length).toBe(0)

    // A failing head tries repair exactly once (setup chunk 0 only).
    const headBad = new FakeChunkSource(fx.frames)
    headBad.overrides.set(0, fx.frames[1])
    // The repaired key can't open the frame either; the point is that setup
    // tried repair only for chunk 0.
    await expect(open(fx, { source: headBad, repair })).rejects.toMatchObject({ kind: 'auth' })
    expect(calls.length).toBe(1)
  })
})

// ── Cache, budget and pulls ──────────────────────────────────────────────────

function syntheticStream(chunkSize: number, chunkCount: number) {
  const source = FakeChunkSource.lazy((index) => {
    const frame = new Uint8Array(chunkSize + 28)
    frame.fill(index + 1, 28)
    return frame
  }, chunkCount)
  const spies = { openAt: [] as Array<{ index: number; isLast: boolean }>, repairs: 0 }
  return { source, spies }
}

function syntheticRow(chunkSize: number, chunkCount: number): StreamRow {
  const plaintext = chunkSize * (chunkCount - 1) + chunkSize
  const ciphertext = chunkCount * (chunkSize + 28)
  return {
    chunk_count: chunkCount,
    size_bytes: plaintext,
    download_version: {
      object_version_id: 'ov-1',
      version_number: 1,
      chunk_count: chunkCount,
      chunk_size_bytes: chunkSize,
      plaintext_size_bytes: plaintext,
      ciphertext_size_bytes: ciphertext,
      chunks: Array.from({ length: chunkCount }, (_, index) => ({ index, size_bytes: chunkSize + 28 })),
    },
  }
}

describe('LD-0001 stream cache and window', () => {
  test('retained_plaintext_never_exceeds_budget', async () => {
    const S = MiB
    const N = 70
    const { source, spies } = syntheticStream(S, N)
    const session = await openStreamSession({
      fileId: 'cache-budget',
      fileKey: new Uint8Array(32),
      content: { fileId: 'cache-budget', pin: 0 },
      row: syntheticRow(S, N),
      source,
      clock: new FakeClock(),
      readerFactory: syntheticReaderFactory(spies),
    })
    let max = session.retainedBytes()
    for (let index = 0; index < N; index++) {
      await session.read('r', index * S + 7, 1024)
      await settle(1)
      max = Math.max(max, session.retainedBytes())
      expect(session.retainedBytes()).toBeLessThanOrEqual(64 * MiB)
    }
    expect(max).toBeLessThanOrEqual(64 * MiB)
    expect(max).toBeGreaterThan(0)
    await session.close()
    expect(session.retainedBytes()).toBe(0)
  })

  test('evicted_and_closed_chunks_are_zeroed', async () => {
    const S = MiB
    const N = 70
    const { source, spies } = syntheticStream(S, N)
    const observer = { cached: [] as Array<{ index: number; bytes: Uint8Array }>, wiped: [] as Array<{ index: number; bytes: Uint8Array }> }
    const session = await openStreamSession({
      fileId: 'cache-wipe',
      fileKey: new Uint8Array(32),
      content: { fileId: 'cache-wipe', pin: 0 },
      row: syntheticRow(S, N),
      source,
      clock: new FakeClock(),
      readerFactory: syntheticReaderFactory(spies),
      observer: {
        onChunkCached: (index, bytes) => observer.cached.push({ index, bytes }),
        onChunkWiped: (index, bytes) => observer.wiped.push({ index, bytes }),
      },
    })
    for (let index = 0; index < N; index++) {
      await session.read('r', index * S, 16)
    }
    // Eviction wiped the earliest chunks.
    expect(observer.wiped.some((w) => w.index === 0)).toBe(true)
    for (const entry of observer.wiped) expect(allZero(entry.bytes)).toBe(true)
    await session.close()
    // Close wipes every chunk still cached.
    expect(session.retainedBytes()).toBe(0)
    for (const entry of observer.cached) expect(allZero(entry.bytes)).toBe(true)
  })

  test('read_ahead_follows_latest_pull', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(32 * 20) })
    const source = new FakeChunkSource(fx.frames)
    // Hold the early read-ahead window so the later pull has to supersede it.
    for (const index of [2, 3, 4, 5]) source.deferred.add(index)
    const session = await open(fx, { source })
    const first = session.read('req-a', 32, 4).catch(() => null)
    await settle(4)
    expect(source.calls).toEqual(expect.arrayContaining([2, 3, 4, 5]))

    const second = session.read('req-b', 12 * 32, 4)
    await settle(12)
    // The latest pull's window is fetched; the superseded window is dropped/aborted.
    expect(source.calls).toEqual(expect.arrayContaining([13, 14, 15, 16]))
    expect(source.calls).not.toContain(10)
    expect(source.calls).not.toContain(11)
    await second
    await first
    await session.close()
  })

  test('data_never_crosses_chunk_boundary_and_matches_offset', async () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 64, plaintext: patternBytes(150) })
    const session = await open(fx)
    const table: Array<[number, number, number]> = [
      [0, 1000, 64],
      [63, 1000, 1],
      [64, 1000, 64],
      [60, 10, 4],
      [127, 10, 1],
      [128, 1000, 22],
      [149, 1000, 1],
    ]
    for (const [offset, max, expectedLength] of table) {
      const out = await session.read('r', offset, max)
      expect(out.length).toBe(expectedLength)
      expect(out.length).toBeLessThanOrEqual(MiB)
      expect(out).toEqual(fx.plaintext.slice(offset, offset + expectedLength))
    }
    await expect(session.read('r', 150, 4)).rejects.toThrow(RangeError)
    await session.close()
  })

  test('two_idle_ranges_plus_active_never_block_at_32MiB', async () => {
    const S = 32 * MiB
    const N = 12
    const { source, spies } = syntheticStream(S, N)
    const session = await openStreamSession({
      fileId: 'idle-ranges',
      fileKey: new Uint8Array(32),
      content: { fileId: 'idle-ranges', pin: 0 },
      row: syntheticRow(S, N),
      source,
      clock: new FakeClock(),
      readerFactory: syntheticReaderFactory(spies),
    })
    expect(session.chunkSize).toBe(S)
    // Two idle ranges waiting on opposite ends, plus one active pull.
    const idleA = session.read('idle-a', 0, 16)
    const idleB = session.read('idle-b', 9 * S, 16)
    const active = session.read('active', 5 * S, 16)
    const results = await Promise.all([idleA, idleB, active])
    expect(results.map((r) => r.length)).toEqual([16, 16, 16])
    expect(session.retainedBytes()).toBeLessThanOrEqual(96 * MiB)
    // Reading back an evicted range re-fetches it by offset instead of blocking.
    const back = await session.read('active', 0, 16)
    expect(back).toEqual(results[0])
    expect(session.retainedBytes()).toBeLessThanOrEqual(96 * MiB)
    await session.close()
  })
})

// ── Network behaviour ────────────────────────────────────────────────────────

describe('LD-0001 stream network behaviour', () => {
  test('idle_attempt_aborts_then_retries_then_errors', async () => {
    const clock = new FakeClock()
    const bodies: Array<ReadableStreamDefaultController<Uint8Array>> = []
    const source = apiChunkSource('file-idle', 'ov-1', {
      clock,
      getApiUrl: () => 'http://api.test',
      getToken: () => null,
      fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            bodies.push(c)
            init?.signal?.addEventListener('abort', () =>
              c.error((init.signal as AbortSignal).reason),
            )
          },
        })
        return new Response(body, { status: 200, headers: { 'X-Chunk-Count': '3' } })
      }) as typeof fetch,
    })
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: patternBytes(96) })
    const pending = openStreamSession({
      fileId: fx.fileId,
      fileKey: fx.fileKey,
      content: { fileId: fx.fileId, pin: 2 },
      row: rowFor(fx),
      source,
      clock,
      readerFactory: inProcessReaderFactory(ops, { openAt: [], repairs: 0 }),
    }).catch((err) => err)
    // Head and tail each get 3 attempts, 400 ms · attempt apart.
    for (let i = 0; i < 12; i++) {
      clock.advance(10_000)
      await settle(4)
    }
    const err = await pending
    expect(err).toBeInstanceOf(StreamSessionError)
    expect((err as StreamSessionError).kind).toBe('network')
  })
})

// ── T33: one committed v2 vector pins the full guarantee ─────────────────────

describe('LD-0001 v2 vector full guarantee', () => {
  const v2 = vectors.chunk_v2_stream
  const V2_KEY = hexToBytes(v2.file_key_hex)
  const V2_FILE_ID = v2.file_id as string
  const V2_FRAMES = (v2.frames as Array<{ frame_hex: string }>).map((f) => hexToBytes(f.frame_hex))
  const V2_PLAIN = hexToBytes(v2.plaintext_hex)
  const S = v2.chunk_size as number
  const N = v2.chunk_count as number

  function vectorRow(overrides: Partial<StreamRow> = {}): StreamRow {
    const ciphertext = V2_FRAMES.reduce((n, f) => n + f.length, 0)
    return {
      chunk_count: N,
      size_bytes: V2_PLAIN.length,
      download_version: {
        object_version_id: 'ov-v2',
        version_number: 1,
        chunk_count: N,
        chunk_size_bytes: S,
        plaintext_size_bytes: V2_PLAIN.length,
        ciphertext_size_bytes: ciphertext,
        chunks: V2_FRAMES.map((f, index) => ({ index, size_bytes: f.length })),
      },
      ...overrides,
    }
  }

  async function openVector(source: FakeChunkSource, row = vectorRow(), repair?: (frame: Uint8Array) => Promise<Uint8Array | null>) {
    return openStreamSession({
      fileId: V2_FILE_ID,
      fileKey: V2_KEY,
      content: { fileId: V2_FILE_ID, pin: 2 },
      row,
      source,
      clock: new FakeClock(),
      readerFactory: inProcessReaderFactory(ops, { openAt: [], repairs: 0 }),
      repair,
    })
  }

  test('v2_vector_full_guarantee', async () => {
    // The honest stream opens every part, byte-exact.
    const honest = await openVector(new FakeChunkSource(V2_FRAMES))
    for (let index = 0; index < N; index++) {
      const out = await honest.read('r', index * S, S)
      expect(out).toEqual(V2_PLAIN.slice(index * S, (index + 1) * S))
    }
    expect([...honest.verified].sort((a, b) => a - b)).toEqual([0, 1, 2])
    await honest.close()

    // Swap: frame 1 served for frame 2 (the tail open fails before ready).
    const swapped = [...V2_FRAMES]
    ;[swapped[1], swapped[2]] = [swapped[2], swapped[1]]
    await expect(openVector(new FakeChunkSource(swapped))).rejects.toMatchObject({
      kind: 'auth',
      index: 2,
    })

    // Truncation: count − 1, the real last chunk opened as if it were last.
    const truncatedFrames = V2_FRAMES.slice(0, 2)
    const truncatedDv = {
      ...vectorRow().download_version!,
      chunk_count: 2,
      plaintext_size_bytes: S * 2,
      ciphertext_size_bytes: truncatedFrames.reduce((n, f) => n + f.length, 0),
      chunks: truncatedFrames.map((f, index) => ({ index, size_bytes: f.length })),
    }
    await expect(
      openVector(new FakeChunkSource(truncatedFrames), {
        chunk_count: 2,
        size_bytes: S * 2,
        download_version: truncatedDv,
      }),
    ).rejects.toMatchObject({ kind: 'auth', index: 1 })

    // Padding: count + 1, a frame served at an index past the real end.
    const paddedDv = {
      ...vectorRow().download_version!,
      chunk_count: 4,
      plaintext_size_bytes: S * 4,
    }
    await expect(
      openVector(new FakeChunkSource(V2_FRAMES), {
        chunk_count: 4,
        size_bytes: S * 4,
        download_version: paddedDv,
      }),
    ).rejects.toMatchObject({ kind: 'auth', index: 3 })

    // A foreign upload's chunk for the same file id and key: same key, other
    // version id, so the position/version binding fails.
    const foreignMk = new Uint8Array(32).fill(21)
    const foreignA = encryptFixture({
      pin: 2, chunkSize: S, plaintext: V2_PLAIN, fileId: V2_FILE_ID, masterKey: foreignMk,
    })
    const foreignB = encryptFixture({
      pin: 2, chunkSize: S, plaintext: V2_PLAIN, fileId: V2_FILE_ID, masterKey: foreignMk,
    })
    const foreignSource = new FakeChunkSource(foreignA.frames)
    foreignSource.overrides.set(1, foreignB.frames[1])
    const foreignSession = await openStreamSession({
      fileId: foreignA.fileId,
      fileKey: foreignA.fileKey,
      content: { fileId: foreignA.fileId, pin: 2 },
      row: rowFor(foreignA),
      source: foreignSource,
      clock: new FakeClock(),
      readerFactory: inProcessReaderFactory(ops, { openAt: [], repairs: 0 }),
    })
    await expect(foreignSession.read('r', S, S)).rejects.toMatchObject({ kind: 'auth', index: 1 })
    await foreignSession.close()

    // A wrong-size frame: retried once, then an authentication error.
    const wrongSizeSource = new FakeChunkSource(V2_FRAMES)
    const wrong = new Uint8Array(V2_FRAMES[1].length + 1)
    wrong.set(V2_FRAMES[1])
    wrongSizeSource.overrides.set(1, wrong)
    const wrongSession = await openVector(wrongSizeSource)
    await expect(wrongSession.read('r', S, S)).rejects.toMatchObject({ kind: 'auth', index: 1 })
    expect(wrongSizeSource.calls.filter((i) => i === 1).length).toBe(2)
    await wrongSession.close()

    // Repair is never tried on the tail.
    let repairCalls = 0
    const tailBad = new FakeChunkSource(V2_FRAMES)
    tailBad.overrides.set(2, V2_FRAMES[1])
    await expect(
      openVector(tailBad, vectorRow(), async () => {
        repairCalls++
        return new Uint8Array(32)
      }),
    ).rejects.toMatchObject({ kind: 'auth', index: 2 })
    expect(repairCalls).toBe(0)
  })
})
