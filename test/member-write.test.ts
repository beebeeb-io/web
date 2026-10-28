/**
 * Task 2237b — what a member may do in a shared folder, and how the write is
 * sealed. The crypto is the real core WASM behind the worker-free mirror; the
 * upload pipeline and the API are fakes that record what they were handed.
 */
import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const wasm = loadWasm()
const encoder = new TextEncoder()

const MEMBER_MASTER = new Uint8Array(32).fill(3)
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const FOLDER_ID = '11111111-1111-4111-8111-111111111111'
const INVITE_ID = 'invite-1'
const FILE_ID = '22222222-2222-4222-8222-222222222222'

const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  deriveFileKey: async (masterKey: Uint8Array, fileId: string) =>
    wasm.derive_file_key(masterKey, encoder.encode(fileId)),
  encryptChunk: async (key: Uint8Array, plaintext: Uint8Array) => {
    const out = wasm.encrypt_chunk(key, plaintext)
    return { nonce: out.nonce as Uint8Array, ciphertext: out.ciphertext as Uint8Array }
  },
  decryptChunk: async (key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array) =>
    wasm.decrypt_chunk(key, nonce, ciphertext),
  // The name writer is a worker crossing too; seal it here so the assertion can
  // open the blob with the item key and prove the folder key cannot.
  encryptFilename: async (key: Uint8Array, filename: string) => {
    const out = wasm.encrypt_chunk(key, encoder.encode(filename))
    return { nonce: out.nonce as Uint8Array, ciphertext: out.ciphertext as Uint8Array }
  },
}))

interface UploadCall {
  args: unknown[]
}

const uploadCalls: UploadCall[] = []
let uploadFails = 0

await mockModuleScoped('../src/lib/encrypted-upload', import.meta.dir, {
  encryptedUpload: async (...args: unknown[]) => {
    uploadCalls.push({ args })
    if (uploadFails > 0) {
      uploadFails -= 1
      throw new Error('upload refused')
    }
    const file = args[0] as File
    ;(args[5] as ((p: unknown) => void) | undefined)?.({ stage: 'Uploading', progress: 50 })
    return {
      id: args[1] as string,
      name_encrypted: '',
      mime_type: file.type || null,
      size_bytes: file.size,
      is_folder: false,
      is_trashed: false,
      parent_id: (args[4] as string | undefined) ?? null,
      chunk_count: 1,
    }
  },
})

const patches: Array<{ id: string; body: unknown }> = []
const trashes: string[][] = []

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  updateFile: async (id: string, body: unknown) => {
    patches.push({ id, body })
    return { id, name_encrypted: (body as { name_encrypted: string }).name_encrypted }
  },
  bulkTrashFiles: async (ids: string[]) => {
    trashes.push(ids)
    return { trashed: ids, already_trashed: [], missing: [] }
  },
})

/** Base64 of `nonce || ciphertext`, the wire form every folder wrap uses. */
function seal(key: Uint8Array, plaintext: Uint8Array): string {
  const out = wasm.encrypt_chunk(key, plaintext)
  const nonce = out.nonce as Uint8Array
  const ct = out.ciphertext as Uint8Array
  const bytes = new Uint8Array(nonce.length + ct.length)
  bytes.set(nonce, 0)
  bytes.set(ct, nonce.length)
  return real.toBase64(bytes as Uint8Array) as string
}

const {
  memberPermissions,
  memberUploadFiles,
  memberRename,
  memberTrash,
} = await import('../src/lib/member-write')

function context(level: 'view' | 'add' | 'edit', fileKeys?: Record<string, string>) {
  return {
    folderId: FOLDER_ID,
    inviteId: INVITE_ID,
    folderKey: FOLDER_KEY,
    level,
    displayName: 'Sam',
    masterKey: MEMBER_MASTER,
    fileKeys,
  }
}

function file(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    name_encrypted: '',
    mime_type: 'text/plain',
    size_bytes: 5,
    is_folder: false,
    is_trashed: false,
    parent_id: FOLDER_ID,
    chunk_count: 1,
    ...overrides,
  }
}

