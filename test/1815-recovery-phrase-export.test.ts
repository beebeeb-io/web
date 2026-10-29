import { describe, expect, test } from 'bun:test'
import {
  CLIPBOARD_CLEAR_MS,
  PHRASE_FILENAME,
  copyPhraseWithAutoClear,
  phraseToText,
} from '../src/lib/recovery-phrase-export'

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']

describe('1815 recovery phrase export', () => {
  test('txt is exactly 12 numbered lines matching the words', () => {
    const lines = phraseToText(WORDS).split('\n')
    expect(lines).toHaveLength(12)
    lines.forEach((l, i) => expect(l).toBe(`${String(i + 1).padStart(2, '0')}  ${WORDS[i]}`))
    expect(PHRASE_FILENAME).toBe('beebeeb-recovery-phrase.txt')
  })

  test('copy writes the phrase, then clears the clipboard after 60 s (fake clock)', async () => {
    const writes: string[] = []
    const clipboard = { writeText: async (t: string) => { writes.push(t) } }
    const pending: Array<{ fn: () => void; ms: number }> = []
    await copyPhraseWithAutoClear(WORDS.join(' '), clipboard, (fn, ms) => { pending.push({ fn, ms }) })
    expect(writes).toEqual([WORDS.join(' ')])
    expect(pending).toHaveLength(1)
    expect(pending[0].ms).toBe(60_000)
    expect(CLIPBOARD_CLEAR_MS).toBe(60_000)
    pending[0].fn()
    await Promise.resolve()
    expect(writes).toEqual([WORDS.join(' '), ''])
  })

  test('a failing clear does not throw', async () => {
    let n = 0
    const clipboard = { writeText: async () => { if (++n > 1) throw new Error('denied') } }
    const pending: Array<() => void> = []
    await copyPhraseWithAutoClear('x', clipboard, (fn) => { pending.push(fn) })
    expect(() => pending[0]()).not.toThrow()
  })
})
