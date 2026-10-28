/**
 * Globals a test file replaces (`localStorage`, `sessionStorage`, `location`,
 * `fetch`), scoped to that file — the same rule as mockModuleScoped.
 *
 * bun runs many test files in ONE process, so a global replaced by one file
 * leaks into every file that runs after it. Worse, `Object.defineProperty`
 * defaults `writable` to false: a later file's plain
 * `globalThis.localStorage = new MemoryStorage()` then throws "Attempted to
 * assign to readonly property", and which files break depends on bun's file
 * order (green on one machine, 11 fail / 10 errors on another).
 *
 * - `preserveGlobals(...names)` — call at the TOP LEVEL of the file, before
 *   any replacement: it snapshots each property descriptor now and restores it
 *   (or deletes a property that did not exist) in that file's `afterAll`.
 * - `setGlobal(name, value)` — replace a global from anywhere (top level, a
 *   hook, a test). The replacement is always writable and configurable, so a
 *   later assignment by any file still works.
 */
import { afterAll } from 'bun:test'

export function preserveGlobals(...names: string[]): void {
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  afterAll(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  })
}

export function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true })
}
