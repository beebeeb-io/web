/**
 * Task 1918 round 4c — the second /code-review pass on 9f2c6d6..b47ce5e (no P1, 1 P2, 7 P3),
 * fixed on top of b47ce5e. One describe per item of the coordinator's list:
 *
 *  1. [P2] no count the person sees comes from a cache older than their own action: the restore
 *     offers read fresh on mount, every own action that changes the trash or the erase state
 *     invalidates the shared cache, and the banner (which the cache may serve) shows no counts;
 *  2. the cache: newer read wins, and `invalidate()` drops the read in flight;
 *  3. the banner's "Check again" after an unknown cancel follows the screen's rule and says
 *     "There is no erase request pending now." when a read shows none;
 *  4. the banner's due-time timer reads fresh;
 *  5. after a refused or unknown restore outcome the block reads once;
 *  6. after an UNKNOWN outcome a fresh status replaces the error with the truth ("The restore did
 *     not start." when it shows none); a refusal's error stays until the next click;
 *  7. the locked screen applies a block-read status like its own read;
 *  8. a status without this erase still goes to the parent.
 *
 * New exports are imported dynamically, so on b47ce5e each test fails on its own.
 *
 * Round 4d (web#174 review, finding 5): the tests that read the SOURCE of the restore block and
 * the banner now drive their controllers (`lib/restore-controller.ts`,
 * `lib/erase-banner-controller.ts`) and the cache instead. Kept as source checks, because only a
 * DOM could exercise them: the Trash page's handlers and the locked screen's wiring (marked
 * "source check (no DOM)" below).
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { eraseCard, type EraseStatus } from '../src/lib/erase-request'
import { apiError, flush, manualTimers } from './helpers/erase-request-fakes'

const SRC = path.resolve(import.meta.dir, '../src')
const REQ = '6f1c2b8e-0000-4000-8000-000000000007'

type Mod = Record<string, unknown>
type Fn = (...args: unknown[]) => unknown
const lib = async () => (await import('../src/lib/erase-request')) as unknown as Mod
const restoreCtl = async () => (await import('../src/lib/restore-controller')) as unknown as Mod
const bannerCtl = async () => (await import('../src/lib/erase-banner-controller')) as unknown as Mod
const store = async () => (await import('../src/lib/erase-status-store')) as unknown as Mod
const restoreMod = async () => (await import('../src/components/restore-from-erase')) as unknown as Mod
const bannerMod = async () => (await import('../src/components/erase-request-banner')) as unknown as Mod

const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const AWAITING = {
  id: REQ,
  requested_at: '2026-10-18T10:00:00Z',
  due_at: null,
  item_count: 1240,
  cancellable: true,
  verified: false,
  verify_expires_at: '2026-10-19T10:00:00Z',
}
const PENDING = { ...AWAITING, due_at: '2026-10-21T12:00:00Z', verified: true, verify_expires_at: null }
const EXECUTED = {
  id: REQ,
  executed_at: '2026-10-18T12:00:00Z',
  items_trashed: 150,
  trashed_at: '2026-10-18T11:59:00Z',
  restorable_until: '2026-11-17T11:59:00Z',
  in_trash: 150,
  restore: null,
}
const RUNNING = { ...EXECUTED, in_trash: 100, restore: { state: 'running', requested_at: null, rows_restored: 50, finished_at: null } }

function status(over: Record<string, unknown> = {}): EraseStatus {
  return {
    request: null,
    live_items: 0,
    cooldown_hours: 72,
    trash_retention_days: 30,
    last_executed: null,
    last_expired: null,
    ...over,
  } as unknown as EraseStatus
}

function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** The body of `const <name> = …` up to the next top-level `  const ` declaration. */
function handlerBody(src: string, name: string): string {
  const start = src.indexOf(`  const ${name} = `)
  expect(start).toBeGreaterThan(-1)
  const next = src.indexOf('\n  const ', start + 10)
  return src.slice(start, next < 0 ? undefined : next)
}

