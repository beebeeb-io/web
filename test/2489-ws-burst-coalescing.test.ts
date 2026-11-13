/**
 * Task 2489 — a bulk delete's event burst must not become a request storm.
 *
 * The server publishes one `file.deleted` per erased row, so emptying a Trash
 * of 2835 files is 2835 events. The Trash page re-listed the WHOLE trash
 * (`listAllFiles`, ~15 pages) per event: thousands of GETs in seconds, past the
 * per-user limit (6000/60 s), and 120 refusals in a minute ban the account for
 * 5 minutes. Every page that refetches on file events coalesces the burst into
 * one trailing run.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createWsBurstCoalescer } from '../src/lib/ws-burst-coalescer'
import type { WsEvent } from '../src/hooks/use-websocket'

const QUIET_MS = 20
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const event = (type: string, id = 'x'): WsEvent => ({ type, data: { id }, timestamp: '' })

function source(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
}

describe('createWsBurstCoalescer', () => {
  test('a 2835-event burst runs once, after the burst', async () => {
    let runs = 0
    const c = createWsBurstCoalescer(['file.deleted'], QUIET_MS, () => { runs++ })
    for (let i = 0; i < 2835; i++) c.listener(event('file.deleted', String(i)))
    expect(runs).toBe(0)
    await sleep(QUIET_MS * 3)
    expect(runs).toBe(1)
  })

  test('two bursts separated by a quiet period run twice', async () => {
    let runs = 0
    const c = createWsBurstCoalescer(['file.deleted', 'file.trashed'], QUIET_MS, () => { runs++ })
    for (let i = 0; i < 50; i++) c.listener(event('file.trashed'))
    await sleep(QUIET_MS * 3)
    for (let i = 0; i < 50; i++) c.listener(event('file.deleted'))
    await sleep(QUIET_MS * 3)
    expect(runs).toBe(2)
  })

  test('events of other types never run it', async () => {
    let runs = 0
    const c = createWsBurstCoalescer(['file.deleted'], QUIET_MS, () => { runs++ })
    c.listener(event('file.starred'))
    c.listener(event('share.created'))
    await sleep(QUIET_MS * 3)
    expect(runs).toBe(0)
  })

  test('cancel drops a pending run (unmount)', async () => {
    let runs = 0
    const c = createWsBurstCoalescer(['file.deleted'], QUIET_MS, () => { runs++ })
    c.listener(event('file.deleted'))
    c.cancel()
    await sleep(QUIET_MS * 3)
    expect(runs).toBe(0)
  })
})

// The pages that refetch over the network on file events. Each subscribes
// through `useCoalescedWsEvent`; none keeps a per-event `useWsEvent` on them.
const REFETCHING_PAGES = ['src/pages/trash.tsx', 'src/pages/recent.tsx', 'src/pages/starred.tsx']

describe('pages coalesce file-event refetches', () => {
  for (const page of REFETCHING_PAGES) {
    test(`${page} refetches through useCoalescedWsEvent`, () => {
      const src = source(page)
      expect(src).toContain('useCoalescedWsEvent(')
      expect(src).not.toMatch(/useWsEvent\(\s*\[[^\]]*'file\.deleted'/)
    })
  }

  test('drive.tsx schedules the uncovered-tree fallback on the refetch timer', () => {
    const src = source('src/pages/drive.tsx')
    const start = src.indexOf("['file.created', 'file.uploaded', 'file.deleted'")
    expect(start).toBeGreaterThan(-1)
    const handler = src.slice(start, src.indexOf('\n  )\n', start))
    expect(handler).toContain('wsRefetchTimer.schedule(')
    expect(handler).not.toMatch(/\bfetchFiles\(\)/)
  })
})
