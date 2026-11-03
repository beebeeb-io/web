// ─── Crypto service ─────────────────────────────────
// Proxies all WASM crypto operations to a Web Worker via Comlink.
// Master key lives in memory on the main thread only.
//
// Memory-cap restart:
//   WebAssembly linear memory only grows — it never shrinks. After a long
//   session involving many large encrypt/decrypt ops the worker can hold
//   hundreds of MB. We periodically check the worker's reported memory
//   usage and, when it crosses MEMORY_THRESHOLD_BYTES, terminate it and
//   spawn a fresh worker. All consumer calls funnel through `withProxy`,
//   which gates new ops on `restartPromise` while a restart is in flight
//   and tracks `inFlight` so the swap waits for outstanding ops to drain.

import * as Comlink from 'comlink'
import type { CryptoWorker } from '../../workers/crypto.worker'

/** Soft cap on WASM linear-memory bytes before we recycle the worker. */
const MEMORY_THRESHOLD_BYTES = 256 * 1024 * 1024
/** Check memory every N completed ops (cheap: a single Comlink round-trip). */
const MEM_CHECK_INTERVAL = 16

let currentWorker: Worker | null = null
let workerProxy: Comlink.Remote<CryptoWorker> | null = null
let initPromise: Promise<void> | null = null

// ── Restart coordination state ──────────────────────────────────────────────
// `inFlight` counts ops that have grabbed `workerProxy` and not yet resolved.
// `restartPromise`, when set, blocks new ops at the gate inside `withProxy`.
// `idleNotifier`, when set, is resolved as soon as `inFlight` returns to 0.
let inFlight = 0
let restartPromise: Promise<void> | null = null
let opsSinceMemCheck = 0
let idleNotifier: (() => void) | null = null

function spawnWorker(): { worker: Worker; proxy: Comlink.Remote<CryptoWorker> } {
  const worker = new Worker(
    new URL('../../workers/crypto.worker.ts', import.meta.url),
    { type: 'module' },
  )
  const proxy = Comlink.wrap<CryptoWorker>(worker)
  return { worker, proxy }
}

/** Spawn the crypto worker and initialize WASM inside it (singleton). */
export async function initCrypto(): Promise<void> {
  if (workerProxy) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const { worker, proxy } = spawnWorker()
    await proxy.init()
    currentWorker = worker
    workerProxy = proxy
  })()

  try {
    await initPromise
  } finally {
    // Allow re-init after a terminate(): once `workerProxy` is null again
    // a later `initCrypto()` should run the spawn flow.
    initPromise = null
  }
}

function notifyIdleIfReached(): void {
  if (inFlight === 0 && idleNotifier) {
    const n = idleNotifier
    idleNotifier = null
    n()
  }
}

function waitForIdle(): Promise<void> {
  if (inFlight === 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    // Only one waiter ever — the restart driver. We don't have multiple
    // restart drivers because `restartPromise` itself gates concurrency.
    idleNotifier = resolve
  })
}

/**
 * Run `fn` against the current worker proxy with concurrency tracking.
 *
 * - Waits for any in-flight restart before grabbing the proxy
 * - Lazily initializes the worker on first call
 * - Increments `inFlight` for the duration of the call so a concurrent
 *   restart driver can wait for the op to settle before terminating
 * - After the call resolves, periodically polls memory usage and triggers
 *   a restart if the soft cap is exceeded
 */
/** @internal The worker-proxy gate, shared with the crypto/* modules. */
export async function withProxy<T>(
  fn: (proxy: Comlink.Remote<CryptoWorker>) => Promise<T>,
): Promise<T> {
  // Gate: block new ops while a restart is in flight.
  while (restartPromise) {
    await restartPromise
  }
  if (!workerProxy) {
    await initCrypto()
  }
  const proxy = workerProxy
  if (!proxy) {
    throw new Error('Crypto worker not initialized — call initCrypto() first')
  }

  inFlight++
  try {
    return await fn(proxy)
  } finally {
    inFlight--
    notifyIdleIfReached()
    opsSinceMemCheck++
    if (opsSinceMemCheck >= MEM_CHECK_INTERVAL && !restartPromise) {
      opsSinceMemCheck = 0
      // Fire and forget — restart runs in its own async context.
      void maybeRestart()
    }
  }
}

/**
 * True while the worker owns a stateful instance that a recycle would orphan:
 * each is a pointer into THIS worker's WASM memory, addressed from the main
 * thread by handle. A streaming encryptor (an upload; terminating mid-upload
 * would break finish()'s integrity guard), a content decryptor (a download,
 * task 1943), the search index (B4; long-lived, tiny) or a signup ceremony
 * (password, phrase and master key, task 1745). Direct proxy calls: they do
 * not count as in-flight ops.
 */
