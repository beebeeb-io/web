/**
 * Task 2489 — a bulk delete's event burst must not become a request storm.
 *
 * The server publishes one `file.deleted` per erased row, so emptying a Trash
 * of 2835 files is 2835 events. The Trash page re-listed the WHOLE trash
 * (`listAllFiles`, ~15 pages) per event: thousands of GETs in seconds, past the
 * per-user limit (6000/60 s), and 120 refusals in a minute ban the account for
 * 5 minutes. Every page that refetches on file events coalesces the burst into
 * one run, and a steady stream still refetches at least every `maxWaitMs`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createWsBurstCoalescer } from '../src/lib/ws-burst-coalescer'
import type { TimerHooks } from '../src/lib/scoped-timer'
import type { WsEvent } from '../src/hooks/use-websocket'

const TIMING = { quietMs: 500, maxWaitMs: 5_000 }
const event = (type: string, id = 'x'): WsEvent => ({ type, data: { id }, timestamp: '' })

/** A clock that only moves when `advance` is called; due timers fire in order. */
function fakeClock() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, { at: number; fn: () => void }>()
  const hooks: TimerHooks = {
    setTimeout: (fn, ms) => {
      const id = nextId++
      pending.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (id) => { pending.delete(id as number) },
    now: () => now,
  }
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | null = null
      for (const entry of pending) {
        if (entry[1].at <= end && (due === null || entry[1].at < due[1].at)) due = entry
      }
      if (due === null) break
      pending.delete(due[0])
      now = due[1].at
      due[1].fn()
    }
    now = end
  }
  return { hooks, advance }
}

function source(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
}

describe('createWsBurstCoalescer', () => {
  test('a 2835-event burst runs once, after the quiet period', () => {
    const clock = fakeClock()
    let runs = 0
    const c = createWsBurstCoalescer(['file.deleted'], TIMING, () => { runs++ }, clock.hooks)
    for (let i = 0; i < 2835; i++) c.listener(event('file.deleted', String(i)))
    clock.advance(TIMING.quietMs - 1)
    expect(runs).toBe(0)
    clock.advance(1)
    expect(runs).toBe(1)
  })

  test('two bursts separated by a quiet period run twice', () => {
    const clock = fakeClock()
    let runs = 0
    const c = createWsBurstCoalescer(['file.deleted', 'file.trashed'], TIMING, () => { runs++ }, clock.hooks)
    for (let i = 0; i < 50; i++) c.listener(event('file.trashed'))
    clock.advance(1_000)
    for (let i = 0; i < 50; i++) c.listener(event('file.deleted'))
    clock.advance(1_000)
    expect(runs).toBe(2)
  })

  test('a steady stream still runs every maxWaitMs, then once after it ends', () => {
    const clock = fakeClock()
    let runs = 0
    const c = createWsBurstCoalescer(['file.uploaded'], TIMING, () => { runs++ }, clock.hooks)
    // One event every 100 ms for 12 s: never quiet for 500 ms.
    for (let i = 0; i < 120; i++) {
      c.listener(event('file.uploaded', String(i)))
      clock.advance(100)
    }
    expect(runs).toBe(2) // at 5 s and 10 s
    clock.advance(1_000)
    expect(runs).toBe(3) // the tail of the stream
  })

  test('events of other types never run it', () => {
    const clock = fakeClock()
    let runs = 0
    const c = createWsBurstCoalescer(['file.deleted'], TIMING, () => { runs++ }, clock.hooks)
    c.listener(event('file.starred'))
    c.listener(event('share.created'))
    clock.advance(10_000)
    expect(runs).toBe(0)
  })

  test('cancel drops a pending run (unmount)', () => {
    const clock = fakeClock()
    let runs = 0
    const c = createWsBurstCoalescer(['file.deleted'], TIMING, () => { runs++ }, clock.hooks)
    c.listener(event('file.deleted'))
    c.cancel()
    clock.advance(10_000)
    expect(runs).toBe(0)
  })
})

// Source checks: there is no DOM in this suite, so hooks and page handlers
// cannot be rendered or clicked.

describe('useCoalescedWsEvent keeps a pending run across re-subscriptions', () => {
  // WsProvider hands out a new context value on every render. Re-subscribing
  // must not cancel a run that a burst already armed.
  test('the subscription effect only forwards events; cancel lives in the coalescer effect', () => {
    const ws = source('src/lib/ws-context.tsx')
    const start = ws.indexOf('export function useCoalescedWsEvent(')
    expect(start).toBeGreaterThan(-1)
    const hook = ws.slice(start, ws.indexOf('\n}\n', start))
    expect(hook).toMatch(
      /useEffect\(\(\) => \{\s*if \(!ctx\) return\s*return ctx\.subscribe\(\(event\) => coalescerRef\.current\?\.listener\(event\)\)\s*\}, \[ctx\]\)/,
    )
    expect(hook).toMatch(/return \(\) => \{\s*coalescer\.cancel\(\)[^}]*\}\s*\}, \[typesKey, quietMs\]\)/)
  })
})

// The pages that refetch over the network on file events. Each subscribes
// through `useCoalescedWsEvent`; none keeps a per-event `useWsEvent` on a
// `file.*` event.
const REFETCHING_PAGES = [
  'src/pages/trash.tsx',
  'src/pages/recent.tsx',
  'src/pages/starred.tsx',
  'src/pages/photos.tsx',
]

describe('pages coalesce file-event refetches', () => {
  for (const page of REFETCHING_PAGES) {
    test(`${page} refetches through useCoalescedWsEvent`, () => {
      const src = source(page)
      expect(src).toContain('useCoalescedWsEvent(')
      expect(src).not.toMatch(/useWsEvent\(\s*\[[^\]]*'file\./)
    })
  }

  test('drive.tsx schedules every file-event refetch on the refetch timer, with a max wait', () => {
    const src = source('src/pages/drive.tsx')
    const start = src.indexOf("['file.created', 'file.uploaded', 'file.deleted'")
    expect(start).toBeGreaterThan(-1)
    const handler = src.slice(start, src.indexOf('\n  )\n', start))
    expect(handler).toMatch(/wsRefetchTimer\.schedule\(\d+, \(\) => fetchFilesRef\.current\(\), [\d_]+\)/)
    expect(handler).not.toMatch(/\bfetchFiles\(\)/)
  })
})

describe('Trash: an erase in progress owns the list', () => {
  // Batch N's events would otherwise refetch while batch N+1 runs, and that
  // refetch's `finally` clears `loading`, re-enabling Empty / Restore mid-erase.
  test('live events during an erase are deferred to one refetch when it ends', () => {
    const trash = source('src/pages/trash.tsx')
    expect(trash).toMatch(/if \(erasingRef\.current\) \{\s*refreshAfterEraseRef\.current = true\s*return\s*\}/)
    const start = trash.indexOf('const performPermanentDelete = ')
    const body = trash.slice(start, trash.indexOf('\n  }\n', start))
    expect(body).toMatch(/erasingRef\.current = true/)
    expect(body).toMatch(/\} finally \{[\s\S]*erasingRef\.current = false[\s\S]*if \(refreshAfterEraseRef\.current\)/)
  })
})
