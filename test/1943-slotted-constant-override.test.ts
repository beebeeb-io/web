/**
 * Task 2275 review-3: `mockModuleScoped()` on a SLOTTED module delivers its
 * overrides through module-slots.ts, whose `wrap()` only proxies functions and
 * plain objects. Everything else — constants, arrays, typed arrays — is
 * returned as the real export, so a `CHUNK_SIZE: 4` override was silently
 * dropped: four 1943-* files and upload-share-mocks believed they had changed
 * the chunk size while the real 1 MiB value stayed in place. Either honour it
 * (impossible without changing what those modules export) or refuse it loudly.
 */
import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

describe('mockModuleScoped on a slotted module', () => {
  test('refuses a constant override it cannot honour', async () => {
    await expect(
      mockModuleScoped('../src/lib/crypto', import.meta.dir, { CHUNK_SIZE: 4 }),
    ).rejects.toThrow(/CHUNK_SIZE.*slotted.*silently dropped/)
  })

  test('still accepts a function override', async () => {
    await expect(
      mockModuleScoped('../src/lib/crypto', import.meta.dir, { planChunks: async () => ({ chunk_size_bytes: 4, chunk_count: 1 }) }),
    ).resolves.toBeDefined()
  })
})
