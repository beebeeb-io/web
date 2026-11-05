/**
 * Test preload (bunfig.toml [test] preload, listed FIRST): initialise the
 * committed beebeeb-wasm build synchronously, before any module can start
 * wasm-bindgen's async `init()`. One instance per test process, whatever the
 * file order or the machine's speed.
 *
 * LD-0079. `src/lib/share-links-wasm.ts`, `thumbnail-policy.ts`,
 * `archive-name.ts`, `format.ts` and `preview.ts` call `init()` when they are
 * imported (the module-slots preload already imports the first of them).
 * wasm-bindgen's `init()` checks for an instance only BEFORE it awaits the
 * fetch, so an `init()` still in flight when a test file's `initSync` runs makes
 * a second instance when it lands, and replaces the first one. A class object
 * made on the first instance is then freed by its FinalizationRegistry on the
 * second: 2326's top-level `newForeignItemId` handle hit
 * "RuntimeError: Out of bounds memory access" between tests (0 tests run) on
 * the ubuntu-26.04 CI runners, where the fetch lands later than locally. With
 * the instance in place first, every `init()` and `initSync` returns it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initSync, type InitOutput } from 'beebeeb-wasm'

const WASM_PATH = fileURLToPath(new URL('../../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url))

let instance: InitOutput | undefined

/** The exports of the instance this preload made (made on the first call). */
export function loadCommittedWasm(): InitOutput {
  instance ??= initSync({ module: readFileSync(WASM_PATH) })
  return instance
}

loadCommittedWasm()
