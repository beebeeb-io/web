/**
 * Test-only module "slots": one stable, callable namespace per hot module, with
 * per-file overrides switched through a slot.
 *
 * Why: bun 1.3.4's `mock.module()` binds a module's exports where they are first
 * imported. A file that registers a mock at load therefore decides, for the rest
 * of the process, what every module loaded in that file sees — and a later
 * file's mock (and the afterAll "restore") does not reach those bindings. The
 * full run showed the cost: f11 read an owner-adoption fake of `api`, walked the
 * wrong folder, and posted to production; owner-adoption read another file's
 * fake and reported "the folder key is not available on this device". Both are
 * green alone.
 *
 * So for the modules below the namespace installed into bun once (this file is a
 * test preload) is a set of stable wrappers: a call reads the CURRENT slot, and
 * falls through to the real export when the current file has no override. Every
 * file that mocks one of them (through mockModuleScoped) only sets its slot, so
 * whatever was imported earlier still answers with that file's overrides.
 *
 * Modules NOT listed here keep the old `mock.module()` behaviour (see
 * scoped-module-mock.ts): they are either not shared across files, or their
 * call sites are not the ones the full run exposed.
 */
import { mock } from 'bun:test'

type Exports = Record<string, unknown>

/** Per path, the overrides the CURRENT test file declared (empty = real). */
const slots = new Map<string, Exports>()

/** The real exports of each slotted module, and the path bun knows it by. */
const realByPath = new Map<string, Exports>()

/** The specifiers that get a slot, relative to this file. */
const SLOTTED = [
  '../../src/lib/api',
  '../../src/lib/api-files',
  '../../src/lib/api-folder-links',
  '../../src/lib/crypto',
  '../../src/lib/use-feature-flag',
  '../../src/lib/owned-item',
  '../../src/lib/encrypted-upload',
  '../../src/lib/folder-share-crypto',
] as const

/** A wrapper that answers with the current slot's export, else the real one. */
function wrap(path: string, name: string, real: unknown): unknown {
  if (typeof real === 'function') {
    // A function proxy keeps `typeof`, calls and `new` working, and falls
    // through to the real export while no file has overridden it (or after its
    // file ran).
    return new Proxy(real as (...args: unknown[]) => unknown, {
      apply(target, thisArg, args) {
        const override = slots.get(path)?.[name]
        if (typeof override === 'function') return Reflect.apply(override as (...a: unknown[]) => unknown, thisArg, args)
        return Reflect.apply(target, thisArg, args)
      },
      construct(target, args, newTarget) {
        const override = slots.get(path)?.[name]
        if (typeof override === 'function') return Reflect.construct(override as new (...a: unknown[]) => unknown, args, newTarget)
        return Reflect.construct(target, args, newTarget)
      },
    })
  }
  if (isPlainObject(real)) {
    // A port object (`ownedItem`, the crypto ops) is overridden whole by some
    // files; read each member through the slot so they see this file's port.
    // Only PLAIN objects: a Proxy around a Uint8Array or another built-in
    // breaks its brand checks ("Receiver should be a typed array view" from
    // wasm-bindgen when a re-exported constant like FILE_REQUEST_EMPTY_ID
    // reaches core through the wrapper).
    return new Proxy(real, {
      get(target, prop, receiver) {
        const override = slots.get(path)?.[name]
        if (override && typeof override === 'object' && prop in (override as object)) {
          return Reflect.get(override as object, prop, receiver)
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }
  return real
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

let installed = false

/** Install the slots once, before any test file imports these modules. */
export async function installModuleSlots(): Promise<void> {
  if (installed) return
  installed = true
  for (const specifier of SLOTTED) {
    const path = Bun.resolveSync(specifier, import.meta.dir)
    // A module bun cannot load under `bun test` (a Vite-only import in it) is
    // simply not slotted: its files keep the mock.module() path.
    let real: Exports
    try {
      real = { ...(await import(path)) }
    } catch {
      continue
    }
    realByPath.set(path, real)
    const namespace: Exports = {}
    for (const [name, value] of Object.entries(real)) namespace[name] = wrap(path, name, value)
    mock.module(path, () => namespace)
  }
}

/** Is this resolved path one whose exports go through a slot? */
export function isSlotted(path: string): boolean {
  return realByPath.has(path)
}

/** Point a slotted module at a file's overrides (merged over its real exports). */
export function setSlots(path: string, overrides: Exports): void {
  slots.set(path, overrides)
}

/** Drop a file's overrides: the module answers from its real exports again. */
export function clearSlots(path: string): void {
  slots.delete(path)
}

/** Test hook: no file has overrides live. */
export function clearAllSlotsForTests(): void {
  slots.clear()
}
