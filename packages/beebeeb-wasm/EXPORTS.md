# core wasm package — head ebf166d963156602f8a5108d28d4c3ac544809cc

Built on the testrig (rust:1.96-bookworm, wasm-pack 0.14.0, release + wasm-opt,
`wasm-pack build beebeeb-wasm --target web --out-name beebeeb_wasm`), from branch
`refactor/modular-split` at head `ebf166d963156602f8a5108d28d4c3ac544809cc`.

- `beebeeb_wasm_bg.wasm` sha256: `bcb3d2358c1701f466cadb2e7643d60ae4d8a119efc9f9e7d6688db685f6c7b3`
- files here: `beebeeb_wasm.js`, `beebeeb_wasm.d.ts`, `beebeeb_wasm_bg.wasm`,
  `beebeeb_wasm_bg.wasm.d.ts` (generated alongside the other three, needed for
  the TS types), `package.json`.

## Export diff vs 2f5cd8a (previous head)

Same extraction on both revs: every `export` name in the generated
`beebeeb_wasm.js` (the `export { … }` table, `export function` and `export class`
declarations), which is what a bundler sees; `initSync` is present in both.

- **removed: 0**
- **total: 145 -> 146**
- **added: 1** — `previewableBatchFor(names: string[], platform: string): Uint8Array`

`previewableBatchFor` is a thin wrapper over `beebeeb_core::media::previewable_batch_for`:
`result[i]` is `1` when `names[i]` can be previewed in-app on `platform`
(`"web"`, `"desktop"` or `"mobile"`), `0` otherwise. An unknown platform string
throws `unknown preview platform \`…\`` — it never falls back to a default.

The table behind it is proved by `test-vectors/consolidation/preview_platforms.json`
(131 cases: 123 extensions of the three-way union + 8 shape rows, one expected
answer per platform; web 78, desktop 88, mobile 90 types), and the pipeline is
`beebeeb-wasm/js-tests/preview_platforms.test.cjs` (part of the 98/98 JS run).
`previewableBatch`-style platform-less export never existed here, and core's
existing `is_previewable_by_extension` / `previewable_batch` are untouched.
