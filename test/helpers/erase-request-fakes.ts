/**
 * Task 1918 round 4d — fakes for driving the erase controllers (`lib/restore-controller.ts`,
 * `lib/erase-banner-controller.ts`) and the shared status cache in tests, without a DOM: a
 * deferred promise, manual timers, and a microtask flush.
 */
import type { EraseStatus } from '../../src/lib/erase-request'

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let pending promise callbacks run (a few microtask turns). */
export async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

export interface ManualTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
  /** The `setTimeoutFn` / … names `attachEraseRefresh` takes. */
  hooks: {
    setTimeoutFn: (fn: () => void, ms: number) => unknown
    clearTimeoutFn: (id: unknown) => void
    setIntervalFn: (fn: () => void, ms: number) => unknown
    clearIntervalFn: (id: unknown) => void
  }
  /** Live (not cleared, not yet fired) timeouts / intervals, with their delays. */
  timeouts(): number[]
  intervals(): number[]
  /** Fire every live timeout once (each is then gone). */
  fireTimeouts(): void
  /** Fire every live interval once. */
  tickIntervals(): void
}

export function manualTimers(): ManualTimers {
  let next = 1
  const timeouts = new Map<number, { fn: () => void; ms: number }>()
  const intervals = new Map<number, { fn: () => void; ms: number }>()
  const t: ManualTimers = {
    setTimeout: (fn, ms) => {
      const id = next++
      timeouts.set(id, { fn, ms })
      return id
    },
    clearTimeout: (id) => {
      timeouts.delete(id as number)
    },
    setInterval: (fn, ms) => {
      const id = next++
      intervals.set(id, { fn, ms })
      return id
    },
    clearInterval: (id) => {
      intervals.delete(id as number)
    },
    hooks: {
      setTimeoutFn: (fn, ms) => t.setTimeout(fn, ms),
      clearTimeoutFn: (id) => t.clearTimeout(id),
      setIntervalFn: (fn, ms) => t.setInterval(fn, ms),
      clearIntervalFn: (id) => t.clearInterval(id),
    },
    timeouts: () => [...timeouts.values()].map((x) => x.ms),
    intervals: () => [...intervals.values()].map((x) => x.ms),
    fireTimeouts: () => {
      const due = [...timeouts.entries()]
      for (const [id, { fn }] of due) {
        timeouts.delete(id)
        fn()
      }
    },
    tickIntervals: () => {
      for (const { fn } of [...intervals.values()]) fn()
    },
  }
  return t
}

export function makeStatus(over: Record<string, unknown> = {}): EraseStatus {
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

export function apiError(statusCode: number, code: string, message = ''): Error {
  return Object.assign(new Error(message || code), { status: statusCode, code, message: message || code })
}
