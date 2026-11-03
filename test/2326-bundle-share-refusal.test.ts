/**
 * 2326 review P2-2 (L15): a multi-select "Share with Beebeeb" bundle refuses a
 * row received through a file request.
 *
 * Before the fix the dialog mapped bundle selections to `{fileId, position}`,
 * so `prepareBundleShareItems` fell back to `deriveFileKey(master, fileId)`.
 * For a request row that key opens neither its sealed name nor its content, so
 * the link published an undecryptable item. The bundle now resolves every
 * item through `getFileKeyForFile` AFTER refusing request rows, so no
 * derivation runs for a row that can never be shared.
 *
 * The dialog/hook themselves are not renderable in this suite; the wiring is
 * pinned at the source (the same way test/2326-share-skip.test.ts pins the
 * folder walk's wiring), and the plan helper is tested behaviourally.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DriveFile } from '@beebeeb/shared'
import { resolveBundleSelections } from '../src/lib/bundle-share'
import { FileCannotBeSharedError } from '../src/lib/share-file-key'
import { cannotShareReason } from '../src/lib/share-missing-items'

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

function plainRow(id: string): DriveFile {
  return {
    ...requestRow(id),
    file_request_id: null,
    sender_ephemeral_pubkey: null,
    wrapped_content_key: null,
  } as DriveFile
}

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('2326 review2 P2-2: a bundle with a request row is refused, not wrapped', () => {
  test('the L15 copy is the same one the folder walk shows', () => {
    expect(cannotShareReason('request_row')).toBe(REQUEST_COPY)
  })

  test('a request row in the selection refuses the bundle before any key is resolved', async () => {
    const asked: string[] = []
    const err = await resolveBundleSelections(
      [
        { file: plainRow('plain-1') },
        { file: requestRow('request-1') },
      ],
      async (file) => {
        asked.push(file.id)
        return new Uint8Array(32).fill(9)
      },
    ).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(FileCannotBeSharedError)
    expect((err as Error).message).toBe(REQUEST_COPY)
    // No per-item key is resolved for ANY row: nothing is derived, nothing wrapped.
    expect(asked).toEqual([])
  })

  test('every bundle selection carries a fileKey, so the derivation fallback cannot run', async () => {
    const keys = new Map([
      ['plain-1', new Uint8Array(32).fill(1)],
      ['plain-2', new Uint8Array(32).fill(2)],
    ])
    const selections = await resolveBundleSelections(
      [{ file: plainRow('plain-1') }, { file: plainRow('plain-2') }],
      async (file) => keys.get(file.id)!,
    )
    expect(selections.map((s) => [s.fileId, s.position])).toEqual([
      ['plain-1', 0],
      ['plain-2', 1],
    ])
    // `prepareBundleShareItems` derives only when `fileKey` is absent.
    expect(selections.every((s) => s.fileKey instanceof Uint8Array)).toBe(true)
    expect(selections[1].fileKey).toBe(keys.get('plain-2')!)
  })

  test('the dialog builds bundle selections through the resolver, never from ids alone', () => {
    const dialog = read('../src/components/share-dialog.tsx')
    expect(dialog).toContain('resolveBundleSelections')
    // The pre-fix fallback: an id-only selection the crypto helper would derive.
    expect(dialog).not.toContain('bundleFiles!.map((f, i) => ({ fileId: f.id, position: i }))')
    // Supplied keys are cleared after the wrap, like the folder walk's.
    expect(dialog).toContain('bundleSelections')
  })

  test('the drive bulk-share action refuses a request row with the L15 copy', () => {
    const actions = read('../src/pages/drive/use-drive-actions.ts')
    expect(actions).toContain('isRequestUpload')
    expect(actions).toContain('cannotShareReason')
  })
})
