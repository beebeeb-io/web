/**
 * LD-0001 PR-C round 2 — the /code-review findings.
 *
 * Everything here drives web's real code against real core crypto through the
 * committed WASM build (see test/helpers/wasm-crypto-mirror.ts). `fetch` is
 * stubbed with a small-piece stream so a test can observe the transfer while
 * bytes are still arriving.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installWasmCryptoMirror, toHex } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const mirror = await installWasmCryptoMirror()
const { wasm, ops } = mirror

await mockModuleScoped('../src/lib/decrypt-events', import.meta.dir, {
  dispatchDecrypted: () => {},
})
await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getToken: () => null,
  getApiUrl: () => 'http://api.test',
})

const dl = await import('../src/lib/encrypted-download')
const policy = await import('../src/lib/preview-load-policy')
const { createTransferThrottle, TRANSFER_UI_THROTTLE_MS } = await import('../src/lib/progress-throttle')
type TransferProgress = import('../src/lib/encrypted-download').TransferProgress

// ── Fixtures ────────────────────────────────────────────────────────────────

interface Fixture {
  fileId: string
  fileKey: Uint8Array
  name: string
  wire: Uint8Array
  chunkCount: number
  chunkSize: number
  plain: Uint8Array
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function buildFixture(opts: {
  plaintextLength?: number
  chunkSize?: number
  name?: string
  mime?: string | null
} = {}): Fixture {
  const masterKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
  const fileId = '1d0001c0-0000-4000-8000-0000000000c2'
  const fileKey = wasm.derive_file_key(masterKey, new TextEncoder().encode(fileId)) as Uint8Array
  const chunkSize = opts.chunkSize ?? 64
  const plainLength = opts.plaintextLength ?? 150
  const plain = new Uint8Array(plainLength).map((_, i) => (i * 31 + 11) & 0xff)
  const enc = wasm.WasmChunkEncryptor.withChunkSize(masterKey, fileId, BigInt(plain.length), BigInt(chunkSize))
  const wireParts: Uint8Array[] = []
  for (let off = 0; off < plain.length; off += chunkSize) {
    wireParts.push(enc.pushChunk(plain.slice(off, off + chunkSize)) as Uint8Array)
  }
  enc.finish()
  const meta = wasm.encrypt_metadata(
    fileKey,
    JSON.stringify({ name: opts.name ?? 'progress.bin', mime_type: opts.mime ?? null }),
  ) as { nonce: Uint8Array; ciphertext: Uint8Array }
  const name = JSON.stringify({
    cipher_suite: 'V1Aes256Gcm',
    nonce: Array.from(meta.nonce),
    ciphertext: Array.from(meta.ciphertext),
  })
  return { fileId, fileKey, name, wire: concat(wireParts), chunkCount: wireParts.length, chunkSize, plain }
}

// ── Stub server ─────────────────────────────────────────────────────────────

interface Served {
  body: Uint8Array
  chunkCount: number
  chunkSize: number
  piece: number
  contentLength: number | null
}
let served: Served | null = null
let fetchCalls = 0
const realFetch = globalThis.fetch

beforeEach(() => {
  served = null
  fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls++
    if (!served) return new Response('not found', { status: 404 })
    const headers: Record<string, string> = {
      'X-Chunk-Count': String(served.chunkCount),
      'X-Chunk-Size': String(served.chunkSize),
    }
    if (served.contentLength !== null) headers['Content-Length'] = String(served.contentLength)
    const body = served.body
    const piece = served.piece
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let off = 0; off < body.length; off += piece) c.enqueue(body.slice(off, off + piece))
        c.close()
      },
    })
    return new Response(stream, { status: 200, headers })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})
afterAll(() => {
  globalThis.fetch = realFetch
})

function serve(f: Fixture, opts: { body?: Uint8Array; piece?: number; contentLength?: number | null } = {}) {
  served = {
    body: opts.body ?? f.wire,
    chunkCount: f.chunkCount,
    chunkSize: f.chunkSize,
    piece: opts.piece ?? 7,
    contentLength: opts.contentLength === undefined ? (opts.body ?? f.wire).length : opts.contentLength,
  }
}

function allZero(bytes: Uint8Array): boolean {
  for (const b of bytes) if (b !== 0) return false
  return true
}

function pieceStream(bytes: Uint8Array, piece: number, onCancel?: (reason: unknown) => void) {
  let off = 0
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (off >= bytes.byteLength) { c.close(); return }
      const end = Math.min(off + piece, bytes.byteLength)
      c.enqueue(bytes.subarray(off, end))
      off = end
    },
    cancel(reason) { onCancel?.(reason) },
  })
}

async function expectRejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (err) {
    return err
  }
  throw new Error('expected the promise to reject')
}

// ── Item 1: one copy per byte ───────────────────────────────────────────────

test('frame_assembly_copies_each_byte_a_bounded_number_of_times', async () => {
  // 4 chunks of 4 KiB read in 1 KiB pieces: the old growable buffer copied its
  // whole contents on every read (quadratic in pieces-per-frame).
  const f = buildFixture({ plaintextLength: 4096 * 4, chunkSize: 4096 })
  expect(f.chunkCount).toBe(4)

  const realSet = Uint8Array.prototype.set
  const realSlice = Uint8Array.prototype.slice
  let copied = 0
  let counting = true
  Uint8Array.prototype.set = function (this: Uint8Array, src: ArrayLike<number>, offset?: number) {
    const n = src.length
    if (counting && n >= 512) copied += n
    return realSet.call(this, src as never, offset as never)
  } as never
  Uint8Array.prototype.slice = function (this: Uint8Array, start?: number, end?: number) {
    const out = realSlice.call(this, start as never, end as never)
    if (counting && out.byteLength >= 512) copied += out.byteLength
    return out
  } as never
  // The WASM boundary copies the frame into linear memory and the plaintext
  // back out; that cost is the same for any assembly strategy, so it is not
  // part of "how many times does the assembler copy each byte".
  const originalPush = ops.decryptorPushFrame
  ops.decryptorPushFrame = async (handle, frame) => {
    counting = false
    try {
      return await originalPush(handle, frame)
    } finally {
      counting = true
    }
  }

  let bytesOut = 0
  try {
    await dl.pipeDecryptedChunks(
      pieceStream(f.wire, 1024),
      f.fileKey,
      // PIN_UNRECORDED (0): this fixture's metadata records no chunk_format.
      { fileId: f.fileId, pin: 0 },
      f.chunkCount,
      f.plain.length,
      f.chunkSize,
      undefined,
      async (part) => { bytesOut += part.byteLength },
      undefined,
    )
  } finally {
    counting = false
    ops.decryptorPushFrame = originalPush
    Uint8Array.prototype.set = realSet
    Uint8Array.prototype.slice = realSlice
  }

  expect(bytesOut).toBe(f.plain.length)
  // One copy per byte in, plus the sub-frame carry into the next frame: a
  // quadratic assembler copied the whole partial frame on every read.
  expect(copied).toBeLessThanOrEqual(2 * f.wire.byteLength)
})

// ── Item 3: output allocated first, wiped on a throwing done emit ───────────

test('throwing_on_done_leaves_the_whole_output_zeroed', async () => {
  const f = buildFixture()
  serve(f)
  const captured: Uint8Array[] = []
  const originalPush = ops.decryptorPushFrame
  ops.decryptorPushFrame = async (handle, frame) => {
    const out = await originalPush(handle, frame)
    captured.push(out)
    return out
  }
  // Record every zero fill of a plaintext-sized buffer: the only one in this
  // run is `out.fill(0)` on the error path.
  const realFill = Uint8Array.prototype.fill
  const wiped: Uint8Array[] = []
  Uint8Array.prototype.fill = function (this: Uint8Array, value: number, start?: number, end?: number) {
    if (value === 0 && this.byteLength === f.plain.length) wiped.push(this)
    return realFill.call(this, value, start as never, end as never)
  } as never
  try {
    const err = await expectRejection(
      dl.decryptToBlob(f.fileId, f.fileKey, f.name, null, f.chunkCount, f.plain.length, {
        onProgress: (p) => { if (p.phase === 'done') throw new Error('progress observer exploded') },
      }),
    )
    expect((err as Error).message).toBe('progress observer exploded')
  } finally {
    ops.decryptorPushFrame = originalPush
    Uint8Array.prototype.fill = realFill
  }
  expect(captured.length).toBe(3)
  for (const part of captured) expect(allZero(part)).toBe(true)
  expect(wiped.length).toBeGreaterThan(0)
  for (const buf of wiped) expect(allZero(buf)).toBe(true)
})

// ── Item 4: no Content-Length → buffered path, real body length ─────────────

test('missing_content_length_uses_the_real_body_length_for_the_legacy_rule', async () => {
  const f = buildFixture()
  // `size_bytes` holds the ENCRYPTED total, exactly the legacy server bug.
  serve(f, { contentLength: null })
  const events: TransferProgress[] = []
  const { plaintext } = await dl.decryptToBlob(
    f.fileId, f.fileKey, f.name, null, f.chunkCount, f.wire.length,
    { onProgress: (p) => events.push({ ...p }) },
  )
  expect(toHex(new Uint8Array(await plaintext.arrayBuffer()))).toBe(toHex(f.plain))
  expect(events.length).toBe(1)
  expect(events[0].phase).toBe('done')
  expect(events[0].decryptedChunks).toBe(f.chunkCount)
})

// ── Item 5: every decrypted part emits ──────────────────────────────────────

test('every_decrypted_part_emits_its_own_progress_event', async () => {
  const f = buildFixture()
  expect(f.chunkCount).toBeGreaterThanOrEqual(3)
  // The whole body arrives in one read, so decryption starts only after the
  // last byte is in: the phase is 'decrypting' for every part.
  serve(f, { piece: f.wire.byteLength })
  const events: TransferProgress[] = []
  await dl.decryptToBlob(
    f.fileId, f.fileKey, f.name, null, f.chunkCount, f.plain.length,
    { onProgress: (p) => events.push({ ...p }) },
  )
  const decryptedPartCounts = events
    .filter((e) => e.phase === 'decrypting' && e.decryptedChunks > 0)
    .map((e) => e.decryptedChunks)
  expect(decryptedPartCounts).toEqual([1, 2, 3])
})

// ── Item 6: cap decided on authenticated metadata, before the fetch ─────────

test('over_cap_video_is_refused_before_any_fetch', async () => {
  const cap = policy.WHOLE_FILE_MEDIA_CAP_BYTES
  // Authenticated metadata says video; the caller's UI name and MIME are null.
  const f = buildFixture({ name: 'holiday.mp4', mime: 'video/mp4' })
  const err = await expectRejection(
    dl.decryptToBlob(f.fileId, f.fileKey, f.name, null, f.chunkCount, cap + 1, {
      mediaCapBytes: cap,
    }),
  )
  expect(err).toBeInstanceOf(policy.TooLargeToPreviewError)
  expect((err as InstanceType<typeof policy.TooLargeToPreviewError>).kind).toBe('video')
  expect(fetchCalls).toBe(0)
})

// ── Item 8: the body is cancelled on a decrypt failure ──────────────────────

test('a_decrypt_failure_cancels_the_source_body', async () => {
  const f = buildFixture()
  expect(f.chunkCount).toBe(3)
  const bad = f.wire.slice()
  // Flip a ciphertext byte inside the SECOND frame (frames are 92/92/50).
  bad[92 + 20] ^= 0xff
  let cancelled = 0
  const err = await expectRejection(
    dl.pipeDecryptedChunks(
      pieceStream(bad, 7, () => { cancelled++ }),
      f.fileKey,
      // PIN_UNRECORDED (0): this fixture's metadata records no chunk_format.
      { fileId: f.fileId, pin: 0 },
      f.chunkCount,
      f.plain.length,
      f.chunkSize,
      undefined,
      async () => {},
      undefined,
    ),
  )
  expect(err).toBeInstanceOf(Error)
  expect(cancelled).toBe(1)
})

// ── Item 9: an abort is an AbortError, not a truncation ─────────────────────

test('aborting_mid_body_rejects_with_AbortError', async () => {
  const f = buildFixture()
  const abort = new AbortController()
  // Never closes on its own: the reader is parked mid-body until the abort.
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(f.wire.slice(0, 10)) },
  })
  setTimeout(() => abort.abort(), 5)
  const err = await expectRejection(
    dl.pipeDecryptedChunks(
      body,
      f.fileKey,
      // PIN_UNRECORDED (0): this fixture's metadata records no chunk_format.
      { fileId: f.fileId, pin: 0 },
      f.chunkCount,
      f.plain.length,
      f.chunkSize,
      abort.signal,
      async () => {},
      undefined,
    ),
  )
  expect((err as Error).name).toBe('AbortError')
})

// ── Item 11: media routing matches pickRenderer ─────────────────────────────

describe('media kind routing', () => {
  test('audio_mime_mp4_name_routes_as_video', () => {
    expect(policy.mediaKind('audio/mp4', 'clip.mp4')).toBe('video')
    const cap = policy.WHOLE_FILE_MEDIA_CAP_BYTES
    expect(policy.isWholeFileMediaOverCap('audio/mp4', 'clip.mp4', cap + 1)).toBe(true)
  })

  test('pdf_named_mp4_is_not_capped', () => {
    const cap = policy.WHOLE_FILE_MEDIA_CAP_BYTES
    expect(policy.mediaKind('application/pdf', 'x.mp4')).toBe(null)
    expect(policy.isWholeFileMediaOverCap('application/pdf', 'x.mp4', cap + 1)).toBe(false)
  })

  test('extension_helper_is_shared_with_the_renderer_rule', () => {
    expect(policy.getExtension('clip.MP4')).toBe('mp4')
    expect(policy.getExtension('Dockerfile')).toBe('dockerfile')
    expect(policy.VIDEO_EXTENSIONS_SET.has('mkv')).toBe(true)
    expect(policy.AUDIO_EXTENSIONS_SET.has('flac')).toBe(true)
  })
})

// ── Item 2: the over-cap card streams, it never buffers ─────────────────────

describe('download route', () => {
  test('over_cap_card_streams_to_disk', () => {
    expect(policy.downloadRoute(false, true)).toBe('stream')
    expect(policy.downloadRoute(false, false)).toBe('blob')
    expect(policy.downloadRoute(true, true)).toBe('blob')
  })
})

// ── Item 12: at most one UI update per 150 ms ───────────────────────────────

describe('transfer throttle', () => {
  const event = (over: Partial<TransferProgress>): TransferProgress => ({
    phase: 'downloading', receivedBytes: 0, totalBytes: 100, decryptedChunks: 0, totalChunks: 1, ...over,
  })

  test('throttles_between_phase_changes_and_flushes_the_last_value', () => {
    const updates: TransferProgress[] = []
    let clock = 0
    const pending: Array<() => void> = []
    const t = createTransferThrottle(
      (p) => updates.push(p),
      () => clock,
      (fn) => { pending.push(fn); return 0 as never },
      () => {},
    )

    t.push(event({ receivedBytes: 10 })) // first event: emit
    clock = 20
    t.push(event({ receivedBytes: 20 })) // throttled
    clock = 40
    t.push(event({ receivedBytes: 30 })) // throttled, still one timer
    expect(updates.length).toBe(1)
    expect(pending.length).toBe(1)

    pending[0]() // trailing flush
    expect(updates.map((u) => u.receivedBytes)).toEqual([10, 30])

    clock = 500
    t.push(event({ phase: 'done', receivedBytes: 100 }))
    expect(updates.at(-1)?.phase).toBe('done')
    expect(TRANSFER_UI_THROTTLE_MS).toBe(150)
  })

  test('phase_change_emits_immediately_and_drops_the_pending_timer', () => {
    const updates: TransferProgress[] = []
    let clock = 0
    const pending: Array<() => void> = []
    const t = createTransferThrottle(
      (p) => updates.push(p),
      () => clock,
      (fn) => { pending.push(fn); return 0 as never },
      () => {},
    )
    t.push(event({ receivedBytes: 10 }))
    clock = 10
    t.push(event({ receivedBytes: 20 }))
    clock = 20
    t.push(event({ phase: 'decrypting', receivedBytes: 100 }))
    expect(updates.map((u) => u.phase)).toEqual(['downloading', 'decrypting'])
    t.flush()
    expect(updates.length).toBe(2)
  })
})

// ── Item 13: one legacy size rule ───────────────────────────────────────────

test('legacy_size_rule_has_one_implementation', () => {
  // 3 chunks of overhead 28: encrypted total 234 stored as size_bytes.
  expect(dl.plaintextSizeFor(234, 234, 3)).toBe(150)
  expect(dl.plaintextSizeFor(150, 234, 3)).toBe(150)
  expect(dl.plaintextSizeFor(150, null, 3)).toBe(150)
})