describe('memberPermissions', () => {
  test('view can do nothing', () => {
    expect(memberPermissions('view')).toEqual({
      canUpload: false,
      canCreateFolder: false,
      canRename: false,
      canDelete: false,
    })
  })

  test('add can upload and create folders but not edit', () => {
    expect(memberPermissions('add')).toEqual({
      canUpload: true,
      canCreateFolder: true,
      canRename: false,
      canDelete: false,
    })
  })

  test('edit can do everything', () => {
    expect(memberPermissions('edit')).toEqual({
      canUpload: true,
      canCreateFolder: true,
      canRename: true,
      canDelete: true,
    })
  })
})

describe('memberUploadFiles', () => {
  test('seals each child key with the member folder key and the invite', async () => {
    uploadCalls.length = 0
    const progress: string[] = []
    const result = await memberUploadFiles(
      context('add'),
      FOLDER_ID,
      [new File([new Uint8Array(5)], 'note.txt', { type: 'text/plain' })],
      (name) => progress.push(name),
    )

    expect(result).toEqual({ added: 1, failed: 0 })
    expect(uploadCalls).toHaveLength(1)
    const args = uploadCalls[0].args
    expect(args[4]).toBe(FOLDER_ID)
    expect(args[6]).toBeUndefined()
    expect(args[7]).toMatchObject({ folderKey: FOLDER_KEY, sharedFolderId: FOLDER_ID, inviteId: INVITE_ID })
    expect(progress).toEqual(['note.txt'])
  })

  test('a top-level upload lands inside the shared folder, not the member drive', async () => {
    uploadCalls.length = 0
    await memberUploadFiles(
      context('add'),
      null,
      [new File([new Uint8Array(5)], 'root.txt', { type: 'text/plain' })],
      () => undefined,
    )
    expect(uploadCalls[0].args[4]).toBe(FOLDER_ID)
  })

  test('a failed file is counted and does not stop the batch', async () => {
    uploadCalls.length = 0
    uploadFails = 1
    const result = await memberUploadFiles(
      context('add'),
      FOLDER_ID,
      [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')],
      () => undefined,
    )
    expect(result).toEqual({ added: 1, failed: 1 })
  })
})

describe('memberRename', () => {
  test('re-seals the name with the item key, not the folder key', async () => {
    patches.length = 0
    const fileKey = wasm.derive_file_key(MEMBER_MASTER, encoder.encode(FILE_ID))
    const ctx = context('edit', { [FILE_ID]: seal(FOLDER_KEY, fileKey) })

    await memberRename(ctx, file({ name_encrypted: 'legacy' }), 'Trip notes.txt')

    expect(patches).toHaveLength(1)
    expect(patches[0].id).toBe(FILE_ID)
    const nameEncrypted = (patches[0].body as { name_encrypted: string }).name_encrypted
    const blob = JSON.parse(nameEncrypted) as { nonce: number[]; ciphertext: number[] }
    const plain = wasm.decrypt_chunk(
      fileKey,
      new Uint8Array(blob.nonce),
      new Uint8Array(blob.ciphertext),
    )
    expect(new TextDecoder().decode(plain)).toBe('Trip notes.txt')

    // The folder key must NOT open the name blob.
    expect(() =>
      wasm.decrypt_chunk(FOLDER_KEY, new Uint8Array(blob.nonce), new Uint8Array(blob.ciphertext)),
    ).toThrow()
  })
})

describe('memberTrash', () => {
  test('trashes the id in one call', async () => {
    trashes.length = 0
    const result = await memberTrash(context('edit'), file())
    expect(trashes).toEqual([[FILE_ID]])
    expect(result).toEqual({ trashed: 1 })
  })
})


test('B member rename refuses a missing shared wrap instead of guessing a member key', async () => {
  const before = patches.length
  await expect(memberRename({ folderId: FOLDER_ID, inviteId: INVITE_ID, folderKey: FOLDER_KEY,
    level: 'edit', displayName: 'Member', masterKey: MEMBER_MASTER, fileKeys: {} },
    { id: FILE_ID, is_folder: false } as any, 'corrupt.txt')).rejects.toThrow(/key/)
  expect(patches).toHaveLength(before)
})
