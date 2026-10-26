import { expect, test } from 'bun:test'
import { directAllowed, storageSource } from '../src/lib/direct/allowlist'
const pair = { host: 's3.example.test', bucket: 'bb-test' }
test('direct requires the offered direction and every discovery pair', () => {
  const d = { download: ['object-download-v1'], upload: ['object-upload-v1'], storage_buckets: [pair] }
  for (const direction of ['download', 'upload'] as const) {
    expect(directAllowed(d, direction, [pair])).toBe(true)
    expect(directAllowed(d, direction, [])).toBe(false)
    expect(directAllowed({ ...d, storage_buckets: [pair, { ...pair, bucket: 'other' }] }, direction, [pair])).toBe(false)
    expect(directAllowed({ ...d, [direction]: [] }, direction, [pair])).toBe(false)
    expect(directAllowed({ ...d, storage_buckets: [] }, direction, [pair])).toBe(false)
  }
})
test('sources are a bucket prefix with trailing slash, never a bare host', () => {
  expect(storageSource(pair)).toBe('https://s3.example.test/bb-test/')
  for (const bucket of ['', '*', '../evil', 'bb-test?x=1']) expect(() => storageSource({ ...pair, bucket })).toThrow()
})
