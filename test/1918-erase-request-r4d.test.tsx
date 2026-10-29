/**
 * Task 1918 round 4d — the third /code-review pass on b47ce5e..bb953c0 (no P1, 3 P2, 3 P3),
 * fixed on top of bb953c0. BEHAVIOUR, not source text: the restore block and the banner are plain
 * controllers now (`lib/restore-controller.ts`, `lib/erase-banner-controller.ts`), driven here
 * with fake requests and manual timers; the cache and its watcher are called directly.
 *
 *  1. [P2] a mounted restore offer follows the person's own trash actions and live trash events:
 *     every `invalidate()` makes it read fresh again (coalesced);
 *  2. [P2] after an UNKNOWN restore outcome the error and "Check again" stay until a FOLLOW-UP
 *     read shows the truth (a read right after the failure does not end the doubt, unless it shows
 *     the restore running or done); the focus stays on the error;
 *  3. [P2] after an unknown cancel, a read showing the request RAN says so ("It had already run"),
 *     and one showing it moving says the move has started;
 *  4. a refusal's error survives a status that no longer carries the erase; the locked screen
 *     keeps the block for that erase until the person's next action;
 *  6. a forced read joins a read that started less than 1 s ago (one GET per Trash visit), never
 *     one from before an `invalidate()`.
 *
 * (Item 5, the source-regex tests of round 4c, is in test/1918-erase-request-r4c.test.tsx.)
 * New modules and exports are imported dynamically, so on bb953c0 each test fails on its own.
 */
import { describe, expect, mock, test } from 'bun:test'
import { apiError, deferred, flush, makeStatus, manualTimers } from './helpers/erase-request-fakes'

type Mod = Record<string, unknown>
type Fn = (...args: unknown[]) => unknown
const lib = async () => (await import('../src/lib/erase-request')) as unknown as Mod
const store = async () => (await import('../src/lib/erase-status-store')) as unknown as Mod
const restoreCtl = async () => (await import('../src/lib/restore-controller')) as unknown as Mod
const bannerCtl = async () => (await import('../src/lib/erase-banner-controller')) as unknown as Mod

const REQ = '6f1c2b8e-0000-4000-8000-000000000008'
const OTHER = '6f1c2b8e-0000-4000-8000-000000000009'
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
const PENDING = {
  id: REQ,
  requested_at: '2026-10-18T10:00:00Z',
  due_at: '2026-10-21T12:00:00Z',
  item_count: 1240,
  cancellable: true,
  verified: true,
  verify_expires_at: null,
}

interface Cache {
  read(key: string, opts?: { force?: boolean }): Promise<unknown>
  invalidate(): void
  subscribe(l: () => void): () => void
}

interface RState {
  view: string
  error: string
  errorKind: string | null
  checkAgain: boolean
  notice: string
  focusTick: number
  busy: boolean
}
interface RCtl {
  getState(): RState
  start(): Promise<void>
  poll(o?: { followUp?: boolean }): Promise<void>
  attach(): void
  detach(): void
}

async function restoreController(restore: () => Promise<unknown>, status: () => Promise<unknown>, extra: Record<string, unknown> = {}) {
  const m = await restoreCtl()
  const timers = manualTimers()
  const onStatus = mock((_s: unknown) => {})
  const invalidate = mock(() => {})
  const ctl = (m.createRestoreController as Fn)({
    executed: EXECUTED,
    deps: { restore, status },
    timers,
    invalidate,
    onStatus,
    followUpMs: 10_000,
    pollMs: 5_000,
    ...extra,
  }) as RCtl
  return { ctl, timers, onStatus, invalidate }
}

// ── 1 ──────────────────────────────────────────────────────────────────────────────────────

