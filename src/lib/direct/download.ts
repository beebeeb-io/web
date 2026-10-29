import type { DirectPoll } from 'beebeeb-wasm'
import { configuredPairs, pairsAllowed, type Discovery, type Pair } from './allowlist'
import { getDirectSession, type DirectSession } from './session'
import { assertSession, directApi, wait } from './api'
import { storageGet } from './storage-fetch'
import { fetchPinnedChunk } from './pinned-chunk'
import { forceApi } from './transport-switch'

/** Every message that crosses this module's boundary is scrubbed by core: no link or key prints. */
function scrubError(s: DirectSession, error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const message = s.wasm.scrubText(error.message)
  if (message === error.message) return error
  const copy = error instanceof DOMException ? new DOMException(message, error.name) : new Error(message)
  const status = (error as { status?: unknown }).status
  if (status !== undefined) Object.assign(copy, { status })
  return copy
}

export interface Geometry { chunk_count: number; chunk_size: number; encrypted_size: number; original_size: number }
export interface DirectChunks extends AsyncIterable<Uint8Array> { geometry: Geometry; cancel(): void }

async function discover(s: DirectSession): Promise<Discovery | null> {
  if (!s.discoveryPending) s.discoveryPending = (async () => {
    if (s.cache.lookup(performance.now()).kind === 'fetch') {
      const answer = await directApi(s, s.wasm.directTransferConstants().discovery_path, 'discovery', s.controller.signal)
      s.cache.record(answer.outcome, answer.bytes, performance.now())
    }
    const lookup = s.cache.lookup(performance.now())
    return lookup.kind === 'cached' ? lookup.discovery : null
  })().finally(() => { s.discoveryPending = undefined })
  return await s.discoveryPending as Discovery | null
}

