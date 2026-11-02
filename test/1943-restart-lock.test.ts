/**
 * Task 1943 — the crypto worker is never recycled out from under a live
 * worker-owned instance (Codex P2 on web#170).
 *
 * `maybeRestart` (src/lib/crypto.ts) checks the live-instance counts, probes
 * memory, and only then takes the restart lock and drains in-flight ops. An op
 * admitted in between (a download creating its content decryptor, an upload
 * its encryptor) finishes during the drain and owns a live instance in the OLD
 * worker; terminating it then orphans that handle and the next frame fails
 * against the new worker. The counts are therefore checked again under the
 * lock.
 *
 * A fake Worker and a scripted Comlink proxy stand in for the worker: the
 * proxy reports memory above the cap and the decryptor count the script says.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

class FakeWorker {
  terminated = false
  constructor() {
    workers.push(this)
  }
  terminate() {
    this.terminated = true
  }
}
let workers: FakeWorker[] = []

interface Script {
  /** What liveDecryptorCount returns on its 1st, 2nd, ... call (the last repeats). */
  decryptorCounts: number[]
  /** What liveReaderCount returns on its 1st, 2nd, ... call (the last repeats). */
  readerCounts?: number[]
}
let script: Script = { decryptorCounts: [0] }
const proxies: Array<{ decryptorCalls: number }> = []

function scriptedProxy() {
  const state = { decryptorCalls: 0, readerCalls: 0 }
  proxies.push(state)
  return {
    init: async () => {},
    liveEncryptorCount: async () => 0,
    liveDecryptorCount: async () => {
      const i = Math.min(state.decryptorCalls, script.decryptorCounts.length - 1)
      state.decryptorCalls++
      return script.decryptorCounts[i]
    },
    liveReaderCount: async () => {
      const counts = script.readerCounts ?? [0]
      const i = Math.min(state.readerCalls, counts.length - 1)
      state.readerCalls++
      return counts[i]
    },
    liveSearchIndexCount: async () => 0,
    liveCeremonyCount: async () => 0,
    getMemoryUsage: async () => 512 * 1024 * 1024, // above the 256 MiB cap
  }
}

await mockModuleScoped('comlink', import.meta.dir, { wrap: () => scriptedProxy() })
const crypto = await import('../src/lib/crypto')

const realWorker = globalThis.Worker
beforeEach(() => {
  workers = []
  proxies.length = 0
  crypto.__cryptoRestartInternals.forgetWorkerForTests()
  ;(globalThis as { Worker: unknown }).Worker = FakeWorker
})
afterEach(() => {
  crypto.__cryptoRestartInternals.forgetWorkerForTests()
  ;(globalThis as { Worker: unknown }).Worker = realWorker
})

describe('the worker is recycled only when nothing lives in it', () => {
  test('a decryptor created between the first check and the lock keeps the worker alive', async () => {
    // 1st count (before the lock): 0. 2nd count (under the lock, after the
    // drain): 1, the download that slipped in.
    script = { decryptorCounts: [0, 1] }
    await crypto.initCrypto()
    await crypto.__cryptoRestartInternals.checkMemoryNow()
    expect(proxies[0].decryptorCalls).toBe(2)
    expect(workers).toHaveLength(1)
    expect(workers[0].terminated).toBe(false)
    expect(crypto.__cryptoRestartInternals.isRestarting()).toBe(false)
  })

  test('with nothing live before or under the lock, the worker over the cap is recycled', async () => {
    script = { decryptorCounts: [0, 0] }
    await crypto.initCrypto()
    await crypto.__cryptoRestartInternals.checkMemoryNow()
    expect(workers).toHaveLength(2)
    expect(workers[0].terminated).toBe(true)
    expect(workers[1].terminated).toBe(false)
  })

  test('a random-access reader live at the first check blocks the recycle', async () => {
    script = { decryptorCounts: [0], readerCounts: [1] }
    await crypto.initCrypto()
    await crypto.__cryptoRestartInternals.checkMemoryNow()
    expect(proxies[0].readerCalls).toBe(1)
    expect(workers).toHaveLength(1)
    expect(workers[0].terminated).toBe(false)
  })

  test('a decryptor live at the first check blocks the recycle without taking the lock', async () => {
    script = { decryptorCounts: [1] }
    await crypto.initCrypto()
    await crypto.__cryptoRestartInternals.checkMemoryNow()
    expect(proxies[0].decryptorCalls).toBe(1)
    expect(workers).toHaveLength(1)
    expect(workers[0].terminated).toBe(false)
  })
})
