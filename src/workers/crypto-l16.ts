/**
 * L16 (contract 2275 T5.7) calls of the crypto worker: actor names and link
 * labels. Extracted from crypto.worker.ts to keep that file under the size
 * ratchet; every method is a thin pass-through to core, which owns the
 * sanitising and the envelopes.
 *
 * The worker spreads `l16WorkerOps(ensureWasm)` into its Comlink surface, so
 * the call shapes in `src/lib/crypto.ts` are unchanged.
 */
import type * as WasmTypes from 'beebeeb-wasm'

export interface L16WorkerOps {
  sealFolderActorName(
    folderKey: Uint8Array,
    sharedFolderId: string,
    name: string,
  ): Promise<string>
  openFolderActorName(
    folderKey: Uint8Array,
    sharedFolderId: string,
    envelope: string,
  ): Promise<string>
  wrapLinkLabel(masterKey: Uint8Array, shareId: string, label: string): Promise<Uint8Array>
  unwrapLinkLabel(masterKey: Uint8Array, shareId: string, wrapped: Uint8Array): Promise<string>
}

export function l16WorkerOps(ensureWasm: () => Promise<typeof WasmTypes>): L16WorkerOps {
  return {
    /** L16: seal an actor's display name, bound to the shared folder id. */
    async sealFolderActorName(folderKey, sharedFolderId, name) {
      const wasm = await ensureWasm()
      return wasm.sealFolderActorName(folderKey, sharedFolderId, name) as string
    },

    /** L16: open an actor's display name; a different folder id is refused. */
    async openFolderActorName(folderKey, sharedFolderId, envelope) {
      const wasm = await ensureWasm()
      return wasm.openFolderActorName(folderKey, sharedFolderId, envelope) as string
    },

    /** L16: seal a link label under the master key, bound to the share id. */
    async wrapLinkLabel(masterKey, shareId, label) {
      const wasm = await ensureWasm()
      return wasm.wrapLinkLabel(masterKey, shareId, label) as Uint8Array
    },

    /** L16: open a link label; a different share id is refused. */
    async unwrapLinkLabel(masterKey, shareId, wrapped) {
      const wasm = await ensureWasm()
      return wasm.unwrapLinkLabel(masterKey, shareId, wrapped) as string
    },
  }
}
