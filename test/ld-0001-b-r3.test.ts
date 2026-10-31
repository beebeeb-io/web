/**
 * LD-0001 PR-B round 3 (web #208): the service-worker relay and route fixes.
 * Everything here is public/media-stream-logic.js under bun: fake ports, an
 * injected clock, plain request objects. No browser and no real worker.
 * One describe block per review row.
 */
import { describe, expect, test } from 'bun:test'
import { FakeClock, settle } from './helpers/media-stream-fixtures'
import {
  createMediaState,
  reduceMediaState,
  statusCopy,
  type MediaEvent,
} from '../src/lib/media-stream/state'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logic = require('../public/media-stream-logic.js')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>

class FakePort {
  sent: Msg[] = []
  closed = false
  #listeners = new Set<(event: { data: unknown }) => void>()
  postMessage(message: Msg): void {
    this.sent.push(message)
  }
  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.#listeners.add(listener)
  }
  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.#listeners.delete(listener)
  }
  start(): void {}
  close(): void {
    this.closed = true
  }
  /** A message from the page to the worker. */
  deliver(data: Msg): void {
    for (const listener of this.#listeners) listener({ data })
  }
  sentOf(type: string): Msg[] {
    return this.sent.filter((m) => m.type === type)
  }
}

function relayWith(clientIds: string[] = ['tab-a']) {
  const clock = new FakeClock()
  const clients = [...clientIds]
  const posted: Array<{ client: string; message: Msg }> = []
  const relay = logic.createStreamRelay({
    clock,
    matchAll: async () =>
      clients.map((id) => ({
        id,
        postMessage: (message: Msg) => posted.push({ client: id, message }),
      })),
  })
  return { relay, clock, clients, posted }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerFrom(relay: any, id: string, sourceId: string, size = 100): FakePort {
  const port = new FakePort()
  relay.onMessage({ type: 'register-stream', id, mime: 'video/mp4', size, port }, sourceId)
  return port
}

function bodyOf(relay: { registry: { get(id: string): unknown }; createBody: Function }, id: string, start = 0, end = 99) {
  return (relay.createBody(relay.registry.get(id), start, end) as ReadableStream<Uint8Array>).getReader()
}

type Outcome =
  | { state: 'resolved'; value: unknown }
  | { state: 'rejected'; error: unknown }
  | { state: 'pending' }

/** Where a promise stands after a few turns (never waits on a test timeout). */
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

interface FakeRequest {
  url: string
  mode: string
  destination: string
  headers: { get(name: string): string | null }
}

function request(id = 'sid', range: string | null = null, overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    url: `https://app.test/sw-stream/${id}`,
    mode: 'no-cors',
    destination: 'video',
    headers: { get: (name: string) => (name.toLowerCase() === 'range' ? range : null) },
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function routeOver(relay: any) {
  return logic.createStreamRoute({
    registry: relay.registry,
    clock: new FakeClock(),
    claim: relay.claim,
    createBody: () => null,
    cacheStore: {},
  })
}

async function respond(result: null | { response: Promise<Response> }): Promise<Response> {
  if (!result) throw new Error('the stream route did not intercept the request')
  return await result.response
}

describe('LD-0001 r3 B1: the silence timer runs only while a pull waits', () => {
  test('a_paused_player_with_a_full_buffer_is_never_timed_out', async () => {
    const { relay, clock } = relayWith()
    const port = registerFrom(relay, 'sid', 'tab-a')
    const reader = bodyOf(relay, 'sid')
    await settle(2)
    const [pull] = port.sentOf('pull')
    expect(pull).toMatchObject({ offset: 0, max: 100 })
    port.deliver({ type: 'data', reqId: pull.reqId, offset: 0, bytes: new Uint8Array(10).fill(7).buffer })
    await settle(2)
    // The 10 bytes sit in the queue: no pull is outstanding (paused, buffer full).
    expect(port.sentOf('pull').length).toBe(1)
    clock.advance(60_000)
    await settle(2)
    const first = await outcome(reader.read())
    expect(first.state).toBe('resolved')
    expect(((first as { value: { value: Uint8Array } }).value.value).byteLength).toBe(10)
  })

  test('a_pull_with_no_reply_for_30s_errors_the_response', async () => {
    const { relay, clock } = relayWith()
    const port = registerFrom(relay, 'sid', 'tab-a')
    const reader = bodyOf(relay, 'sid')
    await settle(2)
    expect(port.sentOf('pull').length).toBe(1)
    clock.advance(30_000)
    await settle(2)
    const read = await outcome(reader.read())
    expect(read.state).toBe('rejected')
    expect(String((read as { error: unknown }).error)).toContain('stream timed out')
  })

  test('progress_keeps_a_waiting_pull_alive', async () => {
    const { relay, clock } = relayWith()
    const port = registerFrom(relay, 'sid', 'tab-a')
    const reader = bodyOf(relay, 'sid')
    await settle(2)
    const [pull] = port.sentOf('pull')
    clock.advance(25_000)
    port.deliver({ type: 'progress', reqId: pull.reqId })
    clock.advance(25_000)
    port.deliver({ type: 'data', reqId: pull.reqId, offset: 0, bytes: new Uint8Array(4).fill(1).buffer })
    const read = await outcome(reader.read())
    expect(read.state).toBe('resolved')
  })
})

describe('LD-0001 r3 B2: a stream belongs to the tab that registered it', () => {
  test('another_tab_registering_or_closing_the_same_id_does_not_touch_the_owner', async () => {
    const { relay } = relayWith(['tab-a', 'tab-b'])
    const portA = registerFrom(relay, 'sid', 'tab-a')
    registerFrom(relay, 'sid', 'tab-b')
    expect(relay.registry.get('sid').clientId).toBe('tab-a')
    expect(relay.registry.get('sid').port).toBe(portA)

    relay.onMessage({ type: 'close-stream', id: 'sid' }, 'tab-b')
    expect(relay.registry.has('sid')).toBe(true)
    expect(portA.closed).toBe(false)

    relay.onMessage({ type: 'close-stream', id: 'sid' }, 'tab-a')
    expect(relay.registry.has('sid')).toBe(false)
    expect(portA.closed).toBe(true)
  })

  test('the_owner_may_re_register_its_own_id', () => {
    const { relay } = relayWith()
    registerFrom(relay, 'sid', 'tab-a')
    const fresh = registerFrom(relay, 'sid', 'tab-a')
    expect(relay.registry.get('sid').port).toBe(fresh)
  })
})

describe('LD-0001 r3 B3: an empty clientId never skips the owner check', () => {
  test('an_empty_client_id_request_gets_404', async () => {
    const { relay, posted } = relayWith()
    registerFrom(relay, 'sid', 'tab-a')
    const route = routeOver(relay)
    expect((await respond(route(request('sid', 'bytes=0-9'), ''))).status).toBe(404)
    // A registry miss with no client id never broadcasts a claim either.
    expect((await respond(route(request('missing'), ''))).status).toBe(404)
    await settle(2)
    expect(posted.filter((p) => p.message.type === 'stream-claim')).toEqual([])
  })

  test('a_request_whose_resulting_client_id_is_the_owner_is_served', async () => {
    const { relay } = relayWith()
    registerFrom(relay, 'sid', 'tab-a')
    const route = routeOver(relay)
    expect((await respond(route(request('sid', 'bytes=0-9'), '', 'tab-a'))).status).toBe(206)
    expect((await respond(route(request('sid', 'bytes=0-9'), '', 'tab-b'))).status).toBe(404)
    expect((await respond(route(request('sid', 'bytes=0-9'), 'tab-a'))).status).toBe(206)
  })

  test('an_entry_is_never_registered_with_an_empty_client_id', () => {
    const { relay } = relayWith()
    registerFrom(relay, 'sid', '')
    expect(relay.registry.has('sid')).toBe(false)
    expect(logic.shouldHandleStreamRequest(request(), '', { clientId: '' })).toBe(false)
  })
})

describe('LD-0001 r3 B4: every claim waiter is answered', () => {
  test('two_claims_for_one_hash_are_both_answered_by_one_reply', async () => {
    const { relay, posted } = relayWith()
    const hash = logic.sha256Hex('sid')
    const first = relay.claim(hash, 'tab-a')
    const second = relay.claim(hash, 'tab-a')
    await settle(2)
    expect(posted.filter((p) => p.message.type === 'stream-claim').length).toBe(2)
    const port = new FakePort()
    relay.onMessage(
      { type: 'stream-claim-reply', hash, id: 'sid', mime: 'video/mp4', size: 100, port },
      'tab-a',
    )
    const a = await outcome(first)
    const b = await outcome(second)
    expect(a.state).toBe('resolved')
    expect(b.state).toBe('resolved')
    expect((a as { value: Msg }).value).toMatchObject({ id: 'sid', clientId: 'tab-a' })
    expect((b as { value: Msg }).value).toMatchObject({ id: 'sid', clientId: 'tab-a' })
  })

  test('each_claim_has_its_own_timeout_that_resolves_null', async () => {
    const { relay, clock } = relayWith()
    const hash = logic.sha256Hex('sid')
    const first = relay.claim(hash, 'tab-a')
    await settle(2)
    clock.advance(1000)
    const second = relay.claim(hash, 'tab-a')
    await settle(2)
    clock.advance(1000)
    const a = await outcome(first)
    expect(a).toEqual({ state: 'resolved', value: null })
    clock.advance(1000)
    const b = await outcome(second)
    expect(b).toEqual({ state: 'resolved', value: null })
  })
})

describe('LD-0001 r3 B7: the buffering copy names the part the player waits on', () => {
  test('buffering_copy_uses_the_latest_pull_index', () => {
    let state = reduceMediaState(createMediaState(120), { type: 'ready' })
    state = reduceMediaState(state, { type: 'play' })
    state = reduceMediaState(state, { type: 'pull', index: 36 } as MediaEvent)
    state = reduceMediaState(state, { type: 'waiting' })
    expect(statusCopy(state)).toBe('Buffering · downloading part 37 of 120')
  })
})

describe('LD-0001 r3 B9: multi-range is refused, a malformed Range is ignored', () => {
  function servingRoute() {
    const { relay } = relayWith()
    registerFrom(relay, 'sid', 'tab-a')
    return routeOver(relay)
  }

  test('a_multi_range_request_gets_416', async () => {
    const route = servingRoute()
    for (const range of ['bytes=0-1,5-6', 'bytes=10-19, 30-39']) {
      const res = await respond(route(request('sid', range), 'tab-a'))
      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe('bytes */100')
    }
  })

  test('a_syntactically_malformed_range_is_ignored_and_served_whole', async () => {
    const route = servingRoute()
    for (const range of ['bytes=abc', 'items=0-9', 'bytes=', 'bytes=-', 'garbage', 'bytes=1-2-3']) {
      const res = await respond(route(request('sid', range), 'tab-a'))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-length')).toBe('100')
      expect(res.headers.get('content-range')).toBeNull()
    }
  })

  test('an_unsatisfiable_range_is_still_416', async () => {
    const route = servingRoute()
    for (const range of ['bytes=100-', 'bytes=100-109', 'bytes=-0', 'bytes=5-2']) {
      const res = await respond(route(request('sid', range), 'tab-a'))
      expect(res.status).toBe(416)
    }
  })
})
