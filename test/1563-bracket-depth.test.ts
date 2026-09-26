import { describe, expect, test } from 'bun:test'
import { computeBracketDepths, MAX_BRACKET_SCAN_LENGTH } from '../src/lib/bracket-depth'

describe('computeBracketDepths', () => {
  test('empty text has no marks', () => {
    expect(computeBracketDepths('')).toEqual([])
  })

  test('no brackets at all has no marks', () => {
    expect(computeBracketDepths('plain text, no brackets here')).toEqual([])
  })

  test('a single flat pair both get depth 0', () => {
    const marks = computeBracketDepths('(a)')
    expect(marks).toEqual([
      { index: 0, char: '(', depth: 0 },
      { index: 2, char: ')', depth: 0 },
    ])
  })

  test('a nested pair increases depth, and the outer/inner pairs each share one depth', () => {
    const marks = computeBracketDepths('(a(b)c)')
    expect(marks).toEqual([
      { index: 0, char: '(', depth: 0 },
      { index: 2, char: '(', depth: 1 },
      { index: 4, char: ')', depth: 1 },
      { index: 6, char: ')', depth: 0 },
    ])
  })

  test('mixed bracket types nest independently, matched by type', () => {
    const marks = computeBracketDepths('{[(x)]}')
    expect(marks.map((m) => m.char)).toEqual(['{', '[', '(', ')', ']', '}'])
    expect(marks.map((m) => m.depth)).toEqual([0, 1, 2, 2, 1, 0])
  })

  test('sibling pairs at the same level both get depth 0', () => {
    const marks = computeBracketDepths('(a)(b)')
    expect(marks.map((m) => m.depth)).toEqual([0, 0, 0, 0])
  })

  test('a mismatched closing bracket type is left unmatched — no mark, no depth change', () => {
    // '(' opens depth 0; ']' doesn't close it (wrong type) so it's dropped;
    // ')' still correctly closes the '(' at depth 0.
    const marks = computeBracketDepths('(a]b)')
    expect(marks).toEqual([
      { index: 0, char: '(', depth: 0 },
      { index: 4, char: ')', depth: 0 },
    ])
  })

  test('an unmatched trailing opener gets a mark but is never closed', () => {
    const marks = computeBracketDepths('(a')
    expect(marks).toEqual([{ index: 0, char: '(', depth: 0 }])
  })

  test('an unmatched leading closer produces no mark at all', () => {
    const marks = computeBracketDepths(')a')
    expect(marks).toEqual([])
  })

  test('bails out (empty array) above MAX_BRACKET_SCAN_LENGTH', () => {
    const huge = '('.repeat(MAX_BRACKET_SCAN_LENGTH + 1)
    expect(computeBracketDepths(huge)).toEqual([])
  })

  test('does not bail out AT exactly MAX_BRACKET_SCAN_LENGTH', () => {
    const atLimit = 'a'.repeat(MAX_BRACKET_SCAN_LENGTH - 2) + '()'
    const marks = computeBracketDepths(atLimit)
    expect(marks).toHaveLength(2)
  })
})
