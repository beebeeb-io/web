import { describe, expect, test } from 'bun:test'
import { installMocks } from './helpers/upload-share-mocks'

// Task 2133: a later folder invite reuses the folder's existing key. The
// browser proof is e2e/2133-folder-second-invite.spec.ts; these pin the
// selection rules (the WASM crypto worker is not loadable under bun test).
await installMocks()

const inv = (o: Record<string, unknown>) =>
  ({ id: 'i', file_id: 'F', created_at: '2026-10-22T10:00:00Z', is_folder_share: true, ...o }) as never

describe('ownerFolderKeyBlobs', () => {
  test('keeps only this folder\'s folder-share invites that carry an owner key, newest first', async () => {
    const { ownerFolderKeyBlobs } = await import('../src/lib/folder-share-crypto')
    const blobs = ownerFolderKeyBlobs(
      [
        inv({ encrypted_owner_folder_key: 'old', created_at: '2026-10-22T09:00:00Z' }),
        inv({ encrypted_owner_folder_key: 'new', created_at: '2026-10-22T11:00:00Z' }),
        inv({ encrypted_owner_folder_key: 'other-folder', file_id: 'G' }),
        inv({ encrypted_owner_folder_key: 'file-share', is_folder_share: false }),
        inv({ encrypted_owner_folder_key: '' }),
        inv({}),
      ],
      'F',
    )
    expect(blobs).toEqual(['new', 'old'])
  })

  test('no earlier invite means no existing key (the caller mints one)', async () => {
    const { ownerFolderKeyBlobs, findExistingFolderKey } = await import('../src/lib/folder-share-crypto')
    expect(ownerFolderKeyBlobs([], 'F')).toEqual([])
    expect(await findExistingFolderKey(new Uint8Array(32), 'F', [inv({ file_id: 'G', encrypted_owner_folder_key: 'x' })])).toBeNull()
  })
})
