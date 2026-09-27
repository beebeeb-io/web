import { describe, test, expect } from 'bun:test'
import {
  parseSlideStatus,
  slideIndices,
  clampSlideIndex,
  canMoveUp,
  canMoveDown,
  canDelete,
  planNavigation,
  IMPRESS_HOME_COMMANDS,
  IMPRESS_SLIDE_COMMANDS,
  IMPRESS_LAYOUTS,
  layoutDispatchArgs,
} from '../src/lib/office/impress-commands'

describe('parseSlideStatus', () => {
  test('parses a well-formed status string', () => {
    expect(parseSlideStatus('Slide 3 of 5')).toEqual({ index: 3, count: 5 })
  })
  test('parses the single-slide case', () => {
    expect(parseSlideStatus('Slide 1 of 1')).toEqual({ index: 1, count: 1 })
  })
  test('returns null for a non-string state', () => {
    expect(parseSlideStatus(undefined)).toBeNull()
    expect(parseSlideStatus(42)).toBeNull()
    expect(parseSlideStatus(true)).toBeNull()
  })
  test('returns null for unrecognised text', () => {
    expect(parseSlideStatus('Page 3 of 5')).toBeNull()
    expect(parseSlideStatus('Slide 3')).toBeNull()
    expect(parseSlideStatus('')).toBeNull()
  })
  test('returns null when index exceeds count (malformed/impossible)', () => {
    expect(parseSlideStatus('Slide 9 of 5')).toBeNull()
  })
  test('returns null for a zero index or count', () => {
    expect(parseSlideStatus('Slide 0 of 5')).toBeNull()
  })
})

describe('slideIndices', () => {
  test('empty for a zero or negative count', () => {
    expect(slideIndices(0)).toEqual([])
    expect(slideIndices(-1)).toEqual([])
  })
  test('produces 1..N in order', () => {
    expect(slideIndices(5)).toEqual([1, 2, 3, 4, 5])
  })
  test('a single slide', () => {
    expect(slideIndices(1)).toEqual([1])
  })
})

describe('clampSlideIndex', () => {
  test('clamps below range up to 1', () => {
    expect(clampSlideIndex(0, 5)).toBe(1)
    expect(clampSlideIndex(-3, 5)).toBe(1)
  })
  test('clamps above range down to count', () => {
    expect(clampSlideIndex(9, 5)).toBe(5)
  })
  test('leaves an in-range index untouched', () => {
    expect(clampSlideIndex(3, 5)).toBe(3)
  })
  test('returns 0 for an empty document', () => {
    expect(clampSlideIndex(3, 0)).toBe(0)
  })
})

describe('canMoveUp / canMoveDown / canDelete', () => {
  test('cannot move up from the first slide', () => {
    expect(canMoveUp(1)).toBe(false)
    expect(canMoveUp(2)).toBe(true)
  })
  test('cannot move down from the last slide', () => {
    expect(canMoveDown(5, 5)).toBe(false)
    expect(canMoveDown(4, 5)).toBe(true)
    expect(canMoveDown(0, 5)).toBe(false)
  })
  test('cannot delete the only remaining slide', () => {
    expect(canDelete(1)).toBe(false)
    expect(canDelete(2)).toBe(true)
  })
})

describe('planNavigation', () => {
  test('no-op when already on the target slide', () => {
    expect(planNavigation(3, 3)).toEqual([])
  })
  test('steps forward with NextPage', () => {
    expect(planNavigation(1, 4)).toEqual(['.uno:NextPage', '.uno:NextPage', '.uno:NextPage'])
  })
  test('steps backward with PreviousPage', () => {
    expect(planNavigation(5, 2)).toEqual(['.uno:PreviousPage', '.uno:PreviousPage', '.uno:PreviousPage'])
  })
  test('single step in either direction', () => {
    expect(planNavigation(2, 3)).toEqual(['.uno:NextPage'])
    expect(planNavigation(3, 2)).toEqual(['.uno:PreviousPage'])
  })
  test('empty for invalid (<1) indices', () => {
    expect(planNavigation(0, 3)).toEqual([])
    expect(planNavigation(3, 0)).toEqual([])
  })
})

describe('command tables', () => {
  test('every IMPRESS_HOME_COMMANDS id is unique', () => {
    const ids = IMPRESS_HOME_COMMANDS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  test('every slide command has a distinct .uno: command string', () => {
    const commands = Object.values(IMPRESS_SLIDE_COMMANDS).map((d) => d.command)
    expect(new Set(commands).size).toBe(commands.length)
  })
  test('every layout has a unique id and a unique WhatLayout ordinal', () => {
    const ids = IMPRESS_LAYOUTS.map((l) => l.id)
    const ordinals = IMPRESS_LAYOUTS.map((l) => l.whatLayout)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ordinals).size).toBe(ordinals.length)
  })
  test('layoutDispatchArgs carries the WhatLayout value through', () => {
    expect(layoutDispatchArgs({ id: 'x', label: 'X', whatLayout: 7 })).toEqual([{ name: 'WhatLayout', value: 7 }])
  })
})