async function hasLiveWorkerInstances(proxy: Comlink.Remote<CryptoWorker>): Promise<boolean> {
  return (
    (await proxy.liveEncryptorCount()) > 0 ||
    (await proxy.liveDecryptorCount()) > 0 ||
    (await proxy.liveReaderCount()) > 0 ||
    (await proxy.liveSearchIndexCount()) > 0 ||
    (await proxy.liveCeremonyCount()) > 0
  )
}

/**
 * Check WASM memory usage; if above the threshold, terminate the worker
 * and spawn a fresh one. Safe to call concurrently — `restartPromise`
 * serializes the actual swap.
 */
async function maybeRestart(): Promise<void> {
  if (restartPromise || !workerProxy) return
  // LIVE-INSTANCE GUARD (hasLiveWorkerInstances): never recycle the worker
  // while it owns an encryptor, a content decryptor, the search index or a
  // signup ceremony. Checked here, before taking the restart lock, and again
  // under the lock once in-flight ops have drained. The index is name-only
  // (tiny), so blocking the recycle while one is live costs nothing: the
  // memory cap is only ever hit by a large upload or download, which the
  // encryptor and decryptor guards cover.
  try {
    if (await hasLiveWorkerInstances(workerProxy)) return
  } catch (err) {
    // Worker went away (terminate raced us) — bail; the next op lazily re-inits.
    console.warn('[crypto] live-instance count failed', err)
    return
  }
  let bytes = 0
  try {
    // Direct call (not via withProxy) so the memory probe itself doesn't
    // bump `inFlight` and deadlock the drain step below.
    bytes = await workerProxy.getMemoryUsage()
  } catch (err) {
    // If the worker has gone away (terminate raced us) just bail; the next
    // op will lazily re-init.
    console.warn('[crypto] getMemoryUsage failed', err)
    return
  }
  if (bytes <= MEMORY_THRESHOLD_BYTES) return
  // Re-check the lock — another driver may have raced us past the entry
  // guard while we were awaiting getMemoryUsage(). The next assignment must
  // be synchronous so a parallel driver sees a non-null restartPromise.
  if (restartPromise) return

  // Take the restart lock. Any new `withProxy` call now blocks until we're
  // done. Existing in-flight ops continue against the old worker and we
  // wait for them to settle before terminating.
  restartPromise = (async () => {
    try {
      await waitForIdle()
      // Re-check under the lock (Codex P2 on web#170): an op admitted between
      // the check above and taking the lock (a download creating its
      // decryptor, an upload its encryptor) has now finished and may own a
      // live instance in this worker. Recycling now would orphan its handle.
      // New ops stay blocked until this promise settles.
      const current = workerProxy
      if (!current || (await hasLiveWorkerInstances(current))) return
      const oldWorker = currentWorker
      currentWorker = null
      workerProxy = null
      try {
        oldWorker?.terminate()
      } catch (err) {
        console.warn('[crypto] worker.terminate() failed', err)
      }
      const { worker, proxy } = spawnWorker()
      await proxy.init()
      currentWorker = worker
      workerProxy = proxy
      // Best-effort observability — useful when watching the manual test.
      console.info(
        `[crypto] worker recycled at ${(bytes / (1024 * 1024)).toFixed(1)} MB WASM memory`,
      )
    } catch (err) {
      console.error('[crypto] worker restart failed', err)
      // Leave workerProxy null — the next withProxy() will run initCrypto()
      // which spawns a fresh worker from scratch.
    }
  })()
  try {
    await restartPromise
  } finally {
    restartPromise = null
  }
}

/**
 * Test-only hook: reports the current memory threshold + state. Not part
 * of the public API. Kept un-exported in production builds.
 */
export const __cryptoRestartInternals = {
  getInFlight: () => inFlight,
  getMemoryThresholdBytes: () => MEMORY_THRESHOLD_BYTES,
  isRestarting: () => restartPromise !== null,
  /** Test-only: the memory check every 16th completed op triggers, run now. */
  checkMemoryNow: () => maybeRestart(),
  /** Test-only: forget a test's fake worker (terminates nothing). */
  forgetWorkerForTests: () => {
    currentWorker = null
    workerProxy = null
    initPromise = null
    restartPromise = null
    inFlight = 0
    opsSinceMemCheck = 0
  },
}