// ── 1 ──────────────────────────────────────────────────────────────────────────────────────

describe('1. no count from a cache older than the person\'s own action', () => {
  test('the restore offers (Trash, empty drive) read fresh on mount', async () => {
    const m = await store()
    const reads: Array<{ force?: boolean }> = []
    const cache = {
      read: async (_k: string, o: { force?: boolean } = {}) => {
        reads.push(o)
        return status()
      },
      invalidate: () => {},
      subscribe: () => () => {},
    }
    const stop = (m.watchLastExecuted as Fn)(cache, 'u1', () => {}, manualTimers()) as () => void
    await flush()
    stop()
    expect(reads).toEqual([{ force: true }])
  })
  // Source check (no DOM): the Trash page's handlers cannot be clicked without a DOM.
  test('every own action that changes the trash invalidates the shared cache', () => {
    const trash = code('pages/trash.tsx')
    expect(trash).toMatch(/const trashChanged = \(\) => \{\s*sharedEraseStatus\.invalidate\(\)/)
    // Defined once (a handler cannot shadow it with a no-op) and called in each handler's finally.
    expect(trash.match(/const trashChanged = /g)?.length ?? 0).toBe(1)
    for (const name of ['handleRestore', 'performPermanentDelete', 'handleRestoreSelected', 'handleRestoreAll']) {
      expect(`${name}: ${/\} finally \{\s*trashChanged\(\)/.test(handlerBody(trash, name))}`).toBe(`${name}: true`)
    }
    // Round 4d: live trash events invalidate it too.
    expect(trash).toMatch(/\['file\.trashed', 'file\.restored', 'file\.deleted'\],\s*useCallback\(\(\) => \{\s*sharedEraseStatus\.invalidate\(\)/)
  })
  test('the restore block (start and finish), the banner cancel and the locked screen invalidate it', async () => {
    const r = await restoreCtl()
    const invalidate = mock(() => {})
    const ctl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: { restore: async () => ({ restore: { state: 'done', rows_restored: 150 }, in_trash: 0 }), status: async () => status() },
      timers: manualTimers(),
      invalidate,
    }) as { start(): Promise<void> }
    await ctl.start()
    expect(invalidate).toHaveBeenCalledTimes(2) // the answer, and "done"
    const b = await bannerCtl()
    const cacheInvalidate = mock(() => {})
    const banner = (b.createBannerController as Fn)({
      cache: { read: async () => status({ request: PENDING }), invalidate: cacheInvalidate, subscribe: () => () => {} },
      key: 'u1',
      deps: { create: async () => ({}), cancel: async () => ({ cancelled: true }), status: async () => status() },
      win: new EventTarget(),
      doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
      timers: manualTimers().hooks,
    }) as { attach(): void; cancel(): Promise<void> }
    banner.attach()
    await flush()
    await banner.cancel()
    expect(cacheInvalidate).toHaveBeenCalledTimes(1)
    // Source check (no DOM): the locked screen's request and cancel handlers.
    const screen = code('components/vault-locked-no-key.tsx')
    expect(screen).toMatch(/requestErase\(ERASE_DEPS, count, token\)[\s\S]{0,120}sharedEraseStatus\.invalidate\(\)/)
    expect(screen).toMatch(/cancelErase\(ERASE_DEPS, shownId\)[\s\S]{0,120}sharedEraseStatus\.invalidate\(\)/)
  })
  test('the banner, which the cache may serve, shows no counts', async () => {
    const b = await bannerMod()
    const View = b.EraseRequestBannerView as React.FC<Record<string, unknown>>
    const draw = (card: unknown) =>
      decode(renderToStaticMarkup(React.createElement(View, { card, busy: false, note: '', error: '', onCancel: () => {}, nowMs: Date.parse('2026-10-19T00:00:00Z') })))
    for (const card of [eraseCard(status({ request: AWAITING })), eraseCard(status({ request: PENDING }))]) {
      const html = draw(card)
      expect(html).not.toContain('1240')
      expect(html).not.toMatch(/\d+ items?\b/)
    }
  })
})

// ── 2 ──────────────────────────────────────────────────────────────────────────────────────

describe('2. the cache: newer read wins; invalidate drops the read in flight', () => {
  type Cache = { read(key: string, opts?: { force?: boolean }): Promise<EraseStatus | null>; invalidate(): void }
  async function harness() {
    const m = await store()
    let fetches = 0
    const pending: Array<(v: unknown) => void> = []
    const cache = (m.createEraseStatusCache as Fn)(
      () => {
        fetches++
        return new Promise((r) => {
          pending.push(r)
        })
      },
      { ttlMs: 30_000, now: () => 0 },
    ) as Cache
    return { cache, fetches: () => fetches, pending }
  }

  test('an older answer arriving last does not replace the newer cached one', async () => {
    const m = await store()
    let fetches = 0
    let clock = 0
    const pending: Array<(v: unknown) => void> = []
    const cache = (m.createEraseStatusCache as Fn)(
      () => {
        fetches++
        return new Promise((r) => {
          pending.push(r)
        })
      },
      { ttlMs: 30_000, now: () => clock },
    ) as Cache
    const older = cache.read('u1')
    // Round 4d: a forced read within 1 s joins the older one; this one starts 2 s later.
    clock += 2_000
    const newer = cache.read('u1', { force: true })
    pending[1](status({ live_items: 2 }))
    await newer
    pending[0](status({ live_items: 1 }))
    await older
    const cached = await cache.read('u1')
    expect(fetches).toBe(2)
    expect(cached?.live_items).toBe(2)
  })
  test('invalidate: the read in flight is neither joined nor cached', async () => {
    const h = await harness()
    const stale = h.cache.read('u1')
    h.cache.invalidate()
    const fresh = h.cache.read('u1')
    expect(h.fetches()).toBe(2)
    h.pending[0](status({ live_items: 1 }))
    await stale
    h.pending[1](status({ live_items: 2 }))
    await fresh
    expect((await h.cache.read('u1'))?.live_items).toBe(2)
    const h2 = await harness()
    const lateOne = h2.cache.read('u1')
    h2.cache.invalidate()
    h2.pending[0](status({ live_items: 9 }))
    await lateOne
    const next = h2.cache.read('u1')
    expect(h2.fetches()).toBe(2)
    h2.pending[1](status({ live_items: 3 }))
    expect((await next)?.live_items).toBe(3)
  })
})

// ── 3 ──────────────────────────────────────────────────────────────────────────────────────

describe('3. the banner\'s "Check again" after an unknown cancel', () => {
  test('checkAgainAfterRead: stays until no request is pending, and then says so', async () => {
    const m = await lib()
    const after = m.checkAgainAfterRead as Fn
    expect(after('cancel', status({ request: PENDING }), false)).toEqual({ mode: 'cancel', note: null })
    expect(after('cancel', status(), false)).toEqual({ mode: null, note: 'There is no erase request pending now.' })
    expect(after('cancel', status({ request: PENDING }), true)).toEqual({ mode: null, note: 'The request is still pending.' })
    expect(after(null, status(), false)).toEqual({ mode: null, note: null })
  })

  test('the banner sets the cancel mode on an unknown outcome and reads through the rule', async () => {
    const b = await bannerCtl()
    let answer = status({ request: PENDING })
    const ctl = (b.createBannerController as Fn)({
      cache: { read: async () => answer, invalidate: () => {}, subscribe: () => () => {} },
      key: 'u1',
      deps: { create: async () => ({}), cancel: async () => Promise.reject(apiError(0, '')), status: async () => Promise.reject(new TypeError('x')) },
      win: new EventTarget(),
      doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
      timers: manualTimers().hooks,
    }) as { attach(): void; cancel(): Promise<void>; load(o?: unknown): Promise<void>; checkAgain(): Promise<void>; getState(): { checkAgain: boolean; note: string } }
    ctl.attach()
    await flush()
    await ctl.cancel()
    await flush()
    // the read right after the unknown cancel still shows the request: "Check again" stays
    expect(ctl.getState().checkAgain).toBe(true)
    // a later read shows nothing pending: it goes, and the note says so
    answer = status()
    await ctl.load()
    expect(ctl.getState().checkAgain).toBe(false)
    expect(ctl.getState().note).toBe('There is no erase request pending now.')
  })
})

// ── 4 ──────────────────────────────────────────────────────────────────────────────────────

describe('4. the banner\'s due-time timer reads fresh', () => {
  test('attachEraseRefresh: the due timer calls refreshDue; focus still calls refresh', async () => {
    const m = await lib()
    const attach = m.attachEraseRefresh as (h: unknown) => () => void
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const refresh = mock(() => {})
    const refreshDue = mock(() => {})
    const timeouts: Array<() => void> = []
    attach({
      win,
      doc,
      refresh,
      refreshDue,
      plan: { pollMs: null, dueInMs: 1_000 },
      setTimeoutFn: (fn: () => void) => timeouts.push(fn),
      clearTimeoutFn: () => {},
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    })
    timeouts[0]()
    expect(refreshDue).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(0)
    win.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  test('the banner passes a forced read as refreshDue', async () => {
    const b = await bannerCtl()
    const timers = manualTimers()
    const reads: Array<{ force?: boolean }> = []
    const ctl = (b.createBannerController as Fn)({
      cache: {
        read: async (_k: string, o: { force?: boolean } = {}) => {
          reads.push(o)
          return status({ request: PENDING })
        },
        invalidate: () => {},
        subscribe: () => () => {},
      },
      key: 'u1',
      deps: { create: async () => ({}), cancel: async () => ({}), status: async () => status() },
      win: new EventTarget(),
      doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
      timers: timers.hooks,
      now: () => Date.parse('2026-10-21T11:00:00Z'),
    }) as { attach(): void }
    ctl.attach()
    await flush()
    expect(reads).toEqual([{ force: false }])
    // the due-time timer (1 h + 1 s away) fires: a forced read
    expect(timers.timeouts()).toEqual([3_601_000])
    timers.fireTimeouts()
    await flush()
    expect(reads[1]).toEqual({ force: true })
  })
})

// ── 5 ──────────────────────────────────────────────────────────────────────────────────────

describe('5. after a refused or unknown restore outcome the block reads once', () => {
  test('a refused outcome reads the status once', async () => {
    const r = await restoreCtl()
    const statusRead = mock(async () => status({ last_executed: EXECUTED }))
    const ctl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: { restore: async () => Promise.reject(apiError(409, 'erase_not_finished')), status: statusRead },
      timers: manualTimers(),
    }) as { start(): Promise<void> }
    await ctl.start()
    await flush()
    expect(statusRead).toHaveBeenCalledTimes(1)
  })
})

// ── 6 ──────────────────────────────────────────────────────────────────────────────────────

describe('6. after an unknown outcome the truth replaces the error; a refusal stays', () => {
  test('restoreErrorAfterRead', async () => {
    const m = await lib()
    const after = m.restoreErrorAfterRead as Fn
    // Round 4d: a third argument, `followUp`; "not started" is trusted only from a follow-up.
    expect(after('unknown', EXECUTED, true)).toEqual({ clear: true, notice: 'The restore did not start.' })
    expect(after('unknown', EXECUTED, false)).toEqual({ clear: false, notice: null })
    expect(after('unknown', RUNNING, false)).toEqual({ clear: true, notice: null })
    expect(after('unknown', null, true)).toEqual({ clear: true, notice: null })
    expect(after('refused', RUNNING, true)).toEqual({ clear: false, notice: null })
    expect(after('refused', EXECUTED, true)).toEqual({ clear: false, notice: null })
    expect(after(null, RUNNING, true)).toEqual({ clear: false, notice: null })
  })
  test('the offer shows the notice in its status line', async () => {
    const m = await restoreMod()
    const View = m.RestoreFromEraseView as React.FC<Record<string, unknown>>
    const html = decode(
      renderToStaticMarkup(
        React.createElement(View, {
          executed: EXECUTED,
          offer: 'offer',
          busy: false,
          rowsRestored: 0,
          inTrash: 150,
          error: '',
          onRestore: () => {},
          notice: 'The restore did not start.',
        }),
      ),
    )
    const at = html.indexOf('data-testid="erase-restore-status"')
    expect(html.slice(at, html.indexOf('</p>', at))).toContain('The restore did not start.')
  })

  test('the block keeps a refusal through reads and replaces an unknown error after a follow-up', async () => {
    const r = await restoreCtl()
    type S = { error: string; errorKind: string | null }
    const refusedCtl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: { restore: async () => Promise.reject(apiError(409, 'erase_not_finished')), status: async () => status({ last_executed: RUNNING }) },
      timers: manualTimers(),
    }) as { start(): Promise<void>; poll(o?: unknown): Promise<void>; getState(): S }
    await refusedCtl.start()
    await flush()
    await refusedCtl.poll({ followUp: true })
    expect(refusedCtl.getState().errorKind).toBe('refused')
    expect(refusedCtl.getState().error).toContain('still running')
    const unknownCtl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: { restore: async () => Promise.reject(apiError(0, '')), status: async () => status({ last_executed: EXECUTED }) },
      timers: manualTimers(),
    }) as { start(): Promise<void>; poll(o?: unknown): Promise<void>; getState(): S & { notice: string } }
    await unknownCtl.start()
    await flush()
    expect(unknownCtl.getState().errorKind).toBe('unknown')
    await unknownCtl.poll({ followUp: true })
    expect(unknownCtl.getState().error).toBe('')
    expect(unknownCtl.getState().notice).toBe('The restore did not start.')
  })
})

