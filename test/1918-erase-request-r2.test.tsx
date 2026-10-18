/**
 * Task 1918, round 2 (Codex review on web#174). Three findings, all fixed here:
 *
 *  4. [P1] erase-request.ts:204 — after a transport or parse failure the outcome of the POST is
 *     UNKNOWN (it may have been stored). Never say "Nothing was scheduled" then: ask the status
 *     endpoint, and say what it holds or that we could not confirm.
 *  5. [P1] vault-locked-no-key.tsx:152 — apply what a successful POST returned at once, and show
 *     a failed refresh (with a retry) even while a card is on screen.
 *  6. [P2] vault-locked-no-key.tsx:158 — refresh on focus and visibility, just after the due
 *     time, and on a light poll while a request is pending or moving.
 *
 * The sweep of the same patterns also covers the cancel path (a failed cancel must not claim
 * it "did not go through" when it may have) and the email-link page's copy.
 *
 * New exports are read through a dynamic import so this file runs against the previous head
 * too, where it fails at its assertions (the red run in the PR).
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EraseRequestCard, type EraseRequestCardProps } from '../src/components/erase-request-card'
import { cancelErase, eraseCard, requestErase, type EraseStatus } from '../src/lib/erase-request'

const SRC = path.resolve(import.meta.dir, '../src')

const PENDING = {
  id: '6f1c2b8e-0000-4000-8000-000000000001',
  requested_at: '2026-10-18T10:00:00Z',
  due_at: '2026-10-21T10:00:00Z',
  item_count: 1240,
  cancellable: true,
}

function status(over: Partial<EraseStatus> = {}): EraseStatus {
  return { request: null, live_items: 1240, cooldown_hours: 72, trash_retention_days: 30, last_executed: null, ...over }
}

type Mod = Record<string, unknown>
async function r2(): Promise<Mod> {
  return (await import('../src/lib/erase-request')) as unknown as Mod
}

const NOT_SCHEDULED = /nothing was scheduled|not scheduled|did not go through/i

// deps for the erase calls; `status` is what the server holds now.
function deps(create: () => Promise<unknown>, statusAnswer: () => Promise<unknown>) {
  return {
    create: mock(create),
    cancel: mock(async () => ({})),
    status: mock(statusAnswer),
  }
}

// ── 4. an unknown outcome is never reported as "not scheduled" ──────────────

describe('requestErase(): a lost or unreadable answer is an unknown outcome', () => {
  test('network failure, the server holds the request: it is shown as requested', async () => {
    const d = deps(
      async () => Promise.reject(new TypeError('Failed to fetch')),
      async () => status({ request: PENDING }),
    )
    const out = (await requestErase(d as never, 1240, 'tok')) as { kind: string; request?: unknown; message?: string }
    expect(out.kind).toBe('requested')
    expect(out.request).toEqual(PENDING)
    expect(d.status).toHaveBeenCalledTimes(1)
  })

  test('network failure, nothing pending (yet): "could not confirm", never "not scheduled"', async () => {
    const d = deps(async () => Promise.reject(new TypeError('Failed to fetch')), async () => status())
    const out = (await requestErase(d as never, 1240, 'tok')) as { kind: string; message?: string }
    expect(out.kind).toBe('unknown')
    expect(out.message ?? '').not.toMatch(NOT_SCHEDULED)
    expect(out.message ?? '').toMatch(/could not confirm/i)
  })

  test('network failure and the status read fails too: still unknown, not "not scheduled"', async () => {
    const d = deps(
      async () => Promise.reject(new TypeError('Failed to fetch')),
      async () => Promise.reject(new TypeError('Failed to fetch')),
    )
    const out = (await requestErase(d as never, 1240, 'tok')) as { kind: string; message?: string }
    expect(out.kind).toBe('unknown')
    expect(out.message ?? '').not.toMatch(NOT_SCHEDULED)
  })

  test('a 500 (the server may have stored it) is reconciled, not refused', async () => {
    const d = deps(
      async () => Promise.reject({ status: 500, code: 'internal', message: 'Something went wrong' }),
      async () => status({ request: PENDING }),
    )
    const out = (await requestErase(d as never, 1240, 'tok')) as { kind: string }
    expect(out.kind).toBe('requested')
  })

  test('a 2xx whose body cannot be read is reconciled, not refused', async () => {
    const d = deps(async () => '<html>proxy</html>', async () => status({ request: PENDING }))
    const out = (await requestErase(d as never, 1240, 'tok')) as { kind: string }
    expect(out.kind).toBe('requested')
  })

  test('a definite refusal keeps the server words and does not ask again', async () => {
    const d = deps(
      async () => Promise.reject({ status: 429, code: 'erase_request_rate_limited', message: 'You asked 3 times.' }),
      async () => status({ request: PENDING }),
    )
    expect(await requestErase(d as never, 1240, 'tok')).toEqual({ kind: 'refused', message: 'You asked 3 times.' })
    expect(d.status).toHaveBeenCalledTimes(0)
  })

  test('a clean 201 does not ask the status endpoint', async () => {
    const d = deps(async () => ({ request: PENDING, created: true }), async () => status())
    await requestErase(d as never, 1240, 'tok')
    expect(d.status).toHaveBeenCalledTimes(0)
  })
})

describe('cancelErase(): the same rule for the cancel (sweep)', () => {
  test('network failure, nothing pending any more: say so from the server state', async () => {
    const d = deps(async () => ({}), async () => status())
    d.cancel = mock(async () => Promise.reject(new TypeError('Failed to fetch')))
    const out = (await cancelErase(d as never)) as { kind: string }
    expect(out.kind).toBe('nothing_pending')
  })

  test('network failure, still pending: say it is still pending (the server says so)', async () => {
    const d = deps(async () => ({}), async () => status({ request: PENDING }))
    d.cancel = mock(async () => Promise.reject(new TypeError('Failed to fetch')))
    const out = (await cancelErase(d as never)) as { kind: string; request?: unknown }
    expect(out.kind).toBe('still_pending')
    expect(out.request).toEqual(PENDING)
  })

  test('network failure and no status: unknown, no claim either way', async () => {
    const d = deps(async () => ({}), async () => Promise.reject(new TypeError('x')))
    d.cancel = mock(async () => Promise.reject(new TypeError('Failed to fetch')))
    const out = (await cancelErase(d as never)) as { kind: string; message?: string }
    expect(out.kind).toBe('unknown')
    expect(out.message ?? '').not.toMatch(/did not go through/i)
  })
})

// ── 5. what a POST returned is applied; a failed refresh is visible ─────────

function renderCard(over: Partial<EraseRequestCardProps>): string {
  const props: EraseRequestCardProps = {
    card: eraseCard(status()),
    loadError: '',
    email: 'owner@example.org',
    cooldownHours: 72,
    retentionDays: 30,
    typed: '',
    onTypedChange: () => {},
    onRequest: () => {},
    onCancel: () => {},
    onRetryLoad: () => {},
    busy: false,
    note: '',
    error: '',
    ...over,
  }
  return renderToStaticMarkup(React.createElement(EraseRequestCard, props)).replace(/&#x27;/g, "'")
}

describe('a failed refresh is shown next to the last known state', () => {
  test('pending card + failed refresh: the pending state stays AND the error with a retry shows', () => {
    const html = renderCard({ card: eraseCard(status({ request: PENDING })), loadError: 'We could not check.' })
    expect(html).toContain('data-testid="erase-pending"')
    expect(html).toContain('data-testid="erase-refresh-error"')
    expect(html).toContain('may be out of date')
    expect(html).toMatch(/erase-refresh-error[\s\S]*Try again/)
  })

  test('ask card + failed refresh: the same', () => {
    const html = renderCard({ loadError: 'We could not check.' })
    expect(html).toContain('data-testid="erase-refresh-error"')
  })

  test('an unknown outcome offers "Check again"', () => {
    const html = renderCard({ checkAgain: true } as Partial<EraseRequestCardProps>)
    expect(html).toContain('data-testid="erase-check-again"')
  })
})

describe('applyRequest / applyCancelled: the POST answer is applied as is', () => {
  test('a created request replaces the shown one; a cancel clears it', async () => {
    const m = await r2()
    const applyRequest = m.applyRequest as (s: EraseStatus | null, r: unknown) => EraseStatus | null
    const applyCancelled = m.applyCancelled as (s: EraseStatus | null) => EraseStatus | null
    expect(typeof applyRequest).toBe('function')
    expect(typeof applyCancelled).toBe('function')
    expect(applyRequest(status(), PENDING)?.request).toEqual(PENDING)
    expect(applyRequest(status(), PENDING)?.live_items).toBe(1240)
    expect(applyCancelled(status({ request: PENDING }))?.request).toBeNull()
    expect(applyRequest(null, PENDING)).toBeNull()
  })

  /** The body of `if (outcome.kind === '<kind>') {` up to its `} else`. */
  function branch(src: string, kind: string): string {
    const start = src.indexOf(`if (outcome.kind === '${kind}') {`)
    expect(start).toBeGreaterThan(-1)
    return src.slice(start, src.indexOf('} else', start))
  }

  test('the screen applies them before (not instead of) refreshing', () => {
    const screen = readFileSync(path.join(SRC, 'components/vault-locked-no-key.tsx'), 'utf8')
    const created = branch(screen, 'requested')
    expect(created).toContain('applyRequest(s, outcome.request)')
    expect(created.indexOf('applyRequest(')).toBeLessThan(created.indexOf('loadEraseStatus()'))
    expect(created).not.toContain('await loadEraseStatus()')
    const cancelled = branch(screen, 'cancelled')
    expect(cancelled).toContain('setEraseStatus(applyCancelled)')
  })
})

