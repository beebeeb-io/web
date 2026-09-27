import { describe, expect, test } from 'bun:test'
import { untouched, who } from './fixtures/1590-scoped-target'

// Task 1590 — self-test for mockModuleScoped(), half 2 of 2. This file never
// mocks anything; it must see the REAL module whatever ran before it —
// including 1590-scoped-mock-b-mocker, which mocks `who`. See that file.

describe('mockModuleScoped() — a later file that did not ask for a mock', () => {
  test('sees the real module, never another file\'s override', () => {
    expect(who()).toBe('real')
    expect(untouched()).toBe('real-untouched')
  })
})