// ── 7 ──────────────────────────────────────────────────────────────────────────────────────

describe('7. the locked screen applies a block-read status like its own read', () => {
  test('applyRestoreStatus clears a load error and takes part in "Check again"', async () => {
    // Round 4e: "takes part" = the screen's tracker (createCheckAgainTracker) reads it like any read.
    const m = await lib()
    const tracker = (m.createCheckAgainTracker as Fn)() as { unknownCancel(id: string): void; afterRead(s: EraseStatus, f: boolean): { mode: unknown; note: string | null } }
    tracker.unknownCancel(REQ)
    expect(tracker.afterRead(status({ request: PENDING }), false)).toEqual({ mode: 'cancel', note: null })
    expect(tracker.afterRead(status(), false)).toEqual({ mode: null, note: 'There is no erase request pending now.' })
    // Source check (no DOM): the screen applies a block-read status like its own read.
    expect(code('components/vault-locked-no-key.tsx')).toMatch(
      /const applyRestoreStatus = useCallback\(\(status: EraseStatus\) => \{\s*setEraseStatus\(status\)\s*setEraseLoadError\(''\)\s*applyCheckRead\(status, false\)/,
    )
  })
  test('a follow-up read superseded by a block poll reschedules itself', () => {
    expect(code('components/vault-locked-no-key.tsx')).toMatch(
      /if \(!eraseGate\.current\.isLatest\(seq\)\) \{\s*if \(followUp\) scheduleFollowUpRef\.current\(\)/,
    )
  })
})

// ── 8 ──────────────────────────────────────────────────────────────────────────────────────

describe('8. a status without this erase still goes to the parent', () => {
  test('the lost branch hands the status on before it stops', async () => {
    const r = await restoreCtl()
    const onStatus = mock((_s: unknown) => {})
    const gone = status({ last_executed: null })
    const ctl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: { restore: async () => ({}), status: async () => gone },
      timers: manualTimers(),
      onStatus,
    }) as { poll(): Promise<void>; getState(): { view: string } }
    await ctl.poll()
    expect(ctl.getState().view).toBe('lost')
    expect(onStatus).toHaveBeenCalledWith(gone)
  })
})
