import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mockModuleScoped } from './helpers/scoped-module-mock'

// po-16: sign-up adopts the offline Pass vault's master key. No React rendering in this harness
// (no jsdom), so the step's logic lives in pure helpers and the unmount rule is checked on the source.

const calls: { handle: number; op: string; args: unknown[] }[] = []
let reply: { ok: true; value: null } | { ok: false; code: string; message: string } = { ok: true, value: null }

await mockModuleScoped('../src/lib/crypto/service', import.meta.dir, {
  withProxy: async (fn: (p: unknown) => unknown) =>
    fn({
      ceremonyCall: async (handle: number, op: string, args: unknown[]) => {
        calls.push({ handle, op, args })
        return reply
      },
    }),
})

const { CeremonyProxy, CeremonyError } = await import('../src/lib/crypto/ceremony')
const { adoptPhraseMessage, adoptTypedPhrase, spreadPastedPhrase } = await import(
  '../src/components/onboarding/signup-flow'
)

const NOT_VALID = 'That is not a valid master key. Check the 12 words and their order.'

describe('adoptPhrase routes to the worker', () => {
  test('CeremonyProxy.adoptPhrase sends the phrase as an adoptPhrase ceremony call', async () => {
    calls.length = 0
    reply = { ok: true, value: null }
    await new CeremonyProxy(7).adoptPhrase('a b c')
    expect(calls).toEqual([{ handle: 7, op: 'adoptPhrase', args: ['a b c'] }])
  })

  test('the worker handles the message type', () => {
    const src = readFileSync(new URL('../src/workers/crypto.worker.ts', import.meta.url), 'utf8')
    expect(src).toContain("adoptPhrase: { args: [phrase: string]; result: null }")
    expect(src).toContain("case 'adoptPhrase': c.adoptPhrase(a[0] as string); return null")
  })
})

describe('error code to message', () => {
  test('core crypto code maps to the invalid-phrase line', () => {
    expect(adoptPhraseMessage('crypto')).toBe(NOT_VALID)
  })

  test('a rejected adopt returns the message; success returns null', async () => {
    const words = Array.from({ length: 12 }, (_, i) => `w${i}`)
    reply = { ok: false, code: 'crypto', message: 'bad' }
    expect(await adoptTypedPhrase(new CeremonyProxy(1), words)).toBe(NOT_VALID)
    reply = { ok: false, code: 'invalid_state', message: 'x' }
    expect(await adoptTypedPhrase(new CeremonyProxy(1), words)).not.toBe(NOT_VALID)
    reply = { ok: true, value: null }
    calls.length = 0
    expect(await adoptTypedPhrase(new CeremonyProxy(1), words.map((w) => ` ${w.toUpperCase()} `))).toBeNull()
    expect(calls[0].args[0]).toBe(words.join(' '))
    expect(CeremonyError).toBeDefined()
  })
})

describe('paste spreads over the fields', () => {
  test('12 pasted words fill 12 fields, lowercased', () => {
    const out = spreadPastedPhrase('  One TWO three four five six seven eight nine ten eleven twelve\n', 12)
    expect(out).toEqual('one two three four five six seven eight nine ten eleven twelve'.split(' '))
  })
  test('a single word is a normal keystroke, not a paste', () => {
    expect(spreadPastedPhrase('abandon', 12)).toBeNull()
  })
})

describe('words are cleared when the step is left', () => {
  test('the unmount cleanup empties both the shown and the typed words', () => {
    const src = readFileSync(new URL('../src/components/onboarding/signup-flow.tsx', import.meta.url), 'utf8')
    const step = src.slice(src.indexOf('function SaveRecoveryPhraseStep('))
    expect(step).toMatch(/return \(\) => \{\s*setWords\(\[\]\)\s*setAdoptWords\(\[\]\)\s*\}/)
  })
})
