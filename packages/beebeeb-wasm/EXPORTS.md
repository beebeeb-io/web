# beebeeb-wasm exports — head 31b0c6c8d3390843185167335f72a42f686470bd

Built from branch `feat/2326-request-row-shipped-seal` (core repo) on the wasm
testrig image bb-rust-wasm:1.96 with wasm-pack 0.14.0, `--target web --release`:

```
BB_REMOTE_IMAGE=wasm /Users/guuslangelaar/code/bb-gate-logs/modular-split/remote-run-wasm.sh \
  oc-core-2326 /Users/guuslangelaar/code/bb-worktrees/oc-core-2326 -- \
  'rm -rf /w/pkg-web-final && wasm-pack build beebeeb-wasm --target web --release --out-dir /w/pkg-web-final'
```

- `beebeeb_wasm_bg.wasm` sha256: `c403337609b5b0401fd69400bffb7b36373485d892a3c82c5f961b87883f0e31`
- files: `beebeeb_wasm.js`, `beebeeb_wasm.d.ts`, `beebeeb_wasm_bg.wasm`,
  `beebeeb_wasm_bg.wasm.d.ts`, `package.json`.

## Export diff vs base 2f5cd8a (branch point; 5894fa4 has the same 145 names)

Compared the `export function` / `export class` names in `beebeeb_wasm.d.ts`.

- base: 145 names
- head: 149 names
- **removed: 0**
- **added: 4** — `mintGuestItemId`, `sealRequestRename`, `previewableBatchFor`
  (core #65 merge), `WasmRequestContentReader` (2326 delta2 P2-2).

No exported name, signature or byte output changed in delta3: that run added
tests and docs only. The `.d.ts` text changed (doc comments on
`WasmRequestContentReader.decryptor` / `openFrame` / `sealRequestRename`), not
the export list.

## Changed result shapes (2326 delta2)

| Surface | Removed | Replacement |
| --- | --- | --- |
| WASM `resolveRequestRow` | `contentKey`, `nameKey`; `content: WasmChunkDecryptor` | `content: WasmRequestContentReader` (`fileId`, `chunkFormat`, `decryptor()`, `openFrame(...)`); no key fields |
| WASM `resolveRequestRow.renameTarget` | `key` | `{origin, pin}`; seal with `sealRequestRename` |
| uniffi `RequestRowKeys` | `content_key`, `name_key`; `content: ChunkDecryptorHandle` | `content: RequestContentReader` |
| uniffi `resolve_request_row` | returned `content: ChunkDecryptorHandle` | returns `RequestRowKeys.content: RequestContentReader` |
| uniffi `resolve_request_row_detailed` | returned `content: ChunkDecryptorHandle` | returns `ResolvedRequestRow.content: RequestContentReader` |
| uniffi `ResolvedRequestRow` | `content_key`, `name_key`; `content: ChunkDecryptorHandle` | `content: RequestContentReader` |
| uniffi `RequestRenameTarget` | `key` | `{origin, pin}`; seal with `MasterKeyHandle::seal_request_rename` |

The in-tree `EXPORTS.md` at the repo root is the authoritative manifest; it
also lists the three uniffi additions and the uniffi caller change
(`content.push_frame(...)` -> `content.decryptor().push_frame(...)`).

## Checks at this head

- `cargo check --workspace --all-targets --locked`: 0 errors, 0 warnings
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: 0/0
- `cargo fmt --all -- --check`: clean
- `cargo test --workspace --locked`: 1200 passed, 0 failed, 2 ignored
- `bash beebeeb-wasm/js-tests/run.sh`: 103 tests, 103 pass, 0 fail
