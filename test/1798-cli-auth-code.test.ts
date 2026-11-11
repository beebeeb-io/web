import { describe, expect, test } from 'bun:test'
import { formatCodeInput, normalizeTypedCode } from '../src/lib/cli-auth-code'

describe('1798 formatCodeInput', () => {
  test('a pasted label keeps the code, not the label letters', () => {
    expect(formatCodeInput('Code: ABCD-EFGH')).toBe('ABCD-EFGH')
    expect(normalizeTypedCode('Code: ABCD-EFGH')).toBe('ABCD-EFGH')
  })

  test('a code inside a sentence is extracted', () => {
    expect(formatCodeInput('Your code is abcd-efgh, enter it now')).toBe('ABCD-EFGH')
  })

  test('spaced and unspaced complete codes format', () => {
    expect(formatCodeInput('abcd efgh')).toBe('ABCD-EFGH')
    expect(formatCodeInput('abcdefgh')).toBe('ABCD-EFGH')
  })

  test('partial typing keeps strip-and-slice', () => {
    expect(formatCodeInput('abc')).toBe('ABC')
    expect(formatCodeInput('ABCD-E')).toBe('ABCD-E')
    expect(formatCodeInput('')).toBe('')
  })

  test('overlong input is cut to eight characters', () => {
    expect(formatCodeInput('abcdefghijk')).toBe('ABCD-EFGH')
  })
})
