/**
 * LD-0001 PR-B: the page bridge (§2.1 liveness, §6 M5).
 *
 * The bridge is the page half of the SW protocol: it registers the stream,
 * answers `pull` from the PR-A session's `read(reqId, offset, max)`, pings
 * every 20 s, sends `progress` every 10 s while a pull waits, re-registers on
 * `controllerchange`, answers a claim, and releases everything on close.
 * Clock and service-worker container are injected, so this runs in bun.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { FakeClock, settle } from './helpers/media-stream-fixtures'
import { createStreamBridge, type PortLike } from '../src/lib/media-stream/sw-bridge'
import { StreamSessionError } from '../src/lib/media-stream/session'

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function fakeEndpoint() {
  const sent: unknown[] = []
  const transfers: unknown[][] = []
  const listeners = new Set<(event: { data: unknown }) => void>()
  return {
    sent,
    transfers,
    postMessage(message: unknown, transfer?: unknown[]) {
      sent.push(message)
      transfers.push(transfer ?? [])
    },
    addEventListener(_type: 'message', listener: (event: { data: unknown }) => void) {
      listeners.add(listener)
    },
    removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void) {
      listeners.delete(listener)
    },
    emit(data: unknown) {
      for (const listener of [...listeners]) listener({ data })
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

function setup(read?: (reqId: string, offset: number, max: number) => Promise<Uint8Array>) {
  const clock = new FakeClock()
  const container = fakeEndpoint()
  let first: { port1: ReturnType<typeof fakeEndpoint>; port2: { kind: string; n: number } } | null = null
  let channels = 0
  const controllerListeners = new Set<() => void>()
  const bridge = createStreamBridge({
    id: 'stream-1',
    mime: 'video/mp4',
    size: 100,
    read: read ?? (async (_reqId, _offset, max) => new Uint8Array(max).fill(7)),
    env: {
      clock,
      container,
      controllerId: () => 'client-1',
      onControllerChange(cb: () => void) {
        controllerListeners.add(cb)
        return () => controllerListeners.delete(cb)
      },
      createChannel: () => {
        const channel = { port1: fakeEndpoint(), port2: { kind: 'port2' as const, n: channels++ } }
        if (!first) first = channel
        return channel
      },
    },
  })
  return {
    clock,
    container,
    port1: first!.port1,
    port2: first!.port2 as unknown,
    controllerListeners,
    bridge,
  }
}

describe('the page bridge (LD-0001 PR-B)', () => {
  test('registers the stream with a MessagePort on construction', () => {
    const { container, port2 } = setup()
    expect(container.sent[0]).toMatchObject({
      type: 'register-stream',
      id: 'stream-1',
      mime: 'video/mp4',
      size: 100,
    })
    expect((container.sent[0] as { port: unknown }).port).toBe(port2)
    expect(container.transfers[0]).toEqual([port2])
  })

  test('answers a pull with an offset-addressed, transferred data message', async () => {
    const { port1, port2 } = setup()
    port1.emit({ type: 'pull', reqId: 'r1', offset: 32, max: 16 })
    await settle()
    const message = port1.sent[0] as { type: string; reqId: string; offset: number; bytes: ArrayBuffer }
    expect(message.type).toBe('data')
    expect(message.reqId).toBe('r1')
    expect(message.offset).toBe(32)
    expect(message.bytes.byteLength).toBe(16)
    expect(port1.transfers[0]).toEqual([message.bytes])
    expect(port2).toBeTruthy()
  })

  test('pings every 20 s while a session is open', () => {
    const { clock, container, bridge } = setup()
    clock.advance(19999)
    expect(container.sent.filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(0)
    clock.advance(1)
    expect(container.sent.filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(1)
    clock.advance(20000)
    expect(container.sent.filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(2)
    bridge.close()
    clock.advance(60000)
    expect(container.sent.filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(2)
  })

  test('sends progress every 10 s while a pull waits on a fetch', async () => {
    let release: ((bytes: Uint8Array) => void) | null = null
    const { clock, port1, bridge } = setup(
      (_reqId, _offset, max) =>
        new Promise<Uint8Array>((resolve) => {
          release = (bytes) => resolve(bytes)
          void max
        }),
    )
    port1.emit({ type: 'pull', reqId: 'r2', offset: 0, max: 8 })
    await settle()
    clock.advance(9999)
    expect(
      port1.sent.filter((m) => (m as { type: string }).type === 'progress'),
    ).toHaveLength(0)
    clock.advance(1)
    expect(port1.sent.filter((m) => (m as { type: string }).type === 'progress')).toEqual([
      { type: 'progress', reqId: 'r2' },
    ])
    clock.advance(10000)
    expect(
      port1.sent.filter((m) => (m as { type: string }).type === 'progress'),
    ).toHaveLength(2)
    release!(new Uint8Array(8).fill(1))
    await settle()
    expect(port1.sent.filter((m) => (m as { type: string }).type === 'data')).toHaveLength(1)
    clock.advance(60000)
    expect(
      port1.sent.filter((m) => (m as { type: string }).type === 'progress'),
    ).toHaveLength(2)
    bridge.close()
  })

  test('re-registers on controllerchange', () => {
    const { container, controllerListeners, bridge } = setup()
    for (const cb of controllerListeners) cb()
    const registrations = container.sent.filter(
      (m) => (m as { type: string }).type === 'register-stream',
    )
    expect(registrations).toHaveLength(2)
    bridge.close()
  })

  test('answers a matching claim and ignores a foreign hash', async () => {
    const { container, port2, bridge } = setup()
    const before = container.sent.length
    container.emit({ type: 'stream-claim', hash: sha256Hex('another-stream') })
    await settle()
    expect(container.sent.length).toBe(before)

    container.emit({ type: 'stream-claim', hash: sha256Hex('stream-1') })
    await settle()
    const reply = container.sent.slice(before) as Array<{
      type: string
      hash?: string
      id?: string
      port?: unknown
    }>
    expect(reply).toHaveLength(1)
    expect(reply[0].type).toBe('stream-claim-reply')
    expect(reply[0].hash).toBe(sha256Hex('stream-1'))
    expect(reply[0].id).toBe('stream-1')
    expect(reply[0].port).not.toBe(port2)
    bridge.close()
  })

  test('a failed read reports a code and a chunk index only', async () => {
    const { port1, bridge } = setup(async () => {
      throw new StreamSessionError('auth', 'chunk 3 could not be authenticated', 3)
    })
    port1.emit({ type: 'pull', reqId: 'r3', offset: 0, max: 8 })
    await settle()
    const message = port1.sent[0] as { type: string; reqId: string; code: string; index: number }
    expect(message).toEqual({ type: 'data-error', reqId: 'r3', code: 'auth', index: 3 })
    bridge.close()
  })

  test('close sends close-stream and releases listeners and timers', () => {
    const { container, port1, clock, bridge } = setup()
    bridge.close()
    expect(container.sent).toContainEqual({ type: 'close-stream', id: 'stream-1' })
    expect(container.listenerCount).toBe(0)
    expect(port1.listenerCount).toBe(0)
    clock.advance(120000)
    expect(container.sent.filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(0)
  })
})

// Keep the type import used so the file type-checks under `tsc --noEmit`.
const _portType: PortLike | null = null
void _portType
