/**
 * Task 2237b, decisions L6 and L7 — the owned-folder crypto entry points of
 * `src/lib/crypto.ts`, run in process over the committed WASM build.
 *
 * In the app each of these is a one-line `withProxy` hop to the crypto worker,
 * whose method is a thin pass-through to the same core export (see
 * src/workers/crypto.worker.ts). The worker cannot load under bun, so a test
 * spreads these into its `mockModuleScoped('../src/lib/crypto', ...)`
 * overrides: the caller's real code then reaches real core, and only the
 * postMessage hop is skipped. Nothing here reimplements a format.
 *
 * `encryptFileMetadata` / `decryptFileMetadata` mirror crypto.ts line for line
 * (decryptFileMetadata keeps its "Encrypted file" on failure), because their
 * internal `readNameMetadata` call cannot be reached through a module mock.
 */
import { createContentOps } from '../../src/lib/content-crypto'
import { loadWasm } from './wasm-crypto-mirror'

export function ownedFolderCrypto() {
  const w = loadWasm()
  const ops = createContentOps(w)
  return {
    wrapFolderChild: async (folderKey: Uint8Array, rootId: string, itemId: string, kind: number, childKey: Uint8Array) =>
      w.wrapFolderChild(folderKey, rootId, itemId, kind, childKey) as Uint8Array,
    unwrapFolderChild: async (folderKey: Uint8Array, rootId: string, itemId: string, kind: number, wrapped: Uint8Array) =>
      w.unwrapFolderChild(folderKey, rootId, itemId, kind, wrapped) as Uint8Array,
    wrapFolderCustody: async (masterKey: Uint8Array, folderId: string, folderKey: Uint8Array) =>
      w.wrapFolderCustody(masterKey, folderId, folderKey) as Uint8Array,
    unwrapFolderCustody: async (masterKey: Uint8Array, folderId: string, wrapped: Uint8Array) =>
      w.unwrapFolderCustody(masterKey, folderId, wrapped) as Uint8Array,
    wrapLinkOwnerKey: async (masterKey: Uint8Array, shareId: string, linkKey: Uint8Array) =>
      w.wrapLinkOwnerKey(masterKey, shareId, linkKey) as Uint8Array,
    unwrapLinkOwnerKey: async (masterKey: Uint8Array, shareId: string, wrapped: Uint8Array) =>
      w.unwrapLinkOwnerKey(masterKey, shareId, wrapped) as Uint8Array,
    wrapLinkOwnerToken: async (masterKey: Uint8Array, shareId: string, token: Uint8Array) =>
      w.wrapLinkOwnerToken(masterKey, shareId, token) as Uint8Array,
    unwrapLinkOwnerToken: async (masterKey: Uint8Array, shareId: string, wrapped: Uint8Array) =>
      w.unwrapLinkOwnerToken(masterKey, shareId, wrapped) as Uint8Array,
    wrapOwnerFileKey: async (masterKey: Uint8Array, itemId: string, fileKey: Uint8Array) =>
      w.wrapOwnerFileKey(masterKey, itemId, fileKey) as Uint8Array,
    unwrapOwnerFileKey: async (masterKey: Uint8Array, itemId: string, wrapped: Uint8Array) =>
      w.unwrapOwnerFileKey(masterKey, itemId, wrapped) as Uint8Array,
    // Task 2255 (L9): purpose-bound invite owner copies, and a legacy copy
    // opened only with core's proof over the folder's rows.
    wrapInviteOwnerCopy: async (masterKey: Uint8Array, folderId: string, folderKey: Uint8Array) =>
      w.wrapInviteOwnerCopy(masterKey, folderId, folderKey) as Uint8Array,
    unwrapInviteOwnerCopy: async (masterKey: Uint8Array, folderId: string, wrapped: Uint8Array) =>
      w.unwrapInviteOwnerCopy(masterKey, folderId, wrapped) as Uint8Array,
    openLegacyInviteOwnerCopy: async (
      masterKey: Uint8Array,
      folderId: string,
      legacyCopy: Uint8Array,
      rows: { file_id: string; encrypted_file_key: string }[],
    ) => (w.openLegacyInviteOwnerCopy(masterKey, folderId, legacyCopy, rows) as Uint8Array | undefined) ?? null,
    deriveFolderLinkPassphraseStretch: async (passphrase: string, token: string) =>
      w.deriveFolderLinkPassphraseStretch(passphrase, token) as Uint8Array,
    // The generic seal the legacy invite format (L7b) still uses.
    encryptChunk: async (fileKey: Uint8Array, plaintext: Uint8Array) => {
      const result = w.encrypt_chunk(fileKey, plaintext) as { nonce: Uint8Array; ciphertext: Uint8Array }
      return { nonce: result.nonce, ciphertext: result.ciphertext }
    },
    decryptChunk: async (fileKey: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array) =>
      w.decrypt_chunk(fileKey, nonce, ciphertext) as Uint8Array,
    encryptFileMetadata: async (fileKey: Uint8Array, filename: string, mimeType?: string | null) => {
      const result = w.encrypt_metadata(fileKey, JSON.stringify({ name: filename, mime_type: mimeType ?? null }))
      return { nonce: result.nonce as Uint8Array, ciphertext: result.ciphertext as Uint8Array }
    },
    decryptFileMetadata: async (fileKey: Uint8Array, nameEncrypted: string) => {
      if (!nameEncrypted.startsWith('{')) return { name: nameEncrypted, mimeType: null }
      try {
        const meta = ops.readNameMetadata(fileKey, nameEncrypted)
        return { name: meta.name, mimeType: meta.mimeType }
      } catch {
        return { name: 'Encrypted file', mimeType: null }
      }
    },
  }
}

/**
 * The LEGACY folder-invite owner copy that flag-off invites wrote before task
 * 2255: the folder key sealed under derive_file_key(master, folder_id) (the
 * folder's own name key), no AAD. Product code no longer writes it (2255 writes
 * core's purpose-bound copy); existing invites still carry it, so tests build
 * it here.
 */
export function legacyOwnerCopy(masterKey: Uint8Array, folderId: string, folderKey: Uint8Array): Uint8Array {
  const w = loadWasm()
  const nameKey = w.derive_file_key(masterKey, new TextEncoder().encode(folderId)) as Uint8Array
  const sealed = w.encrypt_chunk(nameKey, folderKey) as { nonce: Uint8Array; ciphertext: Uint8Array }
  return new Uint8Array([...sealed.nonce, ...sealed.ciphertext])
}
