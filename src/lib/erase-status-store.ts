/**
 * Task 1918 round 4b — ONE status read for the unlocked app, with a short cache.
 *
 * The pending-erase banner sits in `DriveLayout`, which every drive page mounts, and the Trash
 * page and the empty drive offer "Restore everything from the erase". Each of them used to read
 * `GET /api/v1/account/erase-request` on its own, on every navigation. They now share this read:
 * an answer is reused for `ttlMs` (30 s), a read already in flight is shared instead of repeated,
 * and focus / visibility refreshes go through the same cache. An action that changed the state
 * (a cancel, a restore) asks for a fresh read with `force`.
 *
 * Cached per account (`key` = the user id), so a different sign-in in the same tab never sees
 * another account's request.
 *
 * Round 4c (web#174 review):
 * - newer read wins: every read is numbered, and an answer is cached only if no newer read has
 *   been cached (or invalidated) since it started. `invalidate()` also drops the read in flight:
 *   its late answer is never cached, and the next read does not join it.
 * - counts the person sees (what is left in the trash) never come from a cache older than their
 *   own action: the restore offers read with `force`, and every own action that changes the trash
 *   or the erase state calls `invalidate()`. Within the TTL the cache serves the banner's
 *   pending / awaiting state only.
 *
 * Round 4d (web#174 review):
 * - `invalidate()` notifies `subscribe()`rs, and `watchLastExecuted` re-reads fresh on every
 *   notification (coalesced), so a mounted restore offer follows the person's own trash actions
 *   and the trash's live events instead of keeping its first count;
 * - a forced read joins a read already in flight for the same account if that read started less
 *   than `FORCED_JOIN_MS` (1 s) ago and after the last `invalidate()`: a Trash visit (banner +
 *   offer) sends one GET, and a read after an own action is still fresh.
 */
import { getEraseRequest } from './api'
import { parseEraseStatus, type EraseExecuted, type EraseStatus } from './erase-request'

export const ERASE_STATUS_TTL_MS = 30_000
export const FORCED_JOIN_MS = 1_000
/** Notifications closer together than this make one re-read (a burst of live events). */
export const WATCH_COALESCE_MS = 250

export interface EraseStatusCache {
  /** The status (cached if fresh); `null` when the answer was not a status; rejects on failure. */
  read(key: string, opts?: { force?: boolean }): Promise<EraseStatus | null>
  /** Forget the cached answer (the next read goes to the server) and notify the subscribers. */
  invalidate(): void
  /** Called on every `invalidate()`; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
}

export function createEraseStatusCache(
  fetcher: () => Promise<unknown>,
  opts: { ttlMs?: number; now?: () => number } = {},
): EraseStatusCache {
  const ttl = opts.ttlMs ?? ERASE_STATUS_TTL_MS
  const now = opts.now ?? (() => Date.now())
  let cached: { key: string; at: number; seq: number; status: EraseStatus } | null = null
  let inflight: { key: string; seq: number; startedAt: number; promise: Promise<EraseStatus | null> } | null = null
  /** Numbers each read; `floor` = no answer of a read numbered at or below it may be cached. */
  let seq = 0
  let floor = 0
  const listeners = new Set<() => void>()

  return {
    read(key, { force = false } = {}) {
      if (!force && cached && cached.key === key && now() - cached.at < ttl) return Promise.resolve(cached.status)
      if (inflight && inflight.key === key && inflight.seq > floor) {
        // A plain read joins any read in flight; a forced one only a read that just started
        // (after the last invalidate, which `inflight.seq > floor` guarantees).
        if (!force || now() - inflight.startedAt < FORCED_JOIN_MS) return inflight.promise
      }
      const mySeq = ++seq
      const promise = (async () => {
        const status = parseEraseStatus(await fetcher())
        // Newer read wins: an older answer never replaces a newer cached one, and an answer to a
        // read that `invalidate()` superseded is not cached at all.
        if (status && mySeq > floor && (!cached || mySeq > cached.seq)) cached = { key, at: now(), seq: mySeq, status }
        return status
      })()
      const mine = { key, seq: mySeq, startedAt: now(), promise }
      inflight = mine
      const clear = () => {
        if (inflight === mine) inflight = null
      }
      promise.then(clear, clear)
      return promise
    },
    invalidate() {
      cached = null
      inflight = null
      floor = seq
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export interface WatchTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

const realTimers: WatchTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}

/**
 * Round 4d: follow the account's last erase. Reads fresh now and again (coalesced) after every
 * `invalidate()`, so the person's own trash actions and the trash's live events reach a mounted
 * offer. Only the newest read's answer is handed on. Returns the function that stops it.
 */
export function watchLastExecuted(
  cache: EraseStatusCache,
  key: string,
  onExecuted: (executed: EraseExecuted | null) => void,
  timers: WatchTimers = realTimers,
): () => void {
  let stopped = false
  let latest = 0
  let pending: unknown = null
  const readNow = () => {
    const mine = ++latest
    cache.read(key, { force: true }).then(
      (status) => {
        if (!stopped && mine === latest && status) onExecuted(status.last_executed)
      },
      () => {
        // No answer: the next notification tries again.
      },
    )
  }
  readNow()
  const unsubscribe = cache.subscribe(() => {
    if (stopped || pending !== null) return
    pending = timers.setTimeout(() => {
      pending = null
      if (!stopped) readNow()
    }, WATCH_COALESCE_MS)
  })
  return () => {
    stopped = true
    unsubscribe()
    if (pending !== null) timers.clearTimeout(pending)
  }
}

/** The app's one cache (banner, Trash offer, empty-drive offer). */
export const sharedEraseStatus: EraseStatusCache = createEraseStatusCache(() => getEraseRequest())
