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
