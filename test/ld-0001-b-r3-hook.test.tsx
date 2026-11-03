/**
 * LD-0001 PR-B round 3 (web #208): the streaming hook, rendered for real with
 * react-dom/client over a minimal DOM stub (the harness of
 * test/1691-impersonate-redeem-strictmode.test.tsx). The PR-A session and the
 * metadata read come in through the hook's test seams (`openSession`,
 * `openMetadata`); the service worker is a fake container with a live
 * MessageChannel; the media element is a fake that fires events on demand.
 * One describe block per review row.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { preserveGlobals } from './helpers/scoped-global'
import type { DriveFile } from '../src/lib/api'
import { StreamSessionError, type StreamEvent, type StreamSession } from '../src/lib/media-stream/session'
import {
  useMediaStream,
  type MediaStreamHandle,
  type UseMediaStreamArgs,
} from '../src/lib/media-stream/use-media-stream'

preserveGlobals('window', 'document', 'navigator')

// ── A minimal DOM: enough for createRoot + a component that renders null ──────

function makeNode(tag: string): Record<string, unknown> {
  const children: Array<Record<string, unknown>> = []
  const el: Record<string, unknown> = {
    nodeType: tag === '#text' ? 3 : tag === '#comment' ? 8 : 1,
    tagName: tag.startsWith('#') ? undefined : tag.toUpperCase(),
    appendChild(c: Record<string, unknown>) { children.push(c); return c },
    removeChild(c: Record<string, unknown>) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c },
    insertBefore(c: Record<string, unknown>) { children.push(c); return c },
    setAttribute() {}, getAttribute() { return null }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    style: {}, dataset: {},
    get firstChild() { return children[0] ?? null },
    contains() { return false },
    textContent: '',
  }
  el.childNodes = children
  return el
}

function installDom(serviceWorker: FakeServiceWorker): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: () => makeNode('#text'),
    createComment: () => makeNode('#comment'),
    addEventListener() {}, removeEventListener() {},
  }
  const win: Record<string, unknown> = {
    event: undefined,
    addEventListener() {}, removeEventListener() {},
    document: doc,
    // react-dom's getActiveElementDeep checks `instanceof win.HTMLIFrameElement`.
    HTMLIFrameElement: function HTMLIFrameElement() {},
    navigator: { onLine: true, userAgent: 'bun-test' },
  }
  doc.defaultView = win
  const container = makeNode('div')
  container.ownerDocument = doc
  doc.activeElement = container
  const body = makeNode('body')
  body.ownerDocument = doc
  doc.body = body
  const g = globalThis as Record<string, unknown>
  g.window = win
  g.document = doc
  g.navigator = { onLine: true, userAgent: 'bun-test', serviceWorker }
  return container
}

// ── Fakes ──────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>

class FakeServiceWorker {
  posted: Msg[] = []
  controller = { postMessage: (message: Msg) => { this.posted.push(message) } }
  #listeners = new Map<string, Set<(event: unknown) => void>>()
  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
    this.#listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.get(type)?.delete(listener)
  }
  registrations(): Msg[] {
    return this.posted.filter((m) => m.type === 'register-stream')
  }
}

class FakeMedia {
  networkState = 2
  error: { code: number } | null = null
  currentTime = 0
  paused = true
  #listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, listener: () => void): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
    this.#listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: () => void): void {
    this.#listeners.get(type)?.delete(listener)
  }
  fire(type: string): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener()
  }
  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }
}

interface FakeSession extends StreamSession {
  emit(event: StreamEvent): void
}

function fakeSession(chunkCount: number, chunkSize = 1024): FakeSession {
  const listeners = new Set<(event: StreamEvent) => void>()
  return {
    totalSize: chunkCount * chunkSize,
    chunkCount,
    chunkSize,
    verified: new Set<number>(),
    read: async (_reqId: string, _offset: number, max: number) => new Uint8Array(Math.min(max, 16)).fill(1),
    close: async () => {},
    onEvent(cb: (event: StreamEvent) => void) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    retainedBytes: () => 0,
    emit(event: StreamEvent) {
      for (const listener of listeners) listener(event)
    },
  }
}

function fileRow(id: string, chunkCount = 4, chunkSize = 1024): DriveFile {
  return {
    id,
    name_encrypted: `enc-${id}`,
    mime_type: 'video/mp4',
    size_bytes: chunkCount * chunkSize,
    chunk_count: chunkCount,
    download_version: {
      object_version_id: `ov-${id}`,
      version_number: 1,
      chunk_count: chunkCount,
      chunk_size_bytes: chunkSize,
      plaintext_size_bytes: chunkCount * chunkSize,
      ciphertext_size_bytes: chunkCount * (chunkSize + 28),
      chunks: [],
    },
  } as unknown as DriveFile
}

type OpenSession = NonNullable<UseMediaStreamArgs['openSession']>
type OpenMetadata = NonNullable<UseMediaStreamArgs['openMetadata']>

const neverOpens: OpenSession = () => new Promise<StreamSession>(() => {})
const okMetadata = (async (fileId: string) => ({ content: { fileId, pin: 0 } })) as unknown as OpenMetadata

function argsFor(file: DriveFile, overrides: Partial<UseMediaStreamArgs> = {}): UseMediaStreamArgs {
  return {
    file,
    mediaKind: 'video',
    selectedVersionId: null,
    isUnlocked: true,
    mime: 'video/mp4',
    resolveFileKey: async () => new Uint8Array(32),
    openMetadata: okMetadata,
    openSession: neverOpens,
    ...overrides,
  }
}

async function tick(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 5))
}

async function waitFor(cond: () => boolean, label: string, tries = 80): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await tick(1)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const mounted: Array<{ unmount(): void; sw: FakeServiceWorker }> = []

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    m.unmount()
    for (const reg of m.sw.registrations()) {
      try {
        ;(reg.port as MessagePort).close()
      } catch {}
    }
  }
  // Let React finish the unmount while this file's DOM globals still exist.
  await tick(4)
})

async function mount(initial: UseMediaStreamArgs) {
  const sw = new FakeServiceWorker()
  const container = installDom(sw)
  const client = (await import('react-dom/client')) as unknown as {
    createRoot(node: unknown): { render(node: unknown): void; unmount(): void }
  }
  const out: { current: MediaStreamHandle | null } = { current: null }
  function Probe({ args }: { args: UseMediaStreamArgs }) {
    out.current = useMediaStream(args)
    return null
  }
  const root = client.createRoot(container)
  const render = (args: UseMediaStreamArgs) => root.render(React.createElement(Probe, { args }))
  render(initial)
  mounted.push({ unmount: () => root.unmount(), sw })
  await tick()
  return {
    sw,
    get h(): MediaStreamHandle {
      if (!out.current) throw new Error('the hook has not rendered')
      return out.current
    },
    async rerender(args: UseMediaStreamArgs) {
      render(args)
      await tick()
    },
  }
}

/**
 * Mount a stream, attach a fake element, then let the session open and wait
 * for `src`. The element is attached first, as in the real preview (the
 * <video> ref is set at commit, before the hook's element effect runs).
 */
