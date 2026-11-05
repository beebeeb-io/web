/**
 * LD-0079: one beebeeb-wasm instance per test process.
 *
 * Five src modules call wasm-bindgen's `init()` when imported. `init()` checks
 * for an instance only before it awaits the fetch, so one in flight when a
 * test's `initSync` runs lands later as a SECOND instance and replaces the
 * first; a class handle made on the first is then freed on the second by its
 * FinalizationRegistry ("RuntimeError: Out of bounds memory access" between
 * tests). It hit test/2326-f-class-refusal.test.ts run alone on the
 * ubuntu-26.04 CI runners. The cure is test/helpers/wasm-preload.ts, the first
 * preload: the instance exists before any of those imports runs.
 *
 * The first test is the guard: it goes red on a bunfig without that preload or
 * with it moved down (seen red on that mutant). The second checks what the
 * preload buys; it cannot catch a missing preload on its own, because whether
 * the race hits depends on timing (and this file imports the helper first).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import init, { newForeignItemId } from 'beebeeb-wasm'
import { loadCommittedWasm } from './helpers/wasm-preload'
import { ensureArchiveNameWasm } from '../src/lib/archive-name'
import { ensureWasm } from '../src/lib/format'
import { ensurePreviewWasm } from '../src/lib/preview'
import { ensureShareLinkWasm } from '../src/lib/share-links-wasm'
import { ensureThumbnailWasm } from '../src/lib/thumbnail-policy'

describe('LD-0079: one beebeeb-wasm instance per test process', () => {
  test('the wasm preload runs first, before any preload that imports src modules', () => {
    const bunfig = Bun.TOML.parse(readFileSync(new URL('../bunfig.toml', import.meta.url), 'utf8')) as {
      test?: { preload?: string[] }
    }
    const preload = bunfig.test?.preload ?? []
    expect(preload[0]).toBe('./test/helpers/wasm-preload.ts')
    expect(preload).toContain('./test/helpers/module-slots-preload.ts')
  })

  test('every import-time init() lands on the preload instance, and a handle made on it frees cleanly', async () => {
    const instance = loadCommittedWasm()
    const handle = newForeignItemId(new Uint8Array(32).fill(7))

    await Promise.all([
      ensureArchiveNameWasm(),
      ensureWasm(),
      ensurePreviewWasm(),
      ensureShareLinkWasm(),
      ensureThumbnailWasm(),
    ])

    expect(await init()).toBe(instance)
    expect(typeof handle.idText).toBe('string')
    expect(handle.idText.length).toBeGreaterThan(0)
    handle.free()
  })
})
