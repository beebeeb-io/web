/**
 * Decision L7 (core #45 review, P1 proven red): every child key sealed under a
 * shared folder's key (a file key, or a folder's name key) is bound to WHERE it
 * belongs: AAD = "beebeeb-folder-child-v1" || shared ROOT id || item id || kind,
 * through core's wrapFolderChild / unwrapFolderChild.
 *
 * These drive the web's own functions (sealChildKey / openChildKey /
 * openFolderChild in folder-share-crypto.ts, and the guest listing's
 * describeGuestItem) over the committed WASM. Against the pre-L7 code, which
 * sealed and opened with the generic empty-AAD wrap and ignored ids, all three
 * fail: a swapped wrap opens on the wrong row, a file wrap opens as a folder or
 * under another root, and an unbound wrap opens as a fallback.
 */
import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'

await mockModuleScoped('../src/lib/crypto', import.meta.dir, ownedFolderCrypto())

const { sealChildKey, openChildKey, openFolderChild, legacyInviteChildWrap } = await import('../src/lib/folder-share-crypto')
const { describeGuestItem } = await import('../src/components/folder-link/use-guest-listing')
const { encryptFileMetadata, serializeEncryptedBlob } = await import('../src/lib/crypto')

const ROOT = '11111111-1111-4111-8111-111111111111'
const OTHER_ROOT = '44444444-4444-4444-8444-444444444444'
const ITEM_A = '22222222-2222-4222-8222-222222222222'
const ITEM_B = '33333333-3333-4333-8333-333333333333'

function key(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

async function nameUnder(fileKey: Uint8Array, name: string): Promise<string> {
  const meta = await encryptFileMetadata(fileKey, name, 'text/plain')
  return serializeEncryptedBlob(meta.nonce, meta.ciphertext)
}

function row(id: string, wrapped: string, nameEncrypted: string) {
  return {
    id,
    parent_id: null,
    is_folder: false,
    name_encrypted: nameEncrypted,
    size_bytes: 1,
    updated_at: '2026-10-28T00:00:00Z',
    created_at: '2026-10-28T00:00:00Z',
    has_thumbnail: false,
    wrapped_file_key: wrapped,
  } as unknown as Parameters<typeof describeGuestItem>[0]
}

describe('L7: a folder child wrap opens only on its own row', () => {
  test("B's row carrying A's wrap (and A's name) must fail to open", async () => {
    const folderKey = key()
    const keyA = key()
    const wrapA = await sealChildKey(folderKey, { rootId: ROOT, itemId: ITEM_A, isFolder: false }, keyA)
    const nameA = await nameUnder(keyA, 'a.txt')

    // Its own row opens, name and all.
    const own = await describeGuestItem(row(ITEM_A, wrapA, nameA), folderKey, ROOT)
    expect(own.name).toBe('a.txt')
    expect(Array.from(own.fileKey ?? [])).toEqual(Array.from(keyA))

    // The server swapped A's wrap and name onto B's row: B stays inert.
    const swapped = await describeGuestItem(row(ITEM_B, wrapA, nameA), folderKey, ROOT)
    expect(swapped.name).toBeNull()
    expect(swapped.fileKey).toBeNull()
  })

  test('a file wrap does not open as a folder wrap, nor under another shared root', async () => {
    const folderKey = key()
    const wrap = await sealChildKey(folderKey, { rootId: ROOT, itemId: ITEM_A, isFolder: false }, key())
    await expect(openChildKey(folderKey, { rootId: ROOT, itemId: ITEM_A, isFolder: true }, wrap)).rejects.toThrow(/decryption failed/)
    await expect(openChildKey(folderKey, { rootId: OTHER_ROOT, itemId: ITEM_A, isFolder: false }, wrap)).rejects.toThrow(/decryption failed/)
  })

  test('the unbound pre-L7 wrap is refused, never opened as a fallback', async () => {
    const folderKey = key()
    const childKey = key()
    // The legacy invite seal of a VALID key, under the right folder key.
    const unbound = await legacyInviteChildWrap(folderKey, childKey)
    const ref = { rootId: ROOT, itemId: ITEM_A, isFolder: false }
    await expect(openChildKey(folderKey, ref, unbound)).rejects.toThrow()
    await expect(openFolderChild('l7', folderKey, ref, unbound)).rejects.toThrow()
    const guest = await describeGuestItem(row(ITEM_A, unbound, await nameUnder(childKey, 'a.txt')), folderKey, ROOT)
    expect(guest.name).toBeNull()
    expect(guest.fileKey).toBeNull()
  })
})
