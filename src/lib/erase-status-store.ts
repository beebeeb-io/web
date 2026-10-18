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
 */
import { getEraseRequest } from './api'
import { parseEraseStatus, type EraseStatus } from './erase-request'

export const ERASE_STATUS_TTL_MS = 30_000

export interface EraseStatusCache {
  /** The status (cached if fresh); `null` when the answer was not a status; rejects on failure. */
  read(key: string, opts?: { force?: boolean }): Promise<EraseStatus | null>
  /** Forget the cached answer (the next read goes to the server). */
  invalidate(): void
}

export function createEraseStatusCache(
  fetcher: () => Promise<unknown>,
  opts: { ttlMs?: number; now?: () => number } = {},
): EraseStatusCache {
  const ttl = opts.ttlMs ?? ERASE_STATUS_TTL_MS
  const now = opts.now ?? (() => Date.now())
  let cached: { key: string; at: number; status: EraseStatus } | null = null
  let inflight: { key: string; promise: Promise<EraseStatus | null> } | null = null

  return {
    read(key, { force = false } = {}) {
      if (!force && cached && cached.key === key && now() - cached.at < ttl) return Promise.resolve(cached.status)
      if (!force && inflight && inflight.key === key) return inflight.promise
      const promise = (async () => {
        const status = parseEraseStatus(await fetcher())
        if (status) cached = { key, at: now(), status }
        return status
      })()
      const mine = { key, promise }
      inflight = mine
      const clear = () => {
        if (inflight === mine) inflight = null
      }
      promise.then(clear, clear)
      return promise
    },
    invalidate() {
      cached = null
    },
  }
}

/** The app's one cache (banner, Trash offer, empty-drive offer). */
export const sharedEraseStatus: EraseStatusCache = createEraseStatusCache(() => getEraseRequest())
