/**
 * Task 2238 lead review — a file received through a FILE REQUEST must be
 * shareable from a folder snapshot.
 *
 * Such a row (file_request_id / sender_ephemeral_pubkey / wrapped_content_key
 * set) is sealed under a RANDOM content key, not `deriveFileKey(master, id)`
 * (see src/lib/file-request-crypto.ts). Wrapping the derived key would publish
 * an item the recipient can never decrypt — the folder link would list it and
 * then fail on download. The fix has two halves, each pinned here:
 *
 *   1. `prepareBundleShareItems` honours a caller-supplied item key instead of
 *      re-deriving (RED before the fix: it always derived, so the wrapped blob
 *      unwraps to the derived key, not the request key).
 *   2. `collectFolderBundle` keeps the whole row, so the dialog CAN hand that
 *      key in (`getFileKeyForFile(file)`); RED before the fix: the scan only
 *      carried {fileId, position, name}, so no envelope field survived it.
 */
import { describe, expect, test } from 'bun:test'
import type { DriveFile } from '@beebeeb/shared'
import { prepareBundleShareItems, toBase64, unwrapKeyFromShare } from '../src/lib/crypto'
import { decodeShareKeyToken } from '../src/lib/share-key'
import { collectFolderBundle } from '../src/lib/folder-bundle'

/** A row exactly as the server returns a file that arrived via a file request. */
function requestRow(id: string): DriveFile {
  return {
    id,
    name_encrypted: '{"cipher_suite":"AES-256-GCM","nonce":"n","ciphertext":"c"}',
    mime_type: 'text/plain',
    size_bytes: 24,
    is_folder: false,
    is_trashed: false,
    parent_id: 'folder-1',
    chunk_count: 1,
    created_at: '2026-10-27T00:00:00Z',
    updated_at: '2026-10-27T00:00:00Z',
    file_request_id: 'req-1',
    sender_ephemeral_pubkey: 'pubkey-base64',
    wrapped_content_key: 'wrapped-key-base64',
  } as DriveFile
}

function plainRow(id: string): DriveFile {
  return { ...requestRow(id), file_request_id: null, sender_ephemeral_pubkey: null, wrapped_content_key: null } as DriveFile
}

describe('prepareBundleShareItems honours a supplied item key (2238 review)', () => {
  test('the request-upload content key is what gets wrapped under K_c', async () => {
    const masterKey = new Uint8Array(32).fill(7)
    // A request upload's content key: NOT deriveFileKey(master, id).
    const requestKey = new Uint8Array(32).fill(0xa5)

    const material = await prepareBundleShareItems(masterKey, [
      { fileId: 'request-file', position: 0, fileKey: requestKey },
    ])

    expect(material.items).toHaveLength(1)
    const wrapped = new Uint8Array(Buffer.from(material.items[0].wrapped_file_key, 'base64'))
    const opened = await unwrapKeyFromShare(decodeShareKeyToken(material.keyForUrl), wrapped)
    expect(new Uint8Array(opened)).toEqual(requestKey)
    // And NOT the id-derived key: the request content key is what travels.
    expect(toBase64(new Uint8Array(opened))).toBe(toBase64(requestKey))
  })

})

describe('collectFolderBundle keeps the row so its key can be resolved (2238 review)', () => {
  test('a request upload inside the folder survives the walk with its envelope fields', async () => {
    const row = requestRow('request-1')
    const scan = await collectFolderBundle('root', {
      listChildren: async () => [row, plainRow('plain-1')],
      decryptName: async (node) => (node.file_request_id ? 'received.txt' : 'mine.txt'),
    })

    expect(scan.files.map((f) => f.fileId)).toEqual(['plain-1', 'request-1'])
    const item = scan.files.find((f) => f.fileId === 'request-1')
    expect(item, 'the request upload must be IN the snapshot').toBeTruthy()
    expect(item!.file.file_request_id).toBe('req-1')
    expect(item!.file.sender_ephemeral_pubkey).toBe('pubkey-base64')
    expect(item!.file.wrapped_content_key).toBe('wrapped-key-base64')
    expect(item!.file).toBe(row)
  })
})