async function mountStreaming(session: FakeSession, file = fileRow('file-a', session.chunkCount, session.chunkSize), mediaKind: 'video' | 'audio' = 'video') {
  let release!: () => void
  const elementAttached = new Promise<void>((resolve) => {
    release = resolve
  })
  const m = await mount(
    argsFor(file, {
      mediaKind,
      openSession: async () => {
        await elementAttached
        return session
      },
    }),
  )
  const media = new FakeMedia()
  m.h.setElement(media as unknown as HTMLMediaElement)
  release()
  await waitFor(() => m.h.src !== null, 'src')
  await tick()
  const port = m.sw.registrations().at(-1)!.port as MessagePort
  // Object.assign keeps `h` a live getter (a spread would freeze it).
  return Object.assign(m, { media, port })
}

const AUTH = (part: number) =>
  `Part ${part} of this file couldn't be verified, so playback stopped there. Nothing unverified was played.`
const NETWORK = (part: number) =>
  `The download stopped at part ${part}. Check your connection and try again.`

describe('LD-0001 r3 B2: the stream id carries a per-session token', () => {
  test('stream_id_is_s_fileId_plus_128_random_bits_new_per_session', async () => {
    let opens = 0
    const m = await mount(
      argsFor(fileRow('file-a'), {
        openSession: async () => {
          opens++
          return fakeSession(4)
        },
      }),
    )
    m.h.setElement(new FakeMedia() as unknown as HTMLMediaElement)
    await waitFor(() => m.h.src !== null, 'src')
    const first = m.h.src!
    expect(first).toMatch(/^\/sw-stream\/s-file-a-[0-9a-f]{32}$/)
    expect(m.sw.registrations().at(-1)!.id).toBe(first.slice('/sw-stream/'.length))

    m.h.retry()
    await waitFor(() => opens === 2 && m.h.src !== null && m.h.src !== first, 'a second session')
    const second = m.h.src!
    expect(second).toMatch(/^\/sw-stream\/s-file-a-[0-9a-f]{32}$/)
    expect(second).not.toBe(first)
  })
})

describe('LD-0001 r3 B5: per-file state resets on Next/Prev', () => {
  test('an_auth_error_on_A_then_next_to_B_streams_B', async () => {
    const m = await mount(
      argsFor(fileRow('file-a'), {
        openSession: async () => {
          throw new StreamSessionError('auth', 'chunk 2 could not be authenticated', 2)
        },
      }),
    )
    await waitFor(() => m.h.path === 'error', 'A errors')
    await m.rerender(argsFor(fileRow('file-b')))
    expect(m.h.path).toBe('streaming')
    expect(m.h.errorCopy).toBeNull()
  })

  test('a_stream_rejection_on_A_does_not_carry_over_to_B', async () => {
    const m = await mountStreaming(fakeSession(4))
    m.port.postMessage({ type: 'open-range', reqId: 'r1', start: 0, end: 99 })
    await tick()
    m.media.error = { code: 4 }
    m.media.fire('error')
    await waitFor(() => m.h.path === 'whole-file-fallback', 'A falls back')
    await m.rerender(argsFor(fileRow('file-b')))
    expect(m.h.path).toBe('streaming')
  })
})

