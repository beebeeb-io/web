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
