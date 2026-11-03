/**
 * Task 1590 — the ONLY sanctioned way to `mock.module()` in this suite.
 *
 * bun's `mock.module` is process-global and is NOT undone by `mock.restore()`
 * (verified on bun 1.4.2). A mock registered by one test file therefore stays
 * live for every file that runs after it in the same `bun test` process. Two
 * failure modes followed from that, both dependent on the file order bun
 * happens to pick on a given filesystem (green on the Mac and in CI, red on
 * the Legion — 722 pass / 24 fail / 18 errors at bbaba4b):
 *
 *   1. PARTIAL mocks: a factory that returns only the names its own file needs
 *      makes every later static `import { x } from ...` of that module fail to
 *      link ("Export named 'getApiUrl' not found in module src/lib/api.ts").
 *   2. LEAKED behaviour: stubs (a fake `ApiError`, a `getToken` that always
 *      returns null, zero-filled crypto) silently replace the real module for
 *      files that never asked for a mock.
 *
 * `mockModuleScoped` fixes both: the mock is the REAL module's exports spread
 * with the file's overrides (so it is always complete), and an `afterAll`
 * registered on the calling file re-registers the real exports (so it never
 * outlives the file). Call it at the TOP LEVEL of a test file (or from a helper
 * that is called there), never inside a test — the `afterAll` must attach to
 * the file scope.
 *
 * `scripts/test-order-guard.sh` enforces this: it fails if any file outside
 * this helper calls `mock.module(` directly, and it runs the suite in reversed
 * and shuffled file orders plus every file alone.
 */
import { afterAll, beforeEach, mock } from 'bun:test'
import { clearSlots, isSlotted, setSlots } from './module-slots'

type Exports = Record<string, unknown>

/**
 * @param specifier  module path, relative to `fromDir`
 * @param fromDir    the calling file's directory (pass `import.meta.dir`)
 * @param overrides  the names to replace; an object, or a function of the
 *                   real exports (handy for wrapping a real function)
 * @returns          a snapshot of the REAL exports (untouched by the mock)
 */
/**
 * The first REAL snapshot taken of each module path. A second mock of the same
 * path (in one file, or inside a test) would otherwise snapshot the FIRST mock
 * as "real", and its afterAll would restore that mock for every later file.
 * Found by the shuffled order guard on web #198 (seed 427842741): a file that
 * mocked use-feature-flag twice left its first mock live, and the feature-flag
 * suite run after it read every flag as on.
 */
const originals = new Map<string, Exports>()

export async function mockModuleScoped(
  specifier: string,
  fromDir: string,
  overrides: Exports | ((real: Exports) => Exports),
): Promise<Exports> {
  const path = Bun.resolveSync(specifier, fromDir)
  // Snapshot BEFORE mocking: bun rewrites an already-loaded module namespace
  // in place, so a live reference would start returning the mock too. Only the
  // first snapshot of a path is real; every later call reuses it.
  const real: Exports = originals.get(path) ?? { ...(await import(path)) }
  originals.set(path, real)
  const o = typeof overrides === 'function' ? overrides(real) : overrides
  for (const name of Object.keys(o)) {
    if (!(name in real)) {
      // A stub for a name the real module does not export has drifted from
      // the code it stands in for — fail loudly instead of papering over it.
      throw new Error(`mockModuleScoped(${specifier}): '${name}' is not exported by the real module`)
    }
  }
  // The hot modules (module-slots.ts, installed by the test preload) take
  // overrides through a slot: bun 1.3.4 binds `mock.module()` exports where a
  // module is first imported, so a file's mock would otherwise bind for the
  // rest of the process and a later file's would not reach it (the full run:
  // f11 read owner-adoption's `api` fake and posted to production;
  // owner-adoption read another file's fake and lost the folder key).
  if (isSlotted(path)) {
    // Only the names this file actually replaces: `real` is the slotted
    // namespace, whose non-overridden functions are the wrappers themselves, so
    // storing them back would make a call recurse into its own wrapper.
    const only = Object.fromEntries(Object.entries(o).filter(([name, value]) => value !== real[name]))
    const install = () => setSlots(path, only)
    install()
    // A file may also re-mock from inside a test (a surface that needs a
    // different flag); there is no hook to register there and none is needed.
    try {
      beforeEach(install)
    } catch {
      // inside a test: the install() above is the whole job
    }
    afterAll(() => clearSlots(path))
    return real
  }
  const install = () => mock.module(path, () => ({ ...real, ...o }))
  install()
  afterAll(() => {
    mock.module(path, () => real)
  })
  return real
}
