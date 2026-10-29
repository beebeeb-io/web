import { describe, test, expect } from 'bun:test'
import { parseClipboardStats, formatCalcCurrency, formatCalcNumber } from '../src/lib/office/calc-selection-stats'

describe('parseClipboardStats', () => {
  test('empty/blank clipboard text yields no stats', () => {
    expect(parseClipboardStats('')).toBeNull()
    expect(parseClipboardStats('   \n  \t ')).toBeNull()
  })

  test('a single plain number', () => {
    expect(parseClipboardStats('42')).toEqual({ sum: 42, average: 42, count: 1, hadCurrency: false })
  })

  test('a column of plain numbers (real 3-cell copy shape: "10\\n20\\n30\\n")', () => {
    expect(parseClipboardStats('10\n20\n30\n')).toEqual({ sum: 60, average: 20, count: 3, hadCurrency: false })
  })

  test('a row of numbers, tab-separated', () => {
    expect(parseClipboardStats('10\t20\t30')).toEqual({ sum: 60, average: 20, count: 3, hadCurrency: false })
  })

  test('the design mockup\'s own budget selection: C2:C5 = 21400, 11200, 9500, 3100', () => {
    const stats = parseClipboardStats('€21,400\n€11,200\n€9,500\n€3,100\n')
    expect(stats).not.toBeNull()
    expect(stats!.count).toBe(4)
    expect(stats!.sum).toBe(45200)
    expect(stats!.average).toBe(11300)
    expect(stats!.hadCurrency).toBe(true)
  })

  test('non-numeric labels are excluded, not treated as zero', () => {
    const stats = parseClipboardStats('Category\tBudget\nEngineering\t20000\nMarketing\t12000')
    expect(stats).toEqual({ sum: 32000, average: 16000, count: 2, hadCurrency: false })
  })

  test('a selection with no numeric cells at all returns null, not Sum 0', () => {
    expect(parseClipboardStats('Category\nEngineering\nMarketing')).toBeNull()
  })

  test('parenthesised negatives (accounting notation)', () => {
    expect(parseClipboardStats('(100)\n50')).toEqual({ sum: -50, average: -25, count: 2, hadCurrency: false })
  })

  test('a plain minus sign and the mockup\'s U+2212 minus glyph both negate', () => {
    expect(parseClipboardStats('-800')).toEqual({ sum: -800, average: -800, count: 1, hadCurrency: false })
    expect(parseClipboardStats('−€800')).toEqual({ sum: -800, average: -800, count: 1, hadCurrency: true })
  })

  test('a trailing percent sign divides by 100', () => {
    expect(parseClipboardStats('50%')).toEqual({ sum: 0.5, average: 0.5, count: 1, hadCurrency: false })
  })

  test('mixed currency and plain cells still flags hadCurrency true', () => {
    const stats = parseClipboardStats('€10\n20')
    expect(stats!.hadCurrency).toBe(true)
    expect(stats!.count).toBe(2)
  })
})

describe('formatCalcCurrency', () => {
  test('formats a whole euro amount with thousands separators', () => {
    expect(formatCalcCurrency(45200)).toBe('€45,200')
  })

  test('rounds fractional amounts', () => {
    expect(formatCalcCurrency(11300.4)).toBe('€11,300')
  })

  test('negative amounts keep the sign before the symbol', () => {
    expect(formatCalcCurrency(-800)).toBe('-€800')
  })
})

describe('formatCalcNumber', () => {
  test('formats with thousands separators and no currency symbol', () => {
    expect(formatCalcNumber(1234.5)).toBe('1,234.5')
  })
})
