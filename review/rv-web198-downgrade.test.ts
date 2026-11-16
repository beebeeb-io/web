import { expect, test } from 'bun:test'
import { mockModuleScoped } from '../test/helpers/scoped-module-mock'
import { ownedFolderCrypto } from '../test/helpers/owned-folder-wasm'
import { loadWasm } from '../test/helpers/wasm-crypto-mirror'

const wasm = loadWasm()
const encoder = new TextEncoder()
const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const OLD_ITEM = '22222222-2222-4222-8222-222222222222'
const REPLAYED_AS = '33333333-3333-4333-8333-333333333333'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const OLD_FILE_KEY = new Uint8Array(32).fill(0x11)

const realCrypto = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (real) => ({
  ...real,
  ...ownedFolderCrypto(),
  deriveFileKey: async (masterKey: Uint8Array, id: string) =>
    wasm.derive_file_key(masterKey, encoder.encode(id)),
}))

function ownerBlob(): string {
  const wrappingKey = wasm.derive_file_key(MASTER, encoder.encode(ROOT))
  const sealed = wasm.encrypt_chunk(wrappingKey, FOLDER_KEY) as { nonce: Uint8Array; ciphertext: Uint8Array }
  const bytes = new Uint8Array(sealed.nonce.length + sealed.ciphertext.length)
  bytes.set(sealed.nonce)
  bytes.set(sealed.ciphertext, sealed.nonce.length)
  return (realCrypto.toBase64 as (v: Uint8Array) => string)(bytes)
}

let custodyStatus = 501
await mockModuleScoped('../src/lib/api', import.meta.dir, (real) => ({
  getSharedFolder: async () => {
    const ErrorClass = real.ApiError as new (message: string, status: number) => Error
    throw new ErrorClass('hidden custody', custodyStatus)
  },
  getSentInvites: async () => [{
    id: 'old-invite',
    file_id: ROOT,
    is_folder_share: true,
    status: 'approved',
    created_at: '2026-10-27T00:00:00Z',
    encrypted_owner_folder_key: ownerBlob(),
  }],
}))

const share = await import('../src/lib/folder-share-crypto')
const adoption = await import('../src/lib/owner-adoption')

test('custody lookup failure must not admit a replayed legacy child wrap', async () => {
  // This is a genuine pre-custody wrap of OLD_ITEM. The legacy format has no
  // root, item-id, or kind AAD, so an untrusted server can replay it as another
  // row once the reader chooses the legacy branch.
  const oldWrap = await share.legacyInviteChildWrap(FOLDER_KEY, OLD_FILE_KEY)
  custodyStatus = 501
  adoption.clearSharedFolderLookups()
  const opened = await adoption.resolveSharedFileKey({
    masterKey: MASTER,
    folderId: ROOT,
    file: { id: REPLAYED_AS, parent_id: ROOT, acted_via_share_id: 'new-link' },
    keyIndexPromise: Promise.resolve(new Map([[REPLAYED_AS, oldWrap]])),
  })

  // Safe behavior is fail closed. PR head instead returns OLD_FILE_KEY.
  expect(opened).toBeNull()
  void OLD_ITEM
})
