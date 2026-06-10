import { ApiError } from './api'

const NETWORK_RETRY_MAX_ATTEMPTS = 3
const NETWORK_RETRY_BASE_DELAY_MS = 1000
const NETWORK_RETRY_JITTER = 0.2

/**
 * Wrap a network call so a network-class failure (`ApiError(_, status === 0)`,
 * i.e. `fetch` itself threw before getting any response) is retried with
 * exponential backoff. HTTP errors (4xx/5xx) bubble immediately — those are
 * deterministic, not transient.
 *
 * Honours an optional AbortSignal: if the caller cancels during a delay window
 * we throw an AbortError instead of retrying.
 *
 * Shared by uploads (`encrypted-upload.ts`) and share downloads (`share-view`).
 */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= NETWORK_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const isNetwork = err instanceof ApiError && err.status === 0
      const hasAttemptsLeft = attempt < NETWORK_RETRY_MAX_ATTEMPTS
      if (!isNetwork || signal?.aborted || !hasAttemptsLeft) throw err
      // Exponential backoff: 1s, 2s, 4s base, with ±20% jitter.
      const base = NETWORK_RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
      const jitterFactor = 1 + (Math.random() * 2 - 1) * NETWORK_RETRY_JITTER
      const delay = Math.round(base * jitterFactor)
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    }
  }
  // Unreachable — loop either returns or throws. Satisfies TS control-flow analysis.
  throw lastErr
}
