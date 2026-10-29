import { describe, expect, test } from 'bun:test'
import { runBreachCheck } from '../src/lib/onboarding/breach-step'
import { CeremonyError } from '../src/lib/crypto'

/** Task 1795: the prefix is read once; the URL and the record use the same value. */
describe('runBreachCheck', () => {
  test('fetch and evaluate receive the identical prefix, read once', async () => {
    let reads = 0
    const seen: string[] = []
    const breach = {
      get prefix() { reads++; return 'ABCDE' },
      evaluate: async (p: string, body: string | null, failOpen: boolean) => {
        seen.push(`eval:${p}:${body}:${failOpen}`)
        return { kind: 'clean', count: 0, allows_proceeding: true, check_failed: false } as any
      },
    }
    await runBreachCheck(
      { fetchBreachBody: async (_e, p) => { seen.push(`fetch:${p}`); return 'X' } },
      breach as any,
      { endpoint: '/e/{prefix}', failOpen: true },
    )
    expect(reads).toBe(1)
    expect(seen).toEqual(['fetch:ABCDE', 'eval:ABCDE:X:true'])
  })

  test('no endpoint: null body, still passes the prefix', async () => {
    let got = ''
    await runBreachCheck(
      { fetchBreachBody: async () => { throw new Error('must not fetch') } },
      { prefix: '12345', evaluate: async (p: string, b: string | null) => { got = `${p}:${b}`; return {} as any } } as any,
      { endpoint: null, failOpen: false },
    )
    expect(got).toBe('12345:null')
  })

  test('breach_prefix_mismatch from core is surfaced, not swallowed', async () => {
    const breach = {
      prefix: 'AAAAA',
      evaluate: async () => { throw new CeremonyError('breach_prefix_mismatch', 'prefix mismatch') },
    }
    let err: unknown
    try {
      await runBreachCheck({ fetchBreachBody: async () => 'body' }, breach as any, { endpoint: '/e', failOpen: true })
    } catch (e) { err = e }
    expect(err).toBeInstanceOf(CeremonyError)
    expect((err as CeremonyError).code).toBe('breach_prefix_mismatch')
  })
})

/** Live check through the committed WASM (core fc05177): the vendored build enforces the binding. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initSync, WasmBreachCheck } from 'beebeeb-wasm'

describe('vendored WASM binds the record to the requested prefix', () => {
  initSync({ module: readFileSync(fileURLToPath(new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url))) })
  test('evaluate with the right prefix works; a different prefix throws breach_prefix_mismatch', () => {
    const q = new WasmBreachCheck('correct horse battery staple')
    const prefix = q.prefix
    expect(prefix).toMatch(/^[0-9A-F]{5}$/)
    expect(() => q.evaluate(prefix, '', true)).not.toThrow()
    const other = prefix === '00000' ? '11111' : '00000'
    let msg = ''
    try { q.evaluate(other, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1', true) } catch (e) { msg = String((e as any)?.code ?? (e as any)?.message ?? e) }
    expect(msg).toContain('breach_prefix_mismatch')
    q.free()
  })
})
