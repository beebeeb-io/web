/**
 * 2326 review P2-2 (L15): a row received through a FILE REQUEST cannot be
 * shared, but it must never break a share that includes it.
 *
 * Before the fix, the folder walk decrypted every name through
 * `contentKeyBytes(getFileKeyForFile(node))`: a request row has no key, so one
 * such row aborted the whole folder scan (and a single-file share threw a raw
 * error). Now the row is SKIPPED, the rest of the folder still shares, and the
 * row is listed with the same "can't be shared" sentence the L15 panel uses.
 */
import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { DriveFile } from '@beebeeb/shared'
import { collectFolderBundle } from '../src/lib/folder-bundle'
import { assertShareableRow, FileCannotBeSharedError, shareFileKey } from '../src/lib/share-file-key'
import { cannotShareReason, folderSkipReason } from '../src/lib/share-missing-items'

const REQUEST_COPY = "can't be shared (received through a file request)"

function requestRow(id: string): DriveFile {
  return {
    id,
    name_encrypted: '{"cipher_suite":"AES-256-GCM","nonce":"n","ciphertext":"c"}',
    mime_type: 'text/plain',
    size_bytes: 24,
    is_folder: false,
    is_trashed: false,
    parent_id: 'root',
    chunk_count: 1,
    created_at: '2026-10-27T00:00:00Z',
    updated_at: '2026-10-27T00:00:00Z',
    file_request_id: 'req-1',
    sender_ephemeral_pubkey: 'pubkey-base64',
    wrapped_content_key: 'wrapped-key-base64',
  } as DriveFile
}

function plainRow(id: string, extra: Partial<DriveFile> = {}): DriveFile {
  return {
    ...requestRow(id),
    file_request_id: null,
    sender_ephemeral_pubkey: null,
    wrapped_content_key: null,
    ...extra,
  } as DriveFile
}

