// Retry rules for the request helper, taken from core.
//
// The ladder (500 ms base, 30 s cap), the jitter bounds, which outcomes are
// retryable and how a server `Retry-After` is read all live in `beebeeb-wasm`
// (`beebeeb_core::retry`), proved by `test-vectors/consolidation/retry.json`.
// What stays in the transport is only its *policy* — the web client retries
// 429s alone, three times, and only inside a short window (see `request.ts`).

import init, { parseRetryAfter as coreParseRetryAfter, retryDecide } from 'beebeeb-wasm'

/**
 * The JS shape of a policy, as `retryPolicy()` returns it and as every core
 * entry point accepts it back. `jitter` is `'none'` (the shipped default) or
 * `'full'`.
 */
export interface RetryPolicy {
  max_attempts: number
  base_ms: number
  cap_ms: number
  jitter: 'none' | 'full'
}

/** What happened to the attempt that just finished. */
export type RetryOutcome = 'success' | 'network' | 'fatal' | { status: number }

let wasmInit: Promise<void> | null = null

/**
 * Load the wasm module once. Every caller after the first reuses the same
 * instance (and so does every other wasm-backed module on the page).
 */
export function ensureRetryWasm(): Promise<void> {
  if (wasmInit === null) {
    wasmInit = init().then(
      () => undefined,
      (error: unknown) => {
        wasmInit = null
        throw error
      },
    )
  }
  return wasmInit
}

/**
 * The `Retry-After` header as a number of seconds, or null when it is not
 * delta-seconds (absent, empty, negative, fractional, an HTTP date). Null
 * means "no server instruction", so the caller falls back to its own policy.
 */
export async function parseRetryAfterHeader(header: string | null): Promise<number | null> {
  if (header === null) return null
  await ensureRetryWasm()
  const seconds = coreParseRetryAfter(header)
  return typeof seconds === 'number' ? seconds : null
}

/**
 * Milliseconds to wait after `attemptsMade` attempts, or null to surface the
 * last error. A server `retryAfterSeconds` replaces the ladder exactly.
 */
export async function decideRetry(
  policy: RetryPolicy,
  attemptsMade: number,
  outcome: RetryOutcome,
  retryAfterSeconds: number | null,
): Promise<number | null> {
  await ensureRetryWasm()
  const delay = retryDecide(policy, attemptsMade, outcome, retryAfterSeconds)
  return typeof delay === 'number' ? delay : null
}