describe('1. a mounted restore offer re-reads after every invalidate', () => {
  test('fresh on start, fresh again (coalesced) after invalidations, nothing after stop', async () => {
    const m = await store()
    let answer = makeStatus({ last_executed: EXECUTED })
    const fetcher = mock(async () => answer)
    let clock = 0
    const cache = (m.createEraseStatusCache as Fn)(fetcher, { ttlMs: 30_000, now: () => clock }) as Cache
    const timers = manualTimers()
    const seen: Array<number | null> = []
    const stop = (m.watchLastExecuted as Fn)(cache, 'u1', (e: { in_trash: number } | null) => seen.push(e?.in_trash ?? null), timers) as () => void
    await flush()
    expect(seen).toEqual([150])
    // "Empty trash" / "Restore all" / a live file.deleted event: the trash changed.
    answer = makeStatus({ last_executed: { ...EXECUTED, in_trash: 0 } })
    clock += 5_000
    cache.invalidate()
    cache.invalidate()
    cache.invalidate()
    expect(timers.timeouts()).toEqual([m.WATCH_COALESCE_MS as number])
    timers.fireTimeouts()
    await flush()
    expect(seen).toEqual([150, 0])
    expect(fetcher).toHaveBeenCalledTimes(2)
    stop()
    cache.invalidate()
    timers.fireTimeouts()
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  test('the restore block invalidates the cache when it starts and when it is done', async () => {
    const { ctl, invalidate } = await restoreController(
      async () => ({ restore: { state: 'done', rows_restored: 150 }, in_trash: 0 }),
      async () => makeStatus({ last_executed: EXECUTED }),
    )
    await ctl.start()
    // once for the answer, once when it reached "done"
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(ctl.getState().view).toBe('done')
  })
})

// ── 2 ──────────────────────────────────────────────────────────────────────────────────────

describe('2. an unknown restore outcome waits for a follow-up read', () => {
  test('a read right after the failure keeps the error and "Check again"; the follow-up says it did not start', async () => {
    let reads = 0
    const { ctl, timers } = await restoreController(
      async () => Promise.reject(apiError(0, '')),
      async () => {
        reads++
        return makeStatus({ last_executed: EXECUTED }) // not started
      },
    )
    await ctl.start()
    await flush()
    // the reconcile inside restoreEverything, and the block's own read right after the failure
    expect(reads).toBe(2)
    let s = ctl.getState()
    expect(s.errorKind).toBe('unknown')
    expect(s.error).toContain("couldn't confirm whether the restore started")
    expect(s.checkAgain).toBe(true)
    expect(s.notice).toBe('')
    expect(s.focusTick).toBe(1)
    expect(timers.timeouts()).toContain(10_000)
    // the scheduled follow-up read
    timers.fireTimeouts()
    await flush()
    s = ctl.getState()
    expect(s.error).toBe('')
    expect(s.checkAgain).toBe(false)
    expect(s.notice).toBe('The restore did not start.')
    expect(s.focusTick).toBe(1)
  })

  test('a click on "Check again" is the follow-up', async () => {
    const { ctl } = await restoreController(
      async () => Promise.reject(apiError(0, '')),
      async () => makeStatus({ last_executed: EXECUTED }),
    )
    await ctl.start()
    await flush()
    expect(ctl.getState().checkAgain).toBe(true)
    await ctl.poll({ followUp: true })
    expect(ctl.getState().notice).toBe('The restore did not start.')
    expect(ctl.getState().checkAgain).toBe(false)
  })

  test('a read that shows the restore running ends the doubt at once', async () => {
    let reads = 0
    const held = deferred<unknown>()
    const { ctl } = await restoreController(
      async () => Promise.reject(apiError(0, '')),
      // the reconcile sees no restore (unknown outcome); the block's read right after sees it run
      () => (++reads === 1 ? Promise.resolve(makeStatus({ last_executed: EXECUTED })) : held.promise),
    )
    await ctl.start()
    expect(ctl.getState().errorKind).toBe('unknown')
    held.resolve(makeStatus({ last_executed: RUNNING }))
    await flush()
    const s = ctl.getState()
    expect(s.error).toBe('')
    expect(s.checkAgain).toBe(false)
    expect(s.view).toBe('running')
    expect(s.notice).toBe('')
  })

  test('the rule: not started is trusted only from a follow-up', async () => {
    const m = await lib()
    const after = m.restoreErrorAfterRead as Fn
    expect(after('unknown', EXECUTED, false)).toEqual({ clear: false, notice: null })
    expect(after('unknown', EXECUTED, true)).toEqual({ clear: true, notice: 'The restore did not start.' })
    expect(after('unknown', RUNNING, false)).toEqual({ clear: true, notice: null })
    expect(after('unknown', null, false)).toEqual({ clear: false, notice: null })
    expect(after('refused', EXECUTED, true)).toEqual({ clear: false, notice: null })
  })
})

// ── 3 ──────────────────────────────────────────────────────────────────────────────────────

describe('3. after an unknown cancel, a read says what really happened', () => {
  test('checkAgainAfterRead: it ran → "It had already run"; moving → the move has started', async () => {
    const m = await lib()
    const after = m.checkAgainAfterRead as Fn
    const ran = after('cancel', makeStatus({ last_executed: EXECUTED }), false, REQ) as { mode: unknown; note: string }
    expect(ran.mode).toBe(null)
    expect(ran.note).toContain('It had already run: every file is in the trash')
    expect(ran.note).not.toContain('There is no erase request pending now')
    const otherRan = after('cancel', makeStatus({ last_executed: { ...EXECUTED, id: OTHER } }), false, REQ) as { note: string }
    expect(otherRan.note).toBe('There is no erase request pending now.')
    const moving = after('cancel', makeStatus({ request: { ...PENDING, cancellable: false } }), false, REQ) as { mode: unknown; note: string }
    expect(moving.mode).toBe(null)
    expect(moving.note).toContain('The move to the trash has started')
    expect(moving.note).not.toContain('still pending')
  })

  test('the banner: unknown cancel, then a read showing the request ran', async () => {
    const m = await bannerCtl()
    let answer = makeStatus({ request: PENDING })
    const reads: Array<{ force?: boolean }> = []
    const cache: Cache = {
      read: async (_k, o = {}) => {
        reads.push(o)
        return answer
      },
      invalidate: mock(() => {}),
      subscribe: () => () => {},
    }
    const ctl = (m.createBannerController as Fn)({
      cache,
      key: 'u1',
      deps: { create: async () => ({}), cancel: async () => Promise.reject(apiError(0, '')), status: async () => Promise.reject(new TypeError('x')) },
      win: new EventTarget(),
      doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
      timers: manualTimers().hooks,
    }) as { getState(): { card: unknown; note: string; checkAgain: boolean }; attach(): void; cancel(): Promise<void>; load(o?: unknown): Promise<void> }
    ctl.attach()
    await flush()
    expect(ctl.getState().card).not.toBeNull()
    answer = makeStatus({ request: PENDING }) // the read right after: still there
    await ctl.cancel()
    await flush()
    expect(ctl.getState().checkAgain).toBe(true)
    // later: it had run
    answer = makeStatus({ last_executed: EXECUTED })
    await ctl.load({ force: true })
    const s = ctl.getState()
    expect(s.checkAgain).toBe(false)
    expect(s.note).toContain('It had already run')
    expect(s.card).toBeNull()
  })
})

// ── 4 ──────────────────────────────────────────────────────────────────────────────────────

describe('4. a refusal survives a status without the erase', () => {
  test('refused, then a read without this erase: lost, the refusal stays, the status goes up', async () => {
    const refusal = "We couldn't find that erase any more, so nothing was restored. What is still in the trash can be restored from Trash."
    const other = makeStatus({ last_executed: { ...EXECUTED, id: OTHER } })
    const { ctl, onStatus } = await restoreController(
      async () => Promise.reject(apiError(404, 'erase_request_not_found')),
      async () => other,
    )
    await ctl.start()
    await flush()
    const s = ctl.getState()
    expect(s.view).toBe('lost')
    expect(s.error).toBe(refusal)
    expect(s.errorKind).toBe('refused')
    expect(onStatus).toHaveBeenCalledWith(other)
  })

  test('the locked screen keeps the block for the erase the person acted on', async () => {
    const m = await lib()
    const slot = m.restoreSlotFor as Fn
    const pinned = { ...EXECUTED }
    expect(slot(pinned, null)).toBe(pinned)
    expect(slot(pinned, { ...EXECUTED, id: OTHER })).toBe(pinned)
    expect(slot(null, EXECUTED)).toBe(EXECUTED)
    expect(slot(null, { ...EXECUTED, in_trash: 0 })).toBe(null)
    expect(slot(null, null)).toBe(null)
  })
})

// ── 6 ──────────────────────────────────────────────────────────────────────────────────────

describe('6. a forced read joins a read that just started, never one from before an invalidate', () => {
  async function harness() {
    const m = await store()
    const pending: Array<ReturnType<typeof deferred<unknown>>> = []
    let clock = 0
    const cache = (m.createEraseStatusCache as Fn)(
      () => {
        const d = deferred<unknown>()
        pending.push(d)
        return d.promise
      },
      { ttlMs: 30_000, now: () => clock },
    ) as Cache
    return { cache, pending, advance: (ms: number) => (clock += ms), fetches: () => pending.length, joinMs: m.FORCED_JOIN_MS as number }
  }

  test('a Trash visit: the banner read and the offer\'s forced read are one GET', async () => {
    const h = await harness()
    expect(h.joinMs).toBe(1_000)
    const banner = h.cache.read('u1')
    h.advance(200)
    const offer = h.cache.read('u1', { force: true })
    expect(h.fetches()).toBe(1)
    h.pending[0].resolve(makeStatus())
    await Promise.all([banner, offer])
  })

  test('a forced read 1.5 s after a read still in flight sends its own GET', async () => {
    const h = await harness()
    void h.cache.read('u1')
    h.advance(1_500)
    void h.cache.read('u1', { force: true })
    expect(h.fetches()).toBe(2)
  })

  test('after an own action (invalidate) a forced read never joins the older read', async () => {
    const h = await harness()
    void h.cache.read('u1')
    h.cache.invalidate()
    void h.cache.read('u1', { force: true })
    expect(h.fetches()).toBe(2)
  })
})