// ── 6. the card follows the server while the screen stays open ──────────────

describe('eraseRefreshPlan(): when to look again', () => {
  test('pending: just after the due time, and a light poll', async () => {
    const plan = (await r2()).eraseRefreshPlan as (c: unknown, now: number) => { pollMs: number | null; dueInMs: number | null }
    expect(typeof plan).toBe('function')
    const now = Date.parse('2026-10-21T08:00:00Z')
    expect(plan(eraseCard(status({ request: PENDING })), now)).toEqual({ pollMs: 60_000, dueInMs: 2 * 3600_000 + 1_000 })
    // already past due: right away (1 s)
    expect(plan(eraseCard(status({ request: PENDING })), Date.parse('2026-10-22T00:00:00Z')).dueInMs).toBe(1_000)
  })

  test('moving: poll until done; nothing pending: no timers', async () => {
    const plan = (await r2()).eraseRefreshPlan as (c: unknown, now: number) => { pollMs: number | null; dueInMs: number | null }
    expect(plan(eraseCard(status({ request: { ...PENDING, cancellable: false } })), 0)).toEqual({ pollMs: 60_000, dueInMs: null })
    expect(plan(eraseCard(status()), 0)).toEqual({ pollMs: null, dueInMs: null })
    expect(plan(null, 0)).toEqual({ pollMs: null, dueInMs: null })
  })
})

