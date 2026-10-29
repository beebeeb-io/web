import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as wasm from 'beebeeb-wasm'
import { pairsAllowed, storageSource } from '../src/lib/direct/allowlist'

wasm.initSync({ module: readFileSync('packages/beebeeb-wasm/beebeeb_wasm_bg.wasm') })
const pair = { host: 's3.example.test', bucket: 'bb-test' }
test('direct requires the offered direction and every discovery pair', () => {
  const d = { download: ['object-download-v1'], upload: ['object-upload-v1'], storage_buckets: [pair] }
  for (const direction of ['download', 'upload'] as const) {
    expect(pairsAllowed(wasm, d, direction, [pair])).toBe(true)
    expect(pairsAllowed(wasm, d, direction, [])).toBe(false)
    expect(pairsAllowed(wasm, { ...d, storage_buckets: [pair, { ...pair, bucket: 'other' }] }, direction, [pair])).toBe(false)
    expect(pairsAllowed(wasm, { ...d, [direction]: [] }, direction, [pair])).toBe(false)
    expect(pairsAllowed(wasm, { ...d, storage_buckets: [] }, direction, [pair])).toBe(false)
  }
})
test('core compares hosts ASCII case-insensitively and buckets exactly', () => {
  const d = { download: ['object-download-v1'], storage_buckets: [{ host: pair.host.toUpperCase(), bucket: pair.bucket }] }
  expect(pairsAllowed(wasm, d, 'download', [pair])).toBe(true)
  expect(pairsAllowed(wasm, d, 'download', [{ ...pair, bucket: pair.bucket.toUpperCase() }])).toBe(false)
})
test('sources are a bucket prefix with trailing slash, never a bare host', () => {
  expect(storageSource(pair)).toBe('https://s3.example.test/bb-test/')
  for (const bucket of ['', '*', '../evil', 'bb-test?x=1']) expect(() => storageSource({ ...pair, bucket })).toThrow()
})
