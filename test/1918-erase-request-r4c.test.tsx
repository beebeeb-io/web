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
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { eraseCard, type EraseStatus } from '../src/lib/erase-request'

const SRC = path.resolve(import.meta.dir, '../src')
const REQ = '6f1c2b8e-0000-4000-8000-000000000007'

type Mod = Record<string, unknown>
type Fn = (...args: unknown[]) => unknown
const lib = async () => (await import('../src/lib/erase-request')) as unknown as Mod
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
  test('the restore offers (Trash, empty drive) read fresh on mount', () => {
    expect(code('components/restore-from-erase.tsx')).toContain('sharedEraseStatus.read(key, { force: true }).then(')
  })

  test('every own action that changes the trash invalidates the shared cache', () => {
    const trash = code('pages/trash.tsx')
    expect(trash).toMatch(/const trashChanged = \(\) => \{\s*sharedEraseStatus\.invalidate\(\)/)
    for (const name of ['handleRestore', 'performPermanentDelete', 'handleRestoreSelected', 'handleRestoreAll']) {
      expect(`${name}: ${handlerBody(trash, name).includes('trashChanged()')}`).toBe(`${name}: true`)
    }
  })

  test('the restore block (start and finish), the banner cancel and the locked screen invalidate it', () => {
    const block = code('components/restore-from-erase.tsx')
    expect(block).toMatch(/seqGate\.supersede\(\)\s*sharedEraseStatus\.invalidate\(\)/)
    expect(block).toMatch(/doneReported\.current = true\s*sharedEraseStatus\.invalidate\(\)/)
    expect(code('components/erase-request-banner.tsx')).toMatch(/gate\.current\.supersede\(\)\s*sharedEraseStatus\.invalidate\(\)/)
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
    const h = await harness()
    const older = h.cache.read('u1')
    const newer = h.cache.read('u1', { force: true })
    h.pending[1](status({ live_items: 2 }))
    await newer
    h.pending[0](status({ live_items: 1 }))
    await older
    const cached = await h.cache.read('u1')
    expect(h.fetches()).toBe(2)
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

  test('the banner sets the cancel mode on an unknown outcome and reads through the rule', () => {
    const banner = code('components/erase-request-banner.tsx')
    expect(banner).toContain("checkMode.current = 'cancel'")
    expect(banner).toContain('const after = checkAgainAfterRead(checkMode.current, status, opts.followUp === true)')
    expect(banner).toContain('if (after.note) setNote(after.note)')
    expect(banner).toContain('onCheckAgain={() => void load({ followUp: true })}')
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

  test('the banner passes a forced read as refreshDue', () => {
    expect(code('components/erase-request-banner.tsx')).toContain('refreshDue: () => void load({ force: true })')
  })
})

// ── 5 ──────────────────────────────────────────────────────────────────────────────────────

describe('5. after a refused or unknown restore outcome the block reads once', () => {
  test('the else branch of start() polls', () => {
    const block = code('components/restore-from-erase.tsx')
    expect(block).toMatch(/errorKind\.current = outcome\.kind\s*if \(outcome\.kind === 'unknown'\) setCheckAgain\(true\)\s*void poll\(\)/)
  })
})

// ── 6 ──────────────────────────────────────────────────────────────────────────────────────

describe('6. after an unknown outcome the truth replaces the error; a refusal stays', () => {
  test('restoreErrorAfterRead', async () => {
    const m = await lib()
    const after = m.restoreErrorAfterRead as Fn
    expect(after('unknown', EXECUTED)).toEqual({ clear: true, notice: 'The restore did not start.' })
    expect(after('unknown', RUNNING)).toEqual({ clear: true, notice: null })
    expect(after('unknown', null)).toEqual({ clear: true, notice: null })
    expect(after('refused', RUNNING)).toEqual({ clear: false, notice: null })
    expect(after('refused', EXECUTED)).toEqual({ clear: false, notice: null })
    expect(after(null, RUNNING)).toEqual({ clear: false, notice: null })
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

  test('the block keeps the kind of its error and asks the rule after every read', () => {
    const block = code('components/restore-from-erase.tsx')
    expect(block).toContain('errorKind.current = outcome.kind')
    expect(block).toContain('const after = restoreErrorAfterRead(errorKind.current,')
    expect(block).toMatch(/if \(after\.clear\) \{\s*setError\(''\)\s*errorKind\.current = null/)
    expect(block).toContain('if (after.notice) setNotice(after.notice)')
  })
})

// ── 7 ──────────────────────────────────────────────────────────────────────────────────────

describe('7. the locked screen applies a block-read status like its own read', () => {
  test('applyRestoreStatus clears a load error and takes part in "Check again"', () => {
    const screen = code('components/vault-locked-no-key.tsx')
    expect(screen).toMatch(
      /const applyRestoreStatus = useCallback\(\(status: EraseStatus\) => \{\s*setEraseStatus\(status\)\s*setEraseLoadError\(''\)\s*setEraseCheckAgain\(\(mode\) => keepCheckAgain\(mode, status, false\)\)/,
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
  test('the lost branch hands the status on before it stops', () => {
    expect(code('components/restore-from-erase.tsx')).toMatch(/if \(update\.kind === 'lost'\) \{\s*setLost\(true\)\s*onStatus\?\.\(status\)\s*return/)
  })
})
