// ─── Sync retry backoff ─────────────────────────────
// Every retry delay the sync client grows: the SSE reconnect, the gap fill,
// and the coverage resync each double per failed attempt up to their own cap,
// so a persistently failing server is never hammered and a transient failure
// never spins.

/** How a retry delay grows with each failed attempt. */
export type BackoffPolicy =
  /** `baseMs`, then double per failed attempt, capped at `maxMs`. */
  | { readonly kind: 'exponential'; readonly baseMs: number; readonly maxMs: number }

/**
 * A retry delay that doubles per failed attempt up to its cap. The attempt
 * counter is consumed only by `next()`, so a caller that schedules one retry at
 * a time reads exactly one delay per failure.
 */
export class SyncBackoff {
  private attempts = 0

  constructor(private readonly policy: BackoffPolicy) {}

  /** The delay the next failed attempt would wait, without consuming it. */
  peek(): number {
    switch (this.policy.kind) {
      case 'exponential':
        return Math.min(this.policy.baseMs * 2 ** this.attempts, this.policy.maxMs)
    }
  }

  /** Consume one failed attempt and return the delay to wait before the retry. */
  next(): number {
    const delay = this.peek()
    this.attempts += 1
    return delay
  }

  /** Failed attempts since the last success. */
  get failedAttempts(): number {
    return this.attempts
  }

  /** Start over: the next delay is the base again. */
  reset(): void {
    this.attempts = 0
  }
}

/** SSE reconnect: fast first retry, then back off to half a minute. */
export const RECONNECT_BACKOFF: BackoffPolicy = {
  kind: 'exponential',
  baseMs: 1_500,
  maxMs: 30_000,
}

/** Gap fill: starts as a debounce (30ms), backs off to five seconds. */
export const GAP_FILL_BACKOFF: BackoffPolicy = {
  kind: 'exponential',
  baseMs: 30,
  maxMs: 5_000,
}

/** Coverage resync: starts as a debounce (100ms), backs off to ten seconds. */
export const COVERAGE_RESYNC_BACKOFF: BackoffPolicy = {
  kind: 'exponential',
  baseMs: 100,
  maxMs: 10_000,
}
