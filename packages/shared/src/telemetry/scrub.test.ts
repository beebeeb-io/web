import { describe, expect, it } from 'bun:test'
import { scrubText, scrubFrames } from './scrub'
import { SCRUB_VECTORS } from './scrub.fixture'

describe('scrubText', () => {
  for (const v of SCRUB_VECTORS) {
    it(`scrubs: ${v.name}`, () => {
      const out = scrubText(v.input)
      for (const forbidden of v.mustNotContain) expect(out).not.toContain(forbidden)
      for (const expected of v.mustContain) expect(out).toContain(expected)
    })
  }

  it('is total — never throws on hostile input', () => {
    expect(() => scrubText('\0'.repeat(1000))).not.toThrow()
    expect(scrubText('')).toBe('')
  })

  it('bounds output length', () => {
    expect(scrubText('a'.repeat(5000)).length).toBeLessThanOrEqual(201)
  })
})

describe('scrubFrames', () => {
  it('keeps only basename, function, lineno, colno', () => {
    const stack = [
      'TypeError: nope',
      '    at uploadEncryptedFileNative (/Users/guuslangelaar/Development/Beebeeb/repos/web/src/lib/api.ts:1346:12)',
      '    at async handleUpload (https://app.beebeeb.io/assets/index-a1b2.js:99:3)',
    ].join('\n')
    const frames = scrubFrames(stack)
    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual({ filename: 'api.ts', function: 'uploadEncryptedFileNative', lineno: 1346, colno: 12 })
    expect(frames[1].filename).toBe('index-a1b2.js')
    expect(JSON.stringify(frames)).not.toContain('guuslangelaar')
  })

  it('returns [] for a missing stack', () => {
    expect(scrubFrames(undefined)).toEqual([])
  })
})
