import { expect, test } from 'bun:test'
import { WorkQueue } from '../src/lib/work-queue'
import { applyIndexDiff } from '../src/lib/search-index-diff'

test('1909: queue releases failed work, skips queued cancellation and serializes one key', async () => {
  const queue = new WorkQueue(2), events: string[] = []
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const abort = new AbortController()
  const first = queue.run(async () => { events.push('first'); await gate; throw Error('failed') }, undefined, 'page')
  const second = queue.run(async () => { events.push('second') }, undefined, 'page')
  const cancelled = queue.run(async () => { events.push('cancelled') }, abort.signal, 'page')
  const independent = queue.run(async () => { events.push('independent') }, undefined, 'other')
  const done = Promise.allSettled([first, second, cancelled, independent])
  await independent
  expect(events).toEqual(['first', 'independent'])
  abort.abort(); release()
  const results = await done
  expect(events).toEqual(['first', 'independent', 'second'])
  expect(results.map(r => r.status)).toEqual(['rejected', 'fulfilled', 'rejected', 'fulfilled'])
})

test('1909: reconciliation flushes retained failed publications on an unchanged tree', async () => {
  let calls = 0
  const target = { hasPendingPublication: true, upsert: async () => [], remove: async () => [],
    pushBuckets: async (_key: Uint8Array, dirty: number[]) => { calls++; expect(dirty).toEqual([]); throw Error('still unavailable') } }
  const result = await applyIndexDiff(target, new Uint8Array(32), { upserts: [], prunes: [] })
  expect(calls).toBe(1)
  expect(result.pushed).toBe(false)
})
