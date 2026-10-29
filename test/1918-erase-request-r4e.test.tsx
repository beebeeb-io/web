/**
 * Task 1918 round 4e — after an unknown cancel on the LOCKED SCREEN, a read makes the note the
 * truth (the coordinator's follow-up of round 4d): the request ran → "It had already run…"; it
 * is moving → "The move to the trash has started…"; it is gone → "There is no erase request
 * pending now." The stale "We couldn't confirm what happened to the request" never stands next to
 * a card that shows the outcome.
 *
 * The screen calls `createCheckAgainTracker` (lib/erase-request.ts) for every read: these tests
 * drive that tracker the way the screen does (unknownCancel(shownId), then afterRead per read).
 * The banner uses the same tracker (its own tests: r4d item 3). The same rule now also covers an
 * unknown REQUEST outcome: a read that shows the request replaces "We couldn't confirm whether it
 * was scheduled" with what it shows.
 *
 * The tracker is imported dynamically, so on 85b75d6 each test fails on its own.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeStatus } from './helpers/erase-request-fakes'

const SRC = path.resolve(import.meta.dir, '../src')
type Mod = Record<string, unknown>
type Fn = (...args: unknown[]) => unknown
const lib = async () => (await import('../src/lib/erase-request')) as unknown as Mod

const SHOWN = '6f1c2b8e-0000-4000-8000-00000000000a'
const OTHER = '6f1c2b8e-0000-4000-8000-00000000000b'
const PENDING = {
  id: SHOWN,
  requested_at: '2026-10-18T10:00:00Z',
  due_at: '2026-10-21T12:00:00Z',
  item_count: 1240,
  cancellable: true,
  verified: true,
  verify_expires_at: null,
}
const AWAITING = { ...PENDING, due_at: null, verified: false, verify_expires_at: '2026-10-19T10:00:00Z' }
const EXECUTED = {
  id: SHOWN,
  executed_at: '2026-10-18T12:00:00Z',
  items_trashed: 150,
  trashed_at: '2026-10-18T11:59:00Z',
  restorable_until: '2026-11-17T11:59:00Z',
  in_trash: 150,
  restore: null,
}

interface Tracker {
  readonly mode: string | null
  unknownRequest(): void
  unknownCancel(id: string | null): void
  reset(): void
  afterRead(s: unknown, followUp: boolean): { mode: string | null; note: string | null }
}

async function trackerAfterUnknownCancel(): Promise<Tracker> {
  const m = await lib()
  const t = (m.createCheckAgainTracker as Fn)() as Tracker
  t.unknownCancel(SHOWN) // what the screen does with `shownId` on an unknown cancel
  return t
}

describe('the locked screen after an unknown cancel: the next read makes the note the truth', () => {
  test('the request it was cancelling RAN: "It had already run", "Check again" goes', async () => {
    const t = await trackerAfterUnknownCancel()
    const after = t.afterRead(makeStatus({ last_executed: EXECUTED }), false)
    expect(after.mode).toBe(null)
    expect(after.note).toBe('It had already run: every file is in the trash, where it can still be restored.')
  })

  test('it is MOVING (no longer cancellable): the move has started', async () => {
    const t = await trackerAfterUnknownCancel()
    const after = t.afterRead(makeStatus({ request: { ...PENDING, cancellable: false } }), false)
    expect(after.mode).toBe(null)
    expect(after.note).toBe('The move to the trash has started, so it can no longer be cancelled. Everything can be restored from the trash.')
  })

  test('it is GONE (cancelled, or another erase ran): no request pending', async () => {
    const t = await trackerAfterUnknownCancel()
    const after = t.afterRead(makeStatus({ last_executed: { ...EXECUTED, id: OTHER } }), false)
    expect(after).toEqual({ mode: null, note: 'There is no erase request pending now.' })
  })

  test('still pending: the doubt stays until the follow-up, which says it is still pending', async () => {
    const t = await trackerAfterUnknownCancel()
    expect(t.afterRead(makeStatus({ request: PENDING }), false)).toEqual({ mode: 'cancel', note: null })
    expect(t.afterRead(makeStatus({ request: PENDING }), true)).toEqual({ mode: null, note: 'The request is still pending.' })
  })

  test('once resolved, later reads leave the note alone (no repeated claims)', async () => {
    const t = await trackerAfterUnknownCancel()
    t.afterRead(makeStatus({ last_executed: EXECUTED }), false)
    expect(t.afterRead(makeStatus({ last_executed: EXECUTED }), false)).toEqual({ mode: null, note: null })
  })

  test('a new action resets it', async () => {
    const t = await trackerAfterUnknownCancel()
    t.reset()
    expect(t.mode).toBe(null)
    expect(t.afterRead(makeStatus({ last_executed: EXECUTED }), false)).toEqual({ mode: null, note: null })
  })
})

describe('the same rule for an unknown REQUEST outcome', () => {
  test('a read that shows the request replaces "couldn\'t confirm whether it was scheduled"', async () => {
    const m = await lib()
    const t = (m.createCheckAgainTracker as Fn)() as Tracker
    t.unknownRequest()
    expect(t.afterRead(makeStatus(), false)).toEqual({ mode: 'request', note: null })
    expect(t.afterRead(makeStatus({ request: AWAITING }), false)).toEqual({ mode: null, note: 'The request is waiting for confirmation by email.' })
  })

  test('the follow-up that still shows none says so', async () => {
    const m = await lib()
    const t = (m.createCheckAgainTracker as Fn)() as Tracker
    t.unknownRequest()
    expect(t.afterRead(makeStatus(), true)).toEqual({ mode: null, note: 'There is no erase request pending now.' })
  })
})

describe('the locked screen calls the tracker (source check: the screen cannot be rendered with effects here)', () => {
  test('every read goes through applyCheckRead; the unknown cancel hands the shown id; actions reset it', () => {
    const screen = readFileSync(path.join(SRC, 'components/vault-locked-no-key.tsx'), 'utf8')
    expect(screen).toMatch(/const after = eraseCheck\.current\.afterRead\(status, followUp\)\s*setEraseCheckAgain\(after\.mode\)\s*if \(after\.note\) setEraseNote\(after\.note\)/)
    expect(screen).toContain('applyCheckRead(status, followUp)')
    expect(screen).toContain('applyCheckRead(status, false)')
    expect(screen).toContain('eraseCheck.current.unknownCancel(shownId)')
    expect(screen).toContain('eraseCheck.current.unknownRequest()')
    expect(screen.match(/eraseCheck\.current\.reset\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})
