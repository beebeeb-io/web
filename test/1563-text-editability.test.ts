import { describe, expect, test } from 'bun:test'
import {
  checkEditability,
  isValidUtf8,
  looksBinary,
  MAX_EDITABLE_BYTES,
  editabilityNotice,
} from '../src/lib/text-editability'

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe('looksBinary', () => {
  test('a NUL byte anywhere in the sample is binary', () => {
    expect(looksBinary(new Uint8Array([104, 105, 0, 33]))).toBe(true)
  })

  test('plain ASCII/UTF-8 text is not binary', () => {
    expect(looksBinary(utf8('Lisbon offsite\n\nThree days in Alfama.'))).toBe(false)
  })

  test('tabs, LF and CR do not count as control bytes', () => {
    expect(looksBinary(utf8('col1\tcol2\r\nrow2a\trow2b\r\n'))).toBe(false)
  })

  test('a dense run of control bytes (no NUL) is binary', () => {
    const bytes = new Uint8Array(64).fill(0x01) // SOH, well under 0x20, no NUL
    expect(looksBinary(bytes)).toBe(true)
  })

  test('empty input is not binary', () => {
    expect(looksBinary(new Uint8Array(0))).toBe(false)
  })
})

describe('isValidUtf8', () => {
  test('accepts round-tripped UTF-8, including multi-byte characters', () => {
    expect(isValidUtf8(utf8('Alfama · café · 日本語'))).toBe(true)
  })

  test('rejects a truncated multi-byte sequence', () => {
    // 0xE2 0x82 is the start of a 3-byte sequence (€ is E2 82 AC) with the
    // final byte missing.
    expect(isValidUtf8(new Uint8Array([0x68, 0x69, 0xe2, 0x82]))).toBe(false)
  })

  test('rejects a lone continuation byte', () => {
    expect(isValidUtf8(new Uint8Array([0x68, 0x69, 0x80]))).toBe(false)
  })

  test('rejects an overlong encoding of ASCII "/"', () => {
    // 0xC0 0xAF is an overlong 2-byte encoding of 0x2F ("/") — a classic
    // path-traversal-bypass vector that fatal-mode decoding must reject.
    expect(isValidUtf8(new Uint8Array([0xc0, 0xaf]))).toBe(false)
  })
})

describe('checkEditability', () => {
  test('ok for small valid UTF-8 text', () => {
    expect(checkEditability(utf8('# Lisbon offsite\n\nThree days in Alfama.'))).toEqual({
      editable: true,
      reason: 'ok',
    })
  })

  test('too-large takes priority even for otherwise-valid text', () => {
    const big = new Uint8Array(MAX_EDITABLE_BYTES + 1).fill(0x61) // all 'a'
    expect(checkEditability(big)).toEqual({ editable: false, reason: 'too-large' })
  })

  test('exactly at the limit is still editable', () => {
    const atLimit = new Uint8Array(MAX_EDITABLE_BYTES).fill(0x61)
    expect(checkEditability(atLimit)).toEqual({ editable: true, reason: 'ok' })
  })

  test('binary content under the size limit is rejected as binary', () => {
    const bin = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])
    expect(checkEditability(bin)).toEqual({ editable: false, reason: 'binary' })
  })

  test('invalid UTF-8 that does not look binary is rejected as invalid-utf8', () => {
    // A single stray continuation byte among otherwise-printable ASCII:
    // passes the binary density sniff, fails strict UTF-8 decoding.
    const bytes = new Uint8Array([...utf8('hello world '), 0x80])
    const result = checkEditability(bytes)
    expect(result.editable).toBe(false)
    expect(result.reason).toBe('invalid-utf8')
  })
})

describe('editabilityNotice', () => {
  test('each non-ok reason has non-empty title and body copy', () => {
    for (const reason of ['too-large', 'binary', 'invalid-utf8'] as const) {
      const notice = editabilityNotice(reason)
      expect(notice.title.length).toBeGreaterThan(0)
      expect(notice.body.length).toBeGreaterThan(0)
    }
  })

  test('ok has no notice copy', () => {
    expect(editabilityNotice('ok')).toEqual({ title: '', body: '' })
  })
})
