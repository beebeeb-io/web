# beebeeb-wasm exports — head 2cf0341c914da94cc83122fbf488337162eabca5

Built from core branch `master-key-naming/wasm-vendor` (head `2cf0341`), which is
`pass-offline/web-wasm-base` (e419f15 = core 31b0c6c + adoptPhrase) plus the cherry-pick of
a37966a (master key first, then the password; `ceremonyStepOrder`; copy strings). Not core main:
core main's new `decrypt_chunk_frame` is NOT in this build. Conflicts in the cherry-pick were files
that do not exist on the base (signup_flow, passkey, beebeeb-client, docs/client-rules); they were dropped.
Built with wasm-pack 0.14.0, rustc from rustup, `--target web --release`:

```
scripts/coord/remote-build.sh legion core master-key-naming/wasm-vendor --artefact beebeeb-wasm/pkg-web -- \
  'export PATH=$HOME/.cargo/bin:$PATH; wasm-pack build beebeeb-wasm --target web --release --out-dir pkg-web'
```

- `beebeeb_wasm_bg.wasm` sha256: `09cf370d5c90edc73aa97e2c4c84f1b6fc5fdce2b3a015eeae823978b11b6a51`
- files: `beebeeb_wasm.js`, `beebeeb_wasm.d.ts`, `beebeeb_wasm_bg.wasm`, `beebeeb_wasm_bg.wasm.d.ts`, `package.json` (unchanged).

## Export diff vs the previously vendored build (31b0c6c)

- top-level `export function` / `export class` names: 149 before, 149 after, removed 0, added 0.
- **added: 1 static method** — `WasmSignupCeremony.ceremonyStepOrder()` (JS: `WasmSignupCeremony.ceremonyStepOrder()`),
  plus its raw binding in `beebeeb_wasm_bg.wasm.d.ts`.
- `adoptPhrase` was already on the base. No signature changed; ceremony order is now master key
  (`save_phrase`, `confirm_phrase`) before `set_password`, and `try_set_password` before the master key
  throws `step_not_done`.

---- previous manifest (31b0c6c build), kept for the request-row result shapes ----

## previous: head 31b0c6c

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
