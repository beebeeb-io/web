import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

// Task 1590 — self-test for mockModuleScoped(), half 1 of 2. This file mocks
// fixtures/1590-scoped-target; its partner 1590-scoped-mock-a-victim imports
// the same module and must ALWAYS see the real one. The names are chosen so
// the guard's reversed run (reverse lexical: b before a) puts this mocker
// first — if the helper ever stops restoring the real module after the file,
// the victim goes red deterministically there (mutation-proven in the task).

const real = await mockModuleScoped('./fixtures/1590-scoped-target', import.meta.dir, {
  who: () => 'mocked',
})
const target = await import('./fixtures/1590-scoped-target')

describe('mockModuleScoped() — inside the mocking file', () => {
  test('the override is live', () => {
    expect(target.who()).toBe('mocked')
  })
  test('every other export is still the real one (the mock is complete)', () => {
    expect(target.untouched()).toBe('real-untouched')
  })
  test('the returned snapshot is the real module, untouched by the mock', () => {
    expect((real.who as () => string)()).toBe('real')
  })
  test('overriding a name the real module does not export throws', async () => {
    await expect(
      mockModuleScoped('./fixtures/1590-scoped-target', import.meta.dir, { notExported: () => 1 }),
    ).rejects.toThrow(/'notExported' is not exported by the real module/)
  })
})
