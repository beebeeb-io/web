/**
 * Task 1691 follow-up (bug-rel 1693 round) — the /auth/impersonate redeem
 * page must complete its transition under StrictMode's double-mount.
 *
 * The bug (reproduced on localhost, 2026-10-02): mount1 starts the async
 * redeem, StrictMode's cleanup sets `cancelled = true`, mount2 early-returns
 * on fired.current — so when the async finished, `if (cancelled) return`
 * bailed BEFORE setPhase('success')/window.location.replace('/'). The page
 * sat on "Starting support view" forever while the target session was
 * already live (POST /auth/impersonate 200, /auth/me 200, sessionStorage
 * markers set, no navigation).
 *
 * The fix: once redeem+getMe+markers succeeded, the transition is NOT
 * suppressed by the stale cancelled flag (completed work is recorded on a
 * ref and re-driven on remount). The double-POST guard (fired ref) is
 * preserved — the POST must fire exactly once.
 *
 * Rendered for real under <StrictMode> through the actual page component
 * (mocked api module), against the minimal DOM stub (see the Part B test
 * file's header for the harness notes). RED-first evidence (2026-10-02):
 * against the pre-fix page the success-transition test FAILS (page stuck on
 * "Starting support view", no navigation).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { mockModuleScoped } from './helpers/scoped-module-mock'

function makeDom() {
  const created: Array<Record<string, unknown>> = []
  function makeNode(tag: string): Record<string, unknown> {
    const children: Array<Record<string, unknown>> = []
    const el: Record<string, unknown> = {
      nodeType: tag === '#text' ? 3 : tag === '#comment' ? 8 : 1,
      tagName: tag === '#text' || tag === '#comment' ? undefined : tag.toUpperCase(),
      appendChild(c: Record<string, unknown>) { children.push(c); created.push(c); return c },
      removeChild(c: Record<string, unknown>) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c },
      insertBefore(c: Record<string, unknown>, _r: unknown) { children.push(c); created.push(c); return c },
      setAttribute() {}, getAttribute() { return null }, removeAttribute() {},
      addEventListener() {}, removeEventListener() {},
      style: {}, dataset: {},
      get firstChild() { return children[0] ?? null },
      contains() { return false },
      textContent: '',
      focus() {}, blur() {},
    }
    el.childNodes = children
    return el
  }
  const doc: Record<string, unknown> = {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (t: string) => { const n = makeNode('#text'); n.textContent = t; return n },
    createComment: (t: string) => makeNode('#comment'),
    createDocumentFragment: () => makeNode('#fragment'),
    addEventListener() {}, removeEventListener() {},
  }
  const navigations: string[] = []
  const win: Record<string, unknown> = {
    event: undefined,
    addEventListener() {}, removeEventListener() {},
    document: doc,
    HTMLIFrameElement: function (this: unknown) {},
    matchMedia: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
    history: { state: { idx: 0 }, replaceState() {}, pushState() {}, back() {}, forward() {}, go() {}, length: 1 },
    location: {
      href: 'http://localhost/auth/impersonate?token=stale-token-check',
      pathname: '/auth/impersonate',
      search: '?token=stale-token-check',
      hash: '', origin: 'http://localhost',
      replace: (u: string) => navigations.push(u),
      assign: (u: string) => navigations.push(u),
    },
    navigator: { onLine: true, userAgent: 'bun-test' },
  }
  const storage = {
    store: new Map<string, string>(),
    getItem(k: string) { return this.store.get(k) ?? null },
    setItem(k: string, v: string) { this.store.set(k, v) },
    removeItem(k: string) { this.store.delete(k) },
  }
  ;(win as Record<string, unknown>).localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  doc.defaultView = win
  const container = makeNode('div')
  ;(container as Record<string, unknown>).ownerDocument = doc
  doc.activeElement = container
  const body = makeNode('body')
  ;(body as Record<string, unknown>).ownerDocument = doc
  ;(body as Record<string, unknown>).dataset = {}
  doc.body = body
  return { doc, win, container, created, navigations, storage }
}

function installDom() {
  const dom = makeDom()
  const g = globalThis as Record<string, unknown>
  g.sessionStorage = dom.storage
  g.window = dom.win
  g.document = dom.doc
  g.navigator = { onLine: true, userAgent: 'bun-test' }
  return dom
}

let cleanup: (() => void) | null = null
beforeEach(() => { cleanup = null })
afterEach(() => { cleanup?.(); cleanup = null })

/**
 * Task 2094: every wait in this file is on OBSERVED state (a recorded mock
 * call, a navigation, rendered text), never on a fixed sleep. The old
 * `setTimeout(100)` / `setTimeout(700)` waits raced the dynamic imports, the
 * module mock and React's scheduler: under CPU contention (11 of 50 runs red
 * at 36 busy loops on 12 cores) the first test read postCount 0 and bailed
 * with its page still mounting, and that stray page then called the NEXT
 * test's mocked redeem (postCount 2).
 */
const WAIT_TIMEOUT_MS = 15_000
// bun's default test timeout is 5s; the waits above need more headroom under load.
const TEST_TIMEOUT_MS = 30_000