export async function directChunks(
  fileId: string,
  pin: { versionId: string | null; chunkFormat: number },
  signal: AbortSignal,
  options?: { session?: DirectSession; pairs?: Pair[]; openFrame?: (frame: Uint8Array) => Promise<Uint8Array> },
): Promise<DirectChunks | null> {
  if (forceApi()) return null
  let s: DirectSession
  try { s = options?.session ?? await getDirectSession() }
  catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    return null
  }
  assertSession(s, signal)
  if (!s.health.mayStart('download', performance.now())) return null
  const discovery = await discover(s)
  assertSession(s, signal)
  if (!discovery || !pairsAllowed(s.wasm, discovery, 'download', options?.pairs ?? configuredPairs())) return null
  const control = new AbortController()
  const combined = AbortSignal.any([signal, s.controller.signal, control.signal])
  const planner = new s.wasm.WasmDownloadPlanner(discovery, s.apiBase, fileId, Math.random())
  planner.setMaxInFlightBytes(s.wasm.maxInFlightBytes('browser'))
  const release = () => {
    control.abort()
    if (planner.storageGivenUp() && s.current()) s.health.gaveUp('download', performance.now())
    planner.free()
  }
  const window = async (step: Extract<DirectPoll, { kind: 'request_window' }>) => {
    // Core owns the immutable version pin. A caller that already knows the version supplies it on the first window.
    const request = { ...step.request, object_version_id: step.request.object_version_id ?? pin.versionId }
    const answer = await directApi(s, s.wasm.directDownloadGrantsPath(fileId), 'download_grant', combined, request)
    // A refused window is core's verdict (the file goes to the API, or its rest to the pinned
    // route); the caller's own version spelling never overrides it.
    if (answer.outcome.kind === 'proceed') planner.windowAnswered(answer.bytes, Date.now())
    else planner.windowFailed(answer.outcome, Date.now())
  }
  try {
    // Resolve negotiation before returning anything: API fallback is safe only before any bytes have been delivered.
    while (!planner.geometry()) {
      assertSession(s, combined)
      const step = planner.poll(Date.now())
      if (step.kind === 'request_window') await window(step)
      else if (step.kind === 'wait' && step.until_ms !== null) await wait(step.until_ms - Date.now(), combined)
      else if (step.kind === 'stop' && step.verdict.kind === 'api_for_file') { release(); return null }
      else throw new Error('Direct download negotiation failed')
    }
    const geometry = planner.geometry() as Geometry
    let started = false
    return {
      geometry,
      cancel: () => { control.abort(); if (!started) { started = true; release() } },
      async *[Symbol.asyncIterator]() {
        if (started) throw new Error('Direct download already consumed')
        started = true
        const pending = new Set<Promise<void>>()
        const ready = new Map<number, Uint8Array>()
        let fatal: unknown
        const start = (step: Extract<DirectPoll, { kind: 'fetch' | 'fetch_via_api' }>) => {
          const job = (async () => {
            assertSession(s, combined)
            if (step.kind === 'fetch') {
              try {
                s.wasm.checkStorageUrl(step.url.raw(), discovery, s.apiBase)
                const answer = await storageGet(step.url, step.length, combined, s.wasm)
                assertSession(s, combined)
                const head = s.wasm.checkStorageGet(answer.status, answer.contentLength, step.length)
                const verdict = head.kind === 'stored' ? s.wasm.checkStorageBody(answer.received, step.length) : head
                if (verdict.kind === 'stored' && answer.body) { ready.set(step.index, answer.body); planner.fetchOk(step.index) }
                else planner.fetchFailed(step.index, Date.now())
              } finally { step.url.free() }
            } else {
              const bytes = await fetchPinnedChunk(fileId, step.index, step.object_version_id, combined, s)
              assertSession(s, combined)
              const expected = planner.chunkLength(step.index)
              if (expected === null || bytes.length !== expected) { planner.apiFetchFailed(step.index); throw new Error('Pinned chunk length mismatch') }
              ready.set(step.index, bytes); planner.fetchOk(step.index)
            }
          })().catch(error => { fatal = error }).finally(() => { pending.delete(job) })
          pending.add(job)
        }
        try {
          for (;;) {
            assertSession(s, combined)
            if (fatal) throw fatal
            const step = planner.poll(Date.now())
            if (step.kind === 'request_window') { await window(step); continue }
            if (step.kind === 'fetch' || step.kind === 'fetch_via_api') { start(step); continue }
            if (step.kind === 'stop') throw new Error(step.verdict.kind === 'restart' ? 'File changed during download' : 'Direct download failed')
            if (step.kind === 'done') return
            const index = planner.consumedCount()
            const bytes = ready.get(index)
            if (bytes) {
              ready.delete(index)
              let opened: Uint8Array
              try { opened = options?.openFrame ? await options.openFrame(bytes) : bytes }
              catch {
                assertSession(s, combined)
                planner.chunkUnauthentic(index)
                continue
              }
              yield opened
              assertSession(s, combined)
              planner.consumed(index)
              continue
            }
            if (pending.size) {
              if (step.until_ms === null) await Promise.race(pending)
              else {
                const timer = new AbortController()
                try { await Promise.race([...pending, wait(step.until_ms - Date.now(), AbortSignal.any([combined, timer.signal]))]) }
                finally { timer.abort() }
              }
            } else if (step.until_ms !== null) await wait(step.until_ms - Date.now(), combined)
            else throw new Error('Direct download stalled')
          }
        } catch (error) { throw scrubError(s, error) } finally {
          control.abort()
          await Promise.all(pending)
          ready.clear()
          release()
        }
      },
    }
  } catch (error) { release(); throw scrubError(s, error) }
}

/** Worker-owned content reader; failed pushes leave its chunk index unchanged. */
export interface FrameOpener {
  pushFrame(frame: Uint8Array): Promise<Uint8Array>
  finish(): Promise<unknown>
  dispose(): Promise<void>
}
/** With an opener, authenticate before consuming each chunk and expose plaintext only. */
export async function directResponse(
  fileId: string, chunkFormat: number, signal: AbortSignal,
  createOpener: () => Promise<FrameOpener>,
): Promise<Response | null> {
  let opener: FrameOpener | undefined
  const chunks = await directChunks(fileId, { versionId: null, chunkFormat }, signal, {
    openFrame: async frame => {
      opener ??= await createOpener()
      return opener.pushFrame(frame)
    },
  })
  if (!chunks) return null
  const iterator = chunks[Symbol.asyncIterator]()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) {
          if (opener) { const finishing = opener; opener = undefined; await finishing.finish() }
          controller.close()
        }
        else controller.enqueue(next.value)
      } catch (error) {
        await opener?.dispose(); opener = undefined
        chunks.cancel(); await iterator.return?.()
        controller.error(error)
      }
    },
    async cancel() {
      chunks.cancel(); await iterator.return?.()
      await opener?.dispose(); opener = undefined
    },
  }, { highWaterMark: 0 })
  return new Response(body, { headers: {
    'Content-Length': String(chunks.geometry.original_size),
    'X-Chunk-Count': String(chunks.geometry.chunk_count), 'X-Chunk-Size': String(chunks.geometry.chunk_size),
  } })
}