describe('LD-0001 r3 B6: only a chunk authentication failure claims verification', () => {
  const cases: Array<{ name: string; overrides: Partial<UseMediaStreamArgs>; copy: string }> = [
    {
      name: 'key fetch failure',
      overrides: { resolveFileKey: async () => { throw new Error('key fetch failed') } },
      copy: NETWORK(1),
    },
    {
      name: 'metadata fetch failure',
      overrides: { openMetadata: (async () => { throw new TypeError('Failed to fetch') }) as unknown as OpenMetadata },
      copy: NETWORK(1),
    },
    {
      name: 'network error during setup',
      overrides: { openSession: async () => { throw new StreamSessionError('network', 'chunk 0 failed after 3 attempts', 0) } },
      copy: NETWORK(1),
    },
    {
      name: 'a real chunk authentication failure',
      overrides: { openSession: async () => { throw new StreamSessionError('auth', 'chunk 3 could not be authenticated', 3) } },
      copy: AUTH(4),
    },
  ]
  for (const c of cases) {
    test(`setup_failure_copy: ${c.name}`, async () => {
      const m = await mount(argsFor(fileRow('file-a'), c.overrides))
      await waitFor(() => m.h.errorCopy !== null, 'error copy')
      expect(m.h.errorCopy).toBe(c.copy)
      expect(m.h.path).toBe('error')
    })
  }

  test('a_network_setup_failure_retries', async () => {
    let opens = 0
    const m = await mount(
      argsFor(fileRow('file-a'), {
        openSession: async () => {
          opens++
          if (opens === 1) throw new StreamSessionError('network', 'chunk 0 failed after 3 attempts', 0)
          return new Promise<StreamSession>(() => {})
        },
      }),
    )
    await waitFor(() => m.h.errorCopy === NETWORK(1), 'network copy')
    m.h.retry()
    await waitFor(() => opens === 2, 'a second open')
    expect(m.h.errorCopy).toBeNull()
    expect(m.h.path).toBe('streaming')
  })

  test('next_while_opening_aborts_the_open_and_shows_no_error', async () => {
    const signals: AbortSignal[] = []
    const m = await mount(
      argsFor(fileRow('file-a'), {
        openSession: (opts) => {
          if (opts.signal) signals.push(opts.signal)
          return new Promise<StreamSession>((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => reject(opts.signal!.reason))
          })
        },
      }),
    )
    await waitFor(() => signals.length === 1, 'the open')
    await m.rerender(argsFor(fileRow('file-b')))
    expect(signals[0].aborted).toBe(true)
    expect(m.h.errorCopy).toBeNull()
    expect(m.h.path).toBe('streaming')
  })
})

describe('LD-0001 r3 B7: the buffering pill names the real part', () => {
  test('buffering_names_the_part_the_player_waits_on', async () => {
    const session = fakeSession(120, 1024)
    const m = await mountStreaming(session)
    m.media.fire('loadedmetadata')
    m.media.fire('play')
    await tick()
    m.port.postMessage({ type: 'pull', reqId: 'r1', offset: 36 * 1024 + 5, max: 512 })
    await tick()
    m.media.fire('waiting')
    await waitFor(() => m.h.overlay !== null, 'overlay')
    expect(m.h.overlay).toBe('Buffering · downloading part 37 of 120')
  })
})

describe('LD-0001 r3 B8: element errors after metadata, and before any range', () => {
  test('an_error_after_loadedmetadata_shows_the_unsupported_card', async () => {
    const m = await mountStreaming(fakeSession(4))
    m.port.postMessage({ type: 'open-range', reqId: 'r1', start: 0, end: 99 })
    await tick()
    m.media.fire('loadedmetadata')
    m.media.error = { code: 4 }
    m.media.fire('error')
    await waitFor(() => m.h.path === 'unsupported', 'unsupported')
    expect(m.h.src).toBeNull()
    // A video does not reload whole-file behind the card.
    expect(m.h.blockWholeFile).toBe(true)
  })

  test('audio_after_metadata_is_unsupported_but_may_load_whole_file_to_convert', async () => {
    const m = await mountStreaming(fakeSession(4), fileRow('file-a'), 'audio')
    m.media.fire('loadedmetadata')
    m.media.error = { code: 4 }
    m.media.fire('error')
    await waitFor(() => m.h.path === 'unsupported', 'unsupported')
    expect(m.h.blockWholeFile).toBe(false)
  })

  test('an_error_before_any_range_falls_back_at_once', async () => {
    const m = await mountStreaming(fakeSession(4))
    m.media.error = { code: 4 }
    m.media.fire('error')
    await tick()
    expect(m.h.path).toBe('whole-file-fallback')
  })
})
