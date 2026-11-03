/**
 * LD-0001 PR-A: the ciphertext source seam (§8) and the 10 s idle attempt
 * timer (§3). Injected clock; no bun fake timers.
 */
import { describe, expect, test } from 'bun:test'
import { ApiError } from '../src/lib/api'
import {
  apiChunkSource,
  ChunkIdleTimeoutError,
  StreamChangedError,
  type Clock,
} from '../src/lib/media-stream/source'
import { FakeClock, settle } from './helpers/media-stream-fixtures'

interface Captured {
  url: string
  init: RequestInit
}

function jsonResponse(body: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers })
}

describe('LD-0001 chunk frame source', () => {
  test('api_chunk_source_pins_every_request_and_returns_the_frame_and_count', async () => {
    const captured: Captured[] = []
    const source = apiChunkSource('file-1', 'ov-1', {
      getApiUrl: () => 'http://api.test',
      getToken: () => 'tok',
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        captured.push({ url: String(url), init: init ?? {} })
        return jsonResponse(new Uint8Array([1, 2, 3]), { 'X-Chunk-Count': '7' })
      }) as typeof fetch,
    })
    const ctrl = new AbortController()
    const first = await source.fetchFrame(0, ctrl.signal)
    const second = await source.fetchFrame(4, ctrl.signal)
    expect(first.frame).toEqual(new Uint8Array([1, 2, 3]))
    expect(first.chunkCount).toBe(7)
    expect(second.chunkCount).toBe(7)
    expect(captured.map((c) => c.url)).toEqual([
      'http://api.test/api/v1/files/file-1/chunks/0?object_version_id=ov-1',
      'http://api.test/api/v1/files/file-1/chunks/4?object_version_id=ov-1',
    ])
    for (const c of captured) {
      expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
      expect(c.init.credentials).toBe('include')
    }
  })

  test('a_409_is_stream_changed_and_any_other_non_ok_is_api_error', async () => {
    const source = apiChunkSource('file-1', 'ov-1', {
      getApiUrl: () => 'http://api.test',
      getToken: () => null,
      fetchImpl: (async (url: RequestInfo | URL) =>
        String(url).includes('/chunks/0?')
          ? new Response('conflict', { status: 409 })
          : new Response('boom', { status: 500 })) as typeof fetch,
    })
    const ctrl = new AbortController()
    await expect(source.fetchFrame(0, ctrl.signal)).rejects.toBeInstanceOf(StreamChangedError)
    await expect(source.fetchFrame(1, ctrl.signal)).rejects.toBeInstanceOf(ApiError)
    try {
      await source.fetchFrame(1, ctrl.signal)
    } catch (err) {
      expect((err as ApiError).status).toBe(500)
    }
  })

  test('idle_attempt_aborts_after_10s_without_a_byte_and_the_clock_resets_on_data', async () => {
    const clock = new FakeClock()
    let bodyCtrl: ReadableStreamDefaultController<Uint8Array> | null = null
    let fetchSignal: AbortSignal | null = null
    const source = apiChunkSource('file-1', 'ov-1', {
      clock,
      getApiUrl: () => 'http://api.test',
      getToken: () => null,
      fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        fetchSignal = init?.signal ?? null
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            bodyCtrl = c
            init?.signal?.addEventListener('abort', () =>
              c.error((init.signal as AbortSignal).reason),
            )
          },
        })
        return new Response(body, { status: 200, headers: { 'X-Chunk-Count': '3' } })
      }) as typeof fetch,
    })
    const ctrl = new AbortController()
    const pending = source.fetchFrame(0, ctrl.signal)
    let rejected: unknown = null
    pending.catch((err) => {
      rejected = err
    })
    await settle()
    expect(fetchSignal).not.toBeNull()

    // A byte at 5 s restarts the 10 s window.
    clock.advance(5_000)
    bodyCtrl!.enqueue(new Uint8Array([1]))
    await settle()
    clock.advance(9_000) // t=14 s, 9 s since the byte: still alive
    await settle()
    expect(rejected).toBeNull()
    clock.advance(1_000) // t=15 s: 10 s idle
    await settle(8)
    expect(rejected).toBeInstanceOf(ChunkIdleTimeoutError)
  })

  test('a caller abort is not reported as an idle timeout', async () => {
    const clock = new FakeClock()
    const source = apiChunkSource('file-1', 'ov-1', {
      clock,
      getApiUrl: () => 'http://api.test',
      getToken: () => null,
      fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            init?.signal?.addEventListener('abort', () =>
              c.error((init.signal as AbortSignal).reason),
            )
          },
        })
        return new Response(body, { status: 200 })
      }) as typeof fetch,
    })
    const ctrl = new AbortController()
    const pending = source.fetchFrame(2, ctrl.signal)
    await settle()
    ctrl.abort(new Error('cancelled by session'))
    await expect(pending).rejects.toThrow(/cancelled by session/)
  })
})

// The clock type must stay structural (the FakeClock above is one).
const _clock: Clock = new FakeClock()
void _clock
