import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { requireWasmIntegrity } from '../src/lib/wasm-integrity'

test('accepts exactly the SHA-384 format emitted by the build tool', () => {
  const integrity = `sha384-${createHash('sha384').update('fixture').digest('base64')}`
  expect(requireWasmIntegrity({ integrity })).toBe(integrity)
})
test('rejects empty, unknown, partial, option-bearing or multiple SRI expressions', () => {
  for (const integrity of ['', ' ', 'nonsense', 'sha999-abc', 'sha384-x', `sha384-${'A'.repeat(63)}`, `sha384-${'A'.repeat(65)}`, `sha384-${'_'.repeat(64)}`, `sha384-${'A'.repeat(64)}?option`, `sha384-${'A'.repeat(64)} sha384-${'B'.repeat(64)}`, 1, {}, null]) {
    expect(() => requireWasmIntegrity({ integrity })).toThrow('WASM integrity verification failed')
  }
  for (const manifest of [null, undefined, {}, [], 'sha384-abc']) expect(() => requireWasmIntegrity(manifest)).toThrow('WASM integrity verification failed')
})
test('the production worker validates before the verified fetch and checks its HTTP status', () => {
  const worker = readFileSync(new URL('../src/workers/crypto.worker.ts', import.meta.url), 'utf8')
  expect(worker).toContain('const integrity = requireWasmIntegrity(manifest)')
  expect(worker).toMatch(/fetch\(wasmUrl,\s*\{\s*integrity,/)
  expect(worker).toContain('if (!wasmResp.ok)')
  expect(worker.indexOf('if (!wasmResp.ok)')).toBeLessThan(worker.indexOf('await wasmResp.arrayBuffer()'))
})