async function waitFor(what: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${WAIT_TIMEOUT_MS}ms waiting for: ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** One macrotask turn: lets any already-queued effect or microtask run. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

interface RenderedPage {
  text: () => string
  navigations: string[]
  storage: Map<string, string>
  unmount: () => void
}

async function renderRedeemPage(io: {
  redeem: (token: string) => Promise<Record<string, unknown>>
  getMe: () => Promise<Record<string, unknown>>
  token: string | null
}): Promise<RenderedPage> {
  const { doc, win, container, created, navigations, storage } = installDom()

  await mockModuleScoped('../src/lib/api.ts', import.meta.dir, (real: Record<string, unknown>) => ({
    ...real,
    redeemImpersonationToken: io.redeem,
    getMe: io.getMe,
  }))

  const { ImpersonateRedeem } = (await import('../src/pages/auth/impersonate.tsx')) as unknown as { ImpersonateRedeem: React.FC }
  const rr = (await import('react-router-dom')) as unknown as { MemoryRouter: React.FC<{ initialEntries?: string[]; children?: React.ReactNode }> }
  const client = (await import('react-dom/client')) as unknown as { createRoot: (e: unknown) => { render: (n: unknown) => void; unmount: () => void } }

  const root = client.createRoot(container)
  const url = io.token ? `/auth/impersonate?token=${io.token}` : '/auth/impersonate'
  root.render(
    React.createElement(React.StrictMode, null,
      React.createElement(rr.MemoryRouter, { initialEntries: [url] },
        React.createElement(ImpersonateRedeem))),
  )
  let unmounted = false
  const unmount = () => {
    if (unmounted) return
    unmounted = true
    root.unmount()
  }
  cleanup = unmount
  const text = () =>
    created
      .filter((c) => typeof c.textContent === 'string')
      .map((c) => c.textContent as string)
      .join('\n')
  return { text, navigations, storage: storage.store, unmount }
}

describe('task 1691 follow-up: /auth/impersonate completes under StrictMode double-mount', () => {
  test('RED (the stuck page): successful redeem drives setPhase(success) + location.replace(/) exactly once, POST exactly once', async () => {
    let postCount = 0
    let resolveRedeem: (v: Record<string, unknown>) => void = () => {}
    let resolveMe: (v: Record<string, unknown>) => void = () => {}
    const redeemPromise = new Promise<Record<string, unknown>>((res) => { resolveRedeem = res })
    const mePromise = new Promise<Record<string, unknown>>((res) => { resolveMe = res })

    const page = await renderRedeemPage({
      token: 'one-shot-token',
      redeem: async (_t) => { postCount++; return await redeemPromise },
      getMe: async () => await mePromise,
    })
    // Wait until mount1's effect has fired the POST, then let the rest of
    // StrictMode's mount1→cleanup→mount2 cycle run while the redeem promise is
    // still pending (the exact interleaving of the bug).
    await waitFor('the redeem POST to fire', () => postCount >= 1)
    await settle()
    expect(postCount).toBe(1) // double-POST guard held during the double-mount
    resolveRedeem({ session_token: 'tok', user_id: 'u-target', is_impersonation: true, admin_user_id: 'u-admin' })
    resolveMe({ email: 'target@example.com', user_id: 'u-target', is_impersonation: true })

    // The success transition must NOT be suppressed by the stale cancelled flag:
    // (the created[] accumulator holds EVERY phase's nodes — the redeeming
    // spinner's copy legitimately remains; assert on phase presence + the
    // navigation, which only the success path can fire).
    await waitFor('the success screen to render', () => page.text().includes('Redirecting to the drive'))
    await waitFor('the hard navigation', () => page.navigations.length >= 1)
    await settle() // a second navigation, if any, would land here
    const text = page.text()
    expect(text).toContain('Signed in')
    expect(text).toContain('Redirecting to the drive')
    // Hard navigation fired exactly once, to the drive:
    expect(page.navigations).toEqual(['/'])
    // Banner markers written:
    expect(page.storage.get('bb_impersonating_email')).toBe('target@example.com')
    expect(page.storage.get('bb_impersonating_admin_id')).toBe('u-admin')
    // Exactly one POST for the single-use token:
    expect(postCount).toBe(1)
  }, TEST_TIMEOUT_MS)

  test('redeem failure still surfaces the error screen (no stale-cancel stuck state either)', async () => {
    let postCount = 0
    const page = await renderRedeemPage({
      token: 'dead-token',
      redeem: async (_t) => { postCount++; throw new Error('This impersonation link has expired or already been used.') },
      getMe: async () => { throw new Error('should not be reached') },
    })
    await waitFor('the error screen to render', () => page.text().includes('Link unavailable'))
    await settle() // a second POST or a late navigation, if any, would land here
    const text = page.text()
    expect(text).toContain('Link unavailable')
    expect(text).toContain('This impersonation link has expired or already been used.')
    expect(text).not.toContain('Signed in')
    expect(page.navigations).toEqual([])
    expect(postCount).toBe(1)
  }, TEST_TIMEOUT_MS)

  test('missing token → error screen without any POST', async () => {
    let postCount = 0
    const page = await renderRedeemPage({
      token: null,
      redeem: async () => { postCount++; return {} },
      getMe: async () => ({}),
    })
    await waitFor('the error screen to render', () => page.text().includes('Link unavailable'))
    await settle()
    const text = page.text()
    expect(text).toContain('Link unavailable')
    expect(text).toContain('Missing impersonation token in the URL.')
    expect(page.navigations).toEqual([])
    expect(postCount).toBe(0)
  }, TEST_TIMEOUT_MS)
})