describe('2326 P2-2: a request row is skipped, never fatal', () => {
  test('the L15 copy is reused verbatim, for a request row only', () => {
    expect(cannotShareReason('request_row')).toBe(REQUEST_COPY)
    expect(folderSkipReason(requestRow('r1'))).toBe(REQUEST_COPY)
    expect(folderSkipReason(plainRow('p1'))).toBeNull()
  })

  test('a folder shares its other items and lists the request row as not shared', async () => {
    const decrypted: string[] = []
    const tree: Record<string, DriveFile[]> = {
      root: [
        requestRow('request-root'),
        plainRow('plain-a'),
        plainRow('folder-1', { is_folder: true, size_bytes: 0 }),
      ],
      'folder-1': [requestRow('request-nested'), plainRow('plain-b')],
    }
    const scan = await collectFolderBundle('root', {
      listChildren: async (folderId) => tree[folderId] ?? [],
      skipReason: folderSkipReason,
      decryptName: async (node) => {
        // A request row must never even be asked for a key-derived name.
        if (node.file_request_id) throw new Error('a request row must not be decrypted')
        decrypted.push(node.id)
        return node.id
      },
    })

    expect(scan.files.map((f) => f.fileId).sort()).toEqual(['plain-a', 'plain-b'])
    expect(scan.overCap).toBe(false)
    // Nothing is wrapped for a request row: it is not in the shared set at all.
    expect(scan.files.some((f) => f.file.file_request_id)).toBe(false)
    expect(scan.skipped.sort((a, b) => a.fileId.localeCompare(b.fileId))).toEqual([
      { fileId: 'request-nested', name: null, reason: REQUEST_COPY },
      { fileId: 'request-root', name: null, reason: REQUEST_COPY },
    ])
    expect(decrypted.sort()).toEqual(['folder-1', 'plain-a', 'plain-b'])
  })

  // 2326 review2 P3-4: a skipped request row's name is never authenticated
  // (the walk never decrypts it), so the server's plaintext string is not
  // echoed into the skipped list. The row is listed by its reason only.
  test('a plaintext-named request row is never shown by its server-supplied name', async () => {
    const row = { ...requestRow('request-plain'), name_encrypted: 'received.png' } as DriveFile
    const scan = await collectFolderBundle('root', {
      listChildren: async () => [row],
      skipReason: folderSkipReason,
      decryptName: async () => {
        throw new Error('must not be decrypted')
      },
    })
    expect(scan.files).toEqual([])
    expect(scan.skipped).toEqual([
      { fileId: 'request-plain', name: null, reason: REQUEST_COPY },
    ])
  })

  test('a skipped non-request row may still be named by its plaintext name', async () => {
    // The rule is about the request row, not every skip: a legacy plaintext
    // name on an ordinary row is the row's own name.
    const row = { ...plainRow('plain-plain'), name_encrypted: 'legacy.txt' } as DriveFile
    const scan = await collectFolderBundle('root', {
      listChildren: async () => [row],
      skipReason: () => 'cannot be shared',
      decryptName: async () => {
        throw new Error('must not be decrypted')
      },
    })
    expect(scan.skipped).toEqual([
      { fileId: 'plain-plain', name: 'legacy.txt', reason: 'cannot be shared' },
    ])
  })

  test('a name that cannot be decrypted no longer aborts the scan', async () => {
    const scan = await collectFolderBundle('root', {
      listChildren: async () => [plainRow('broken'), plainRow('fine')],
      skipReason: folderSkipReason,
      decryptName: async (node) => {
        if (node.id === 'broken') throw new Error('no key')
        return 'fine.txt'
      },
    })
    expect(scan.files.map((f) => `${f.fileId}|${f.name}`)).toEqual(['broken|null', 'fine|fine.txt'])
    expect(scan.skipped).toEqual([])
  })

  test('a single request-row share is refused with that copy and asks for no key', async () => {
    const row = requestRow('request-1')
    let keysAsked = 0
    const deps = {
      file: row,
      getFileKey: async () => {
        keysAsked++
        return new Uint8Array(32)
      },
      getFileKeyForFile: async () => {
        keysAsked++
        return new Uint8Array(32)
      },
    }
    const err = await shareFileKey('request-1', deps).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(FileCannotBeSharedError)
    expect((err as Error).message).toBe(REQUEST_COPY)
    expect(keysAsked).toBe(0)
  })

  test('an ordinary row still shares the key that opens it', async () => {
    const key = new Uint8Array(32).fill(9)
    const row = plainRow('plain-1')
    expect(
      await shareFileKey('plain-1', {
        file: row,
        getFileKey: async () => new Uint8Array(32),
        getFileKeyForFile: async () => key,
      }),
    ).toBe(key)
    // Without the row (forwarded share) it keeps the old key lookup.
    const fallback = new Uint8Array(32).fill(3)
    expect(
      await shareFileKey('other', {
        file: row,
        getFileKey: async () => fallback,
        getFileKeyForFile: async () => key,
      }),
    ).toBe(fallback)
  })

  test('the dialog wires the skip rule and renders the row as not shared', () => {
    const read = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    const dialog = read('../src/components/share-dialog.tsx')
    expect(dialog).toContain('skipReason: folderSkipReason')
    expect(dialog).toContain('FileCannotBeSharedError')
    expect(dialog).toContain('<FolderSnapshotNotes')
    // The skipped rows themselves live in their own module (file-size ratchet).
    const notes = read('../src/components/share/folder-snapshot-notes.tsx')
    expect(notes).toContain('data-testid="folder-skipped"')
    expect(notes).toContain('skip.reason')
  })
})

/**
 * 2326 review2 P3-3: the email invite path created the invite FIRST and only
 * then asked for the key, so a request row's FileCannotBeSharedError was
 * swallowed by the "approval failed" catch and the sender was told the invite
 * went out. A request row is refused with the L15 copy before any invite is
 * minted.
 */
describe('2326 review2 P3-3: an invite for a request row is refused before createInvite', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  test('assertShareableRow refuses a request row with the L15 copy', () => {
    const err = (() => {
      try {
        assertShareableRow(requestRow('request-1'))
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(FileCannotBeSharedError)
    expect((err as Error).message).toBe(REQUEST_COPY)
    // An ordinary row and the row-less (forwarded share) path still invite.
    expect(() => assertShareableRow(plainRow('plain-1'))).not.toThrow()
    expect(() => assertShareableRow(undefined)).not.toThrow()
  })

  test('the dialog checks the row BEFORE it creates the invite', () => {
    const dialog = read('../src/components/share-dialog.tsx')
    const guard = dialog.indexOf('assertShareableRow(file)')
    const invite = dialog.indexOf('await createInvite(fileId, recipientEmail)')
    expect(guard).toBeGreaterThan(0)
    expect(invite).toBeGreaterThan(0)
    expect(guard).toBeLessThan(invite)
    // The refusal must reach the sender as the L15 sentence, not "approval failed".
    expect(dialog).toContain('e instanceof FileCannotBeSharedError ? e.message : userFriendlyError(e)')
  })
})
