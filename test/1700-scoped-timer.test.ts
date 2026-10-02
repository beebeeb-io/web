import { describe, expect, test } from 'bun:test'
import { createScopedTimer } from '../src/lib/scoped-timer'

/**
 * Task 1700 review S2 — drive's delayed actions (empty-derive confirmation and
 * the WS refetch coalescer) are scheduled for a folder/path, but the user can
 * navigate inside the delay window. A stale timer firing afterwards would
 * apply the OLD parent's rows under the NEW breadcrumb (or empty the new
 * folder). `createScopedTimer` captures the scope at schedule time and bails
 * when it no longer matches at fire time.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('1700 review S2: createScopedTimer', () => {
  test('fires when the scope is unchanged', async () => {
    let scope = '/|root'
    const timer = createScopedTimer(() => scope)
    let calls = 0
    timer.schedule(10, () => { calls += 1 })
    expect(timer.pending).toBe(true)
    await sleep(40)
    expect(calls).toBe(1)
    expect(timer.pending).toBe(false)
  })

  test('never fires after navigation changed the scope', async () => {
    let scope = '/|root'
    const timer = createScopedTimer(() => scope)
    let calls = 0
    timer.schedule(10, () => { calls += 1 })
    scope = '/?folder=F2|F2' // user navigated within the window
    await sleep(40)
    expect(calls).toBe(0)
  })

  test('a re-schedule replaces the pending run', async () => {
    let scope = '/|root'
    const timer = createScopedTimer(() => scope)
    const calls: string[] = []
    timer.schedule(30, () => calls.push('first'))
    timer.schedule(10, () => calls.push('second'))
    await sleep(60)
    expect(calls).toEqual(['second'])
  })

  test('cancel drops the pending run', async () => {
    let scope = '/|root'
    const timer = createScopedTimer(() => scope)
    let calls = 0
    timer.schedule(10, () => { calls += 1 })
    timer.cancel()
    await sleep(40)
    expect(calls).toBe(0)
    expect(timer.pending).toBe(false)
  })

  test('path-only navigation (same parent, different route) still invalidates', async () => {
    let scope = '/|root'
    const timer = createScopedTimer(() => scope)
    let calls = 0
    timer.schedule(10, () => { calls += 1 })
    scope = '/trash|root'
    await sleep(40)
    expect(calls).toBe(0)
  })
})
