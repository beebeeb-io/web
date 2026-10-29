import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

type Evaluate = () => Promise<{ flags: Record<string, boolean> }>
let evaluateCalls = 0
let evaluateImpl: Evaluate = async () => ({ flags: {} })

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getEvaluateFlags: () => {
    evaluateCalls++
    return evaluateImpl()
  },
})

const {
  loadFeatureFlagsOnce,
  resetFeatureFlagCacheForTests,
  sharedFoldersEnabled,
  sharedFoldersEnabledForWrite,
  FeatureFlagsUnavailableError,
  setFlagRequestTimeoutForTests,
  FLAG_REQUEST_TIMEOUT_MS,
} = await import('../src/lib/use-feature-flag')

describe('feature flags (2237b)', () => {
  beforeEach(() => {
    evaluateCalls = 0
    evaluateImpl = async () => ({ flags: {} })
    resetFeatureFlagCacheForTests()
    setFlagRequestTimeoutForTests(FLAG_REQUEST_TIMEOUT_MS)
  })

  test('reads the flag from the evaluate response', async () => {
    evaluateImpl = async () => ({ flags: { shared_folders_v1: true } })
    expect(await loadFeatureFlagsOnce()).toEqual({ shared_folders_v1: true })
    expect(evaluateCalls).toBe(1)
  })

  test('a missing flag is false', async () => {
    expect((await loadFeatureFlagsOnce()).shared_folders_v1).toBeUndefined()
    expect(evaluateCalls).toBe(1)
  })

  test('a rejected request resolves to no flags and does not throw', async () => {
    evaluateImpl = async () => {
      throw new Error('offline')
    }
    const flags = await loadFeatureFlagsOnce()
    expect(flags).toEqual({})
    expect(evaluateCalls).toBe(1)
  })

  test('two consumers share exactly one evaluate request', async () => {
    const [a, b] = await Promise.all([loadFeatureFlagsOnce(), loadFeatureFlagsOnce()])
    expect(a).toBe(b)
    expect(evaluateCalls).toBe(1)
    await loadFeatureFlagsOnce()
    expect(evaluateCalls).toBe(1)
  })

  // rv-web198d N2: a failed read is not an answer. Cached as "off" for the
  // page session, it turned a flag-on account's publishes into silent no-ops.
  test('a failed request is not cached: the next read asks again and sees the flag', async () => {
    evaluateImpl = async () => {
      throw new Error('offline')
    }
    expect(await sharedFoldersEnabled()).toBe(false)
    evaluateImpl = async () => ({ flags: { shared_folders_v1: true } })
    expect(await sharedFoldersEnabled()).toBe(true)
    expect(evaluateCalls).toBe(2)
    // A real answer is cached as before.
    expect(await sharedFoldersEnabled()).toBe(true)
    expect(evaluateCalls).toBe(2)
  })

  test('a malformed body is a failed request too: fail closed, not cached', async () => {
    evaluateImpl = async () => ({ flags: null }) as never
    expect(await sharedFoldersEnabled()).toBe(false)
    evaluateImpl = async () => ({ flags: { shared_folders_v1: true } })
    expect(await sharedFoldersEnabled()).toBe(true)
    expect(evaluateCalls).toBe(2)
  })

  // rv-web198d P3: a folder invite waits on this read; it must end.
  test('a request that never answers ends after the bound, fails closed, and is not cached', async () => {
    setFlagRequestTimeoutForTests(30)
    evaluateImpl = () => new Promise(() => {})
    const outcome = await Promise.race([
      sharedFoldersEnabled(),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 1_000)),
    ])
    expect(outcome).toBe(false)
    evaluateImpl = async () => ({ flags: { shared_folders_v1: true } })
    expect(await sharedFoldersEnabled()).toBe(true)
    expect(evaluateCalls).toBe(2)
  })

  test('the production bound is a few seconds, not unbounded', () => {
    expect(FLAG_REQUEST_TIMEOUT_MS).toBeGreaterThan(0)
    expect(FLAG_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(10_000)
  })

  // rv-web198e P3: on a WRITE a failed flag read aborts; it is never "off".
  // Two failed reads used to turn a flag-on custody-folder invite into a
  // legacy invite.
  test('for a write, a failed read throws FeatureFlagsUnavailableError instead of answering off', async () => {
    evaluateImpl = async () => {
      throw new Error('offline')
    }
    await expect(sharedFoldersEnabledForWrite()).rejects.toBeInstanceOf(FeatureFlagsUnavailableError)
    // Reads still fail closed.
    expect(await sharedFoldersEnabled()).toBe(false)
    evaluateImpl = async () => ({ flags: { shared_folders_v1: true } })
    expect(await sharedFoldersEnabledForWrite()).toBe(true)
  })

  test('for a write, a malformed body and a read that never answers both throw', async () => {
    evaluateImpl = async () => ({ flags: null }) as never
    await expect(sharedFoldersEnabledForWrite()).rejects.toBeInstanceOf(FeatureFlagsUnavailableError)
    setFlagRequestTimeoutForTests(30)
    evaluateImpl = () => new Promise(() => {})
    await expect(sharedFoldersEnabledForWrite()).rejects.toBeInstanceOf(FeatureFlagsUnavailableError)
  })

  test('for a write, a real "off" answer is off, and one answer serves reads and writes', async () => {
    evaluateImpl = async () => ({ flags: { shared_folders_v1: false } })
    expect(await sharedFoldersEnabledForWrite()).toBe(false)
    expect(await sharedFoldersEnabled()).toBe(false)
    expect(evaluateCalls).toBe(1)
  })

  test("the write error's copy fits the short-message limit and says nothing changed", () => {
    const message = new FeatureFlagsUnavailableError().message
    expect(message.length).toBeLessThanOrEqual(80)
    expect(message).toMatch(/nothing changed/i)
  })
})
