// Retry helper for public fetches that can hit the server's per-IP limiter.
// Every 429 is a strike against the caller's IP, so this never retries in a
// tight loop: it waits for Retry-After, else exponential backoff 2 s → 60 s.
// Any non-429 outcome (success or any other error) ends the loop at once.
import { ApiError } from '@beebeeb/shared'

export const BACKOFF_BASE_MS = 2000
export const BACKOFF_MAX_MS = 60_000

/** Milliseconds to wait before retry number `attempt` (0-based). */
export function backoffDelayMs(attempt: number, retryAfterSeconds?: number | null): number {
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(Math.max(retryAfterSeconds * 1000, BACKOFF_BASE_MS), BACKOFF_MAX_MS)
  }
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS)
}

/** Parse a delta-seconds Retry-After header; null when absent or not a number. */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header || !/^\s*\d+\s*$/.test(header)) return null
  return Number(header)
}

export interface BackoffOptions {
  /** Called with the wait (ms) before each sleep, so the UI can show "busy". */
  onWait?: (waitMs: number, attempt: number) => void
  signal?: AbortSignal
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run `fn`; on ApiError 429 wait and run it again (unbounded, but each wait is
 * at least 2 s). Resolves with fn's value, rejects with any other error, or
 * rejects with AbortError when `signal` aborts.
 */
export async function withRateLimitBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {},
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429) throw err
      const ra = typeof err.details?.retry_after === 'number' ? (err.details.retry_after as number) : null
      const wait = backoffDelayMs(attempt, ra)
      opts.onWait?.(wait, attempt)
      await sleep(wait)
    }
  }
}
