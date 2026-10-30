/**
 * LD-0001 PR-B: the page bridge between the PR-A stream session and the
 * service worker's `/sw-stream/` range responder (contract §2.1, §6 M5).
 *
 * It owns nothing secret: the SW never receives a key, a `versionId` or a
 * plaintext chunk. It:
 *  - registers `{id, mime, size}` with a fresh MessagePort (`register-stream`);
 *  - keeps ONE message listener for the life of the session, and answers
 *    `pull {reqId, offset, max}` from `session.read(reqId, offset, max)`
 *    with a fresh, transferred `ArrayBuffer` (`data`) or a code + chunk index
 *    (`data-error`, M6);
 *  - sends `ping` every 20 s while the session is open;
 *  - sends `progress {reqId}` every 10 s while a pull waits on a fetch;
 *  - re-registers on `controllerchange`, and answers a `stream-claim` only
 *    when the claimed hash matches this stream's id;
 *  - on close sends `close-stream`, drops the port and clears every timer.
 *
 * Clock, the SW container and the channel factory are injected, so this runs
 * under `bun test` with no browser (test/ld-0001-media-stream-bridge.test.ts).
 */
import type { Clock } from './source'

export const PING_INTERVAL_MS = 20_000
export const PROGRESS_INTERVAL_MS = 10_000

export interface PortLike {
  postMessage(message: unknown, transfer?: unknown[]): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  start?(): void
  close?(): void
}

/** `navigator.serviceWorker` (or a registration) as far as the bridge needs it. */
export interface ServiceWorkerContainerLike {
  postMessage(message: unknown, transfer?: unknown[]): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

export interface BridgeEnv {
  clock: Clock
  container: ServiceWorkerContainerLike
  controllerId?(): string | null
  onControllerChange(cb: () => void): () => void
  createChannel(): { port1: PortLike; port2: unknown }
}

export interface CreateStreamBridgeOptions {
  id: string
  mime: string
  size: number
  read(reqId: string, offset: number, max: number): Promise<Uint8Array>
  env: BridgeEnv
  /** The SW served the first range for `reqId`: the no-pull watchdog is disarmed. */
  onOpenRange?(reqId: string): void
  /** A terminal read failure: `auth` / `changed` / `network`, with a chunk index. */
  onFatal?(code: 'auth' | 'changed' | 'network', index: number): void
}

export interface StreamBridge {
  readonly id: string
  close(): void
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

interface PullState {
  timer: unknown
}

function describeError(err: unknown): { code: 'auth' | 'changed' | 'network'; index: number } {
  const candidate = err as { kind?: unknown; index?: unknown } | null
  const kind = candidate?.kind
  if (kind === 'auth' || kind === 'changed' || kind === 'network') {
    return { code: kind, index: typeof candidate?.index === 'number' ? candidate.index : 0 }
  }
  return { code: 'network', index: 0 }
}

export function createStreamBridge(opts: CreateStreamBridgeOptions): StreamBridge {
  const { clock, container, createChannel } = opts.env
  let closed = false
  let port: PortLike | null = null
  let pingTimer: unknown = null
  const pulls = new Map<string, PullState>()

  const onContainerMessage = (event: { data: unknown }): void => {
    void handleContainerMessage(event.data)
  }
  const onPortMessage = (event: { data: unknown }): void => {
    void handlePortMessage(event.data)
  }

  const releasePort = (): void => {
    if (!port) return
    port.removeEventListener('message', onPortMessage)
    try {
      port.close?.()
    } catch {
      // A closed port is fine.
    }
    port = null
  }

  const register = (type: 'register-stream' | 'stream-claim-reply', extra?: object): void => {
    if (closed) return
    releasePort()
    const channel = createChannel()
    port = channel.port1
    port.addEventListener('message', onPortMessage)
    port.start?.()
    container.postMessage(
      { type, id: opts.id, mime: opts.mime, size: opts.size, ...extra, port: channel.port2 },
      [channel.port2],
    )
  }

  const clearPull = (reqId: string): void => {
    const state = pulls.get(reqId)
    if (!state) return
    clock.clearTimeout(state.timer)
    pulls.delete(reqId)
  }

  const post = (message: unknown, transfer?: unknown[]): void => {
    if (closed) return
    port?.postMessage(message, transfer)
  }

  async function handleContainerMessage(data: unknown): Promise<void> {
    if (closed) return
    if (!data || typeof data !== 'object') return
    const message = data as { type?: unknown; hash?: unknown }
    if (message.type !== 'stream-claim' || typeof message.hash !== 'string') return
    if (message.hash !== (await sha256Hex(opts.id))) return
    if (closed) return
    register('stream-claim-reply', { hash: message.hash })
  }

  async function handlePortMessage(data: unknown): Promise<void> {
    if (closed) return
    if (!data || typeof data !== 'object') return
    const message = data as { type?: unknown; reqId?: unknown; offset?: unknown; max?: unknown }

    if (message.type === 'open-range') {
      if (typeof message.reqId === 'string') opts.onOpenRange?.(message.reqId)
      return
    }
    if (message.type === 'cancel') {
      if (typeof message.reqId === 'string') clearPull(message.reqId)
      return
    }
    if (message.type !== 'pull') return

    const reqId = message.reqId
    const offset = message.offset
    const max = message.max
    if (
      typeof reqId !== 'string' ||
      !Number.isInteger(offset) ||
      !Number.isInteger(max) ||
      (offset as number) < 0 ||
      (max as number) <= 0
    ) {
      return
    }

    if (pulls.has(reqId)) clearPull(reqId)
    // `progress` every 10 s for as long as this pull waits on a fetch (§2.1).
    const beat = (): void => {
      const timer = clock.setTimeout(() => {
        if (closed || !pulls.has(reqId)) return
        post({ type: 'progress', reqId })
        beat()
      }, PROGRESS_INTERVAL_MS)
      const state = pulls.get(reqId)
      if (state) state.timer = timer
    }
    pulls.set(reqId, { timer: null })
    beat()

    try {
      const bytes = await opts.read(reqId, offset as number, max as number)
      if (closed) return
      const copy = bytes.slice()
      if (!copy.byteLength) {
        throw new Error('empty read')
      }
      post({ type: 'data', reqId, offset, bytes: copy.buffer }, [copy.buffer])
    } catch (err) {
      if (closed) return
      const { code, index } = describeError(err)
      post({ type: 'data-error', reqId, code, index })
      opts.onFatal?.(code, index)
    } finally {
      clearPull(reqId)
    }
  }

  container.addEventListener('message', onContainerMessage)
  const offControllerChange = opts.env.onControllerChange(() => {
    if (!closed) register('register-stream')
  })

  pingTimer = clock.setTimeout(function ping() {
    if (closed) return
    container.postMessage({ type: 'ping' })
    pingTimer = clock.setTimeout(ping, PING_INTERVAL_MS)
  }, PING_INTERVAL_MS)

  register('register-stream')

  return {
    id: opts.id,
    close(): void {
      if (closed) return
      closed = true
      if (pingTimer !== null) {
        clock.clearTimeout(pingTimer)
        pingTimer = null
      }
      for (const reqId of [...pulls.keys()]) clearPull(reqId)
      releasePort()
      container.removeEventListener('message', onContainerMessage)
      offControllerChange()
      container.postMessage({ type: 'close-stream', id: opts.id })
    },
  }
}