describe('attachEraseRefresh(): focus, visibility, due time, poll', () => {
  async function harness(plan: { pollMs: number | null; dueInMs: number | null }) {
    const attach = (await r2()).attachEraseRefresh as (h: unknown) => () => void
    expect(typeof attach).toBe('function')
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const refresh = mock(() => {})
    const timeouts: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
    const intervals: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
    const dispose = attach({
      win,
      doc,
      refresh,
      plan,
      setTimeoutFn: (fn: () => void, ms: number) => timeouts.push({ fn, ms, cleared: false }) - 1,
      clearTimeoutFn: (id: unknown) => { timeouts[id as number].cleared = true },
      setIntervalFn: (fn: () => void, ms: number) => intervals.push({ fn, ms, cleared: false }) - 1,
      clearIntervalFn: (id: unknown) => { intervals[id as number].cleared = true },
    })
    return { win, doc, refresh, timeouts, intervals, dispose }
  }

  test('focus and becoming visible refresh; becoming hidden does not', async () => {
    const h = await harness({ pollMs: null, dueInMs: null })
    h.win.dispatchEvent(new Event('focus'))
    expect(h.refresh).toHaveBeenCalledTimes(1)
    h.doc.dispatchEvent(new Event('visibilitychange'))
    expect(h.refresh).toHaveBeenCalledTimes(2)
    h.doc.visibilityState = 'hidden'
    h.doc.dispatchEvent(new Event('visibilitychange'))
    expect(h.refresh).toHaveBeenCalledTimes(2)
  })

  test('the due timer and the poll are set from the plan and call refresh', async () => {
    const h = await harness({ pollMs: 60_000, dueInMs: 7_201_000 })
    expect(h.timeouts.map((t) => t.ms)).toEqual([7_201_000])
    expect(h.intervals.map((t) => t.ms)).toEqual([60_000])
    h.timeouts[0].fn()
    h.intervals[0].fn()
    expect(h.refresh).toHaveBeenCalledTimes(2)
  })

  test('dispose removes the listeners and clears the timers', async () => {
    const h = await harness({ pollMs: 60_000, dueInMs: 1_000 })
    h.dispose()
    h.win.dispatchEvent(new Event('focus'))
    expect(h.refresh).toHaveBeenCalledTimes(0)
    expect(h.timeouts[0].cleared).toBe(true)
    expect(h.intervals[0].cleared).toBe(true)
  })

  test('the screen wires it to window and document with the plan of the shown card', () => {
    const screen = readFileSync(path.join(SRC, 'components/vault-locked-no-key.tsx'), 'utf8')
    expect(screen).toMatch(/attachEraseRefresh\(\{\s*win: window,\s*doc: document,/)
    expect(screen).toContain('plan: eraseRefreshPlan(shownCard, Date.now())')
  })
})

// ── sweep: the email-link page makes no claim after a transport failure ────

describe('the cancel-link page says it cannot tell, after a failure to reach us', () => {
  test('no "Nothing has changed" after a network failure', () => {
    const page = readFileSync(path.join(SRC, 'pages/erase-request-cancel.tsx'), 'utf8')
    expect(page).not.toContain('Nothing has changed yet')
    expect(page).toContain("we can't tell whether it was cancelled")
  })
})
