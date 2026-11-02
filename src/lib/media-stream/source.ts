/**
 * LD-0001 PR-A: the ciphertext source seam (contract §8) and its only production
 * implementation today, `apiChunkSource`.
 *
 * One stored wire frame (`nonce || ciphertext || tag`) of the PINNED version,
 * by index. Every request carries `object_version_id`, the same auth headers
 * and `credentials: 'include'` as the whole-file download. A 409 means the
 * file was replaced → `StreamChangedError`; any other non-OK status is an
 * `ApiError`. The body is read under a 10 s idle timer (no byte received), on
 * the injected clock — never on real timers in tests.
 */
import { ApiError, getApiUrl, getToken } from '../api'

/** One stored wire frame of the pinned version, by index. */
export interface ChunkFrameSource {
  fetchFrame(
    index: number,
    signal: AbortSignal,
  ): Promise<{ frame: Uint8Array; chunkCount: number | null }>
}

/** The pinned version is gone: the file changed while it was playing. Never an auth error. */
export class StreamChangedError extends Error {
  constructor(message = 'the file changed') {
    super(message)
    this.name = 'StreamChangedError'
  }
}

/** The 10 s idle attempt abort (contract §3). Counts as a failed attempt. */
export class ChunkIdleTimeoutError extends Error {
  constructor(message = 'chunk fetch stalled') {
    super(message)
    this.name = 'ChunkIdleTimeoutError'
  }
}

/** Injected time. Tests drive it manually; nothing in the stream reads Date directly. */
export interface Clock {
  now(): number
  setTimeout(cb: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
}

export interface ChunkSourceDeps {
  clock?: Clock
  getApiUrl?: () => string
  getToken?: () => string | null
  fetchImpl?: typeof fetch
  /** Idle limit per attempt; overridable only for tests. */
  idleMs?: number
}

export const CHUNK_IDLE_MS = 10_000

function parseChunkCount(value: string | null): number | null {
  if (!value) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function readBody(
  res: Response,
  onByte: () => void,
): Promise<Uint8Array> {
  if (!res.body) {
    return new Uint8Array(await res.arrayBuffer())
  }
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length) {
        parts.push(value)
        length += value.length
        onByte()
      }
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * The API-backed source for the pinned object version. `objectVersionId` is
 * required by contract §5.1: without the pin the server reads whatever version
 * is current, and the v1 (no position binding) files rely on that pin.
 */
export function apiChunkSource(
  fileId: string,
  objectVersionId: string,
  deps: ChunkSourceDeps = {},
): ChunkFrameSource {
  const clock = deps.clock ?? realClock
  const apiUrl = deps.getApiUrl ?? getApiUrl
  const token = deps.getToken ?? getToken
  const fetchImpl = deps.fetchImpl ?? fetch
  const idleMs = deps.idleMs ?? CHUNK_IDLE_MS

  return {
    async fetchFrame(index, signal) {
      const local = new AbortController()
      const onCallerAbort = () =>
        local.abort(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      if (signal.aborted) onCallerAbort()
      else signal.addEventListener('abort', onCallerAbort, { once: true })

      let idleFired = false
      let timer: unknown = null
      const arm = () => {
        timer = clock.setTimeout(() => {
          idleFired = true
          local.abort(new ChunkIdleTimeoutError(`chunk ${index} received no byte for ${idleMs} ms`))
        }, idleMs)
      }
      const onByte = () => {
        clock.clearTimeout(timer)
        arm()
      }
      arm()

      try {
        const headers: Record<string, string> = {}
        const bearer = token()
        if (bearer) headers.Authorization = `Bearer ${bearer}`
        const url =
          `${apiUrl()}/api/v1/files/${fileId}/chunks/${index}` +
          `?object_version_id=${encodeURIComponent(objectVersionId)}`
        const res = await fetchImpl(url, {
          headers,
          credentials: 'include',
          signal: local.signal,
        })
        if (res.status === 409) {
          throw new StreamChangedError(`chunk ${index}: the file changed`)
        }
        if (!res.ok) {
          throw new ApiError(res.statusText || `chunk ${index} request failed`, res.status)
        }
        const frame = await readBody(res, onByte)
        return { frame, chunkCount: parseChunkCount(res.headers.get('X-Chunk-Count')) }
      } catch (err) {
        if (idleFired) {
          throw new ChunkIdleTimeoutError(
            `chunk ${index} received no byte for ${idleMs} ms`,
          )
        }
        throw err
      } finally {
        clock.clearTimeout(timer)
        signal.removeEventListener('abort', onCallerAbort)
      }
    },
  }
}
