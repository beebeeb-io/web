import { describe, expect, test } from 'bun:test'
import { diffLines, hasChanges, toSideBySideRows, MAX_DIFF_LINES } from '../src/lib/line-diff'

describe('diffLines', () => {
  test('identical text is all "same"', () => {
    const diff = diffLines('a\nb\nc', 'a\nb\nc')
    expect(diff).not.toBeNull()
    expect(diff!.every((l) => l.type === 'same')).toBe(true)
  })

  test('a single changed line shows as one del + one add', () => {
    const diff = diffLines('a\nb\nc', 'a\nB\nc')!
    expect(diff.map((l) => l.type)).toEqual(['same', 'del', 'add', 'same'])
    expect(diff[1].text).toBe('b')
    expect(diff[2].text).toBe('B')
  })

  test('an appended line shows as a trailing add', () => {
    const diff = diffLines('a\nb', 'a\nb\nc')!
    expect(diff.map((l) => l.type)).toEqual(['same', 'same', 'add'])
    expect(diff[2].text).toBe('c')
  })

  test('returns null when either side exceeds MAX_DIFF_LINES', () => {
    const huge = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `line ${i}`).join('\n')
    expect(diffLines(huge, 'a')).toBeNull()
    expect(diffLines('a', huge)).toBeNull()
  })
})

describe('hasChanges', () => {
  test('false when every line is same', () => {
    expect(hasChanges(diffLines('a\nb', 'a\nb')!)).toBe(false)
  })

  test('true when there is at least one add/del', () => {
    expect(hasChanges(diffLines('a\nb', 'a\nc')!)).toBe(true)
  })
})

describe('toSideBySideRows', () => {
  test('a "same" line becomes one row with matching content + line numbers on both sides', () => {
    const rows = toSideBySideRows(diffLines('unchanged', 'unchanged')!)
    expect(rows).toEqual([
      { left: { type: 'same', text: 'unchanged', lineNo: 1 }, right: { type: 'same', text: 'unchanged', lineNo: 1 } },
    ])
  })

  test('a changed line aligns as one del row (left) + one add row (right) — split, not unified', () => {
    // diffLines(a, b): 'a' is the LEFT/latest-saved side, 'b' is the
    // RIGHT/local-edit side — matches ConflictDialog's diffLines(latestText, localText).
    const rows = toSideBySideRows(diffLines('old line', 'new line')!)
    expect(rows).toEqual([
      { left: { type: 'del', text: 'old line', lineNo: 1 }, right: { type: 'empty', text: '' } },
      { left: { type: 'empty', text: '' }, right: { type: 'add', text: 'new line', lineNo: 1 } },
    ])
  })

  test('line numbers on each side count ONLY that side\'s real lines, independently', () => {
    // left: "a" (1), "b"-deleted (2) | right: "a" (1), "c"-added (2)
    const rows = toSideBySideRows(diffLines('a\nb', 'a\nc')!)
    expect(rows).toEqual([
      { left: { type: 'same', text: 'a', lineNo: 1 }, right: { type: 'same', text: 'a', lineNo: 1 } },
      { left: { type: 'del', text: 'b', lineNo: 2 }, right: { type: 'empty', text: '' } },
      { left: { type: 'empty', text: '' }, right: { type: 'add', text: 'c', lineNo: 2 } },
    ])
  })

  test('empty diff (identical multi-line text) produces only same-rows, row count == line count', () => {
    const rows = toSideBySideRows(diffLines('x\ny\nz', 'x\ny\nz')!)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.left.type === 'same' && r.right.type === 'same')).toBe(true)
  })
})
