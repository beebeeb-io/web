import { describe, test, expect } from 'bun:test'
import { officeLoadPercent, officeLoadByteLabel } from '../src/lib/office/progress-format'

describe('officeLoadPercent', () => {
  test('computes a rounded percentage', () => {
    expect(officeLoadPercent(50, 200)).toBe(25)
    expect(officeLoadPercent(1, 3)).toBe(33)
  })

  test('clamps to 100 even if loaded somehow exceeds total', () => {
    expect(officeLoadPercent(500, 200)).toBe(100)
  })

  test('never negative', () => {
    expect(officeLoadPercent(-10, 200)).toBe(0)
  })

  test('a zero or negative total returns 0 instead of NaN/Infinity', () => {
    expect(officeLoadPercent(50, 0)).toBe(0)
    expect(officeLoadPercent(50, -1)).toBe(0)
  })

  test('non-finite input returns 0 instead of propagating NaN into the UI', () => {
    expect(officeLoadPercent(NaN, 200)).toBe(0)
    expect(officeLoadPercent(50, NaN)).toBe(0)
    expect(officeLoadPercent(Infinity, 200)).toBe(0)
  })
})

describe('officeLoadByteLabel', () => {
  test('formats a human MB/MB label', () => {
    expect(officeLoadByteLabel(1 * 1024 * 1024, 257 * 1024 * 1024)).toBe('1.0 MB / 257 MB')
  })

  test('sub-10MB values keep one decimal, larger values round to whole MB', () => {
    expect(officeLoadByteLabel(5.4 * 1024 * 1024, 12 * 1024 * 1024)).toBe('5.4 MB / 12 MB')
  })

  test('returns null when the total is unknown (0 or negative) — caller must not show a bogus label', () => {
    expect(officeLoadByteLabel(1000, 0)).toBeNull()
    expect(officeLoadByteLabel(1000, -1)).toBeNull()
  })
})
