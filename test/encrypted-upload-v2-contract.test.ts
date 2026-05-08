import { beforeEach, describe, expect, mock, test } from 'bun:test'

const initCalls: unknown[] = []
const uploadedChunks: Array<{ fileId: string; index: number; firstByte: number; uploadSessionId: string | null | undefined }> = []
const updatedFiles: Array<{ fileId: string; nameEncrypted: string }> = []
const savedStates: Array<{ fileId: string; upload_session_id?: string | null }> = []
const removedStates: string[] = []
const encryptedMetadataKeys: number[] = []

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

mock.module('../src/lib/crypto', () => ({
  CHUNK_SIZE: 4,
  encryptChunk: async (fileKey: Uint8Array, plaintext: Uint8Array) => ({
    nonce: new Uint8Array([fileKey[0]]),
    ciphertext: plaintext,
  }),
  encryptFilename: async (fileKey: Uint8Array, plaintext: string) => {
    encryptedMetadataKeys.push(fileKey[0])
    return {
      nonce: new Uint8Array([fileKey[0]]),
      ciphertext: new TextEncoder().encode(plaintext),
    }
  },
  toBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
}))

mock.module('../src/lib/api', () => ({
  ApiError,
  initUpload: async (metadata: unknown) => {
    initCalls.push(metadata)
    return {
      protocol: 'v2',
      file_id: 'server-file-id',
      tenant_id: 'tenant-id',
      object_version_id: 'object-version-id',
      upload_session_id: 'upload-session-id',
      chunk_size_bytes: 4,
      chunk_count: 1,
      storage_format_version: 2,
      storage_pool_id: 'pool-id',
      region: 'Europe',
    }
  },
  uploadChunk: async (
    fileId: string,
    index: number,
    data: Uint8Array,
    uploadSessionId?: string | null,
  ) => {
    uploadedChunks.push({ fileId, index, firstByte: data[0], uploadSessionId })
    return { index, size: data.byteLength }
  },
  completeUpload: async () => ({
    id: 'server-file-id',
    name_encrypted: updatedFiles.at(-1)?.nameEncrypted ?? '',
    mime_type: null,
    size_bytes: 4,
    chunk_count: 1,
    is_folder: false,
    is_uploading: false,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
  }),
  getUploadStatus: async () => ({ uploaded_chunks: [] }),
  updateFile: async (fileId: string, updates: { name_encrypted?: string }) => {
    updatedFiles.push({ fileId, nameEncrypted: updates.name_encrypted ?? '' })
    return { id: fileId }
  },
}))

mock.module('../src/lib/upload-resume', () => ({
  computeFingerprint: async () => 'fingerprint',
  findByFingerprint: async () => null,
  saveUploadState: async (state: { fileId: string; upload_session_id?: string | null }) => {
    savedStates.push(state)
  },
  removeUploadState: async (fileId: string) => {
    removedStates.push(fileId)
  },
}))

describe('encryptedUpload v2 server file id contract', () => {
  beforeEach(() => {
    initCalls.length = 0
    uploadedChunks.length = 0
    updatedFiles.length = 0
    savedStates.length = 0
    removedStates.length = 0
    encryptedMetadataKeys.length = 0
  })

  test('uses the v2 server-generated file id for metadata, chunks, resume state, and cleanup', async () => {
    const { encryptedUpload } = await import('../src/lib/encrypted-upload')
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'fresh.txt', { type: 'text/plain' })

    const uploaded = await encryptedUpload(
      file,
      'client-generated-file-id',
      new Uint8Array([1]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async (fileId) => {
        expect(fileId).toBe('server-file-id')
        return new Uint8Array([9])
      },
    )

    expect(uploaded.id).toBe('server-file-id')
    expect(encryptedMetadataKeys).toEqual([1, 9])
    expect(updatedFiles).toHaveLength(1)
    expect(updatedFiles[0].fileId).toBe('server-file-id')
    expect(uploadedChunks).toEqual([
      { fileId: 'server-file-id', index: 0, firstByte: 9, uploadSessionId: 'upload-session-id' },
    ])
    expect(savedStates).toHaveLength(1)
    expect(savedStates[0]).toMatchObject({
      fileId: 'server-file-id',
      upload_session_id: 'upload-session-id',
      object_version_id: 'object-version-id',
      chunk_size_bytes: 4,
      chunk_count: 1,
      region: 'Europe',
    })
    expect(removedStates).toEqual(['server-file-id'])
  })
})
