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

const { loadFeatureFlagsOnce, resetFeatureFlagCacheForTests } = await import(
  '../src/lib/use-feature-flag'
)

describe('feature flags (2237b)', () => {
  beforeEach(() => {
    evaluateCalls = 0
    evaluateImpl = async () => ({ flags: {} })
    resetFeatureFlagCacheForTests()
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
})
