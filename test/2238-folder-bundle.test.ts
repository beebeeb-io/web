/**
 * Task 2238 — folder "Share link" is a snapshot bundle of the folder's files.
 *
 * RED-first: written against the pre-2238 tree, where no such walk exists (the
 * dialog mints a `file` share on the folder id and the public page dies on
 * "cannot download a folder"). Every assertion fails before the walk lands.
 */
import { describe, expect, test } from 'bun:test'
import type { DriveFile } from '@beebeeb/shared'
import {
  FOLDER_BUNDLE_MAX_ITEMS,
  collectFolderBundle,
  type FolderBundleDeps,
} from '../src/lib/folder-bundle'

function node(id: string, name: string, extra: Partial<DriveFile> = {}): DriveFile {
  return {
    id,
    name_encrypted: `enc:${name}`,
    mime_type: null,
    size_bytes: 10,
    is_folder: false,
    is_trashed: false,
    parent_id: null,
    chunk_count: 1,
    created_at: '2026-10-27T00:00:00Z',
    updated_at: '2026-10-27T00:00:00Z',
    ...extra,
  }
}

function treeDeps(): FolderBundleDeps & { calls: string[] } {
  const calls: string[] = []
  const tree: Record<string, DriveFile[]> = {
    root: [
      node('f-beach', 'beach.jpg'),
      node('f-holiday', 'Holiday', { is_folder: true, size_bytes: 0 }),
      node('f-notes', 'notes.txt'),
      node('f-old', 'old.txt', { is_trashed: true }),
      node('f-trash', 'Trashed', { is_folder: true, is_trashed: true }),
    ],
    'f-holiday': [
      node('f-2024', '2024', { is_folder: true, size_bytes: 0 }),
      node('f-beach-in', 'beach.jpg'),
    ],
    'f-2024': [node('f-sunset', 'sunset.png')],
  }
  return {
    calls,
    listChildren: async (folderId: string) => {
      calls.push(folderId)
      return tree[folderId] ?? []
    },
    decryptName: async (n: DriveFile) => n.name_encrypted.replace(/^enc:/, ''),
  }
}

describe('collectFolderBundle', () => {
  test('walks the whole subtree down to nested folders, deterministically', async () => {
    const scan = await collectFolderBundle('root', treeDeps())
    expect(scan.overCap).toBe(false)
    // Files at a level come before the contents of that level's subfolders.
    expect(scan.files.map((f) => `${f.fileId}|${f.position}|${f.name}`)).toEqual([
      'f-beach|0|beach.jpg',
      'f-sunset|1|sunset.png',
      'f-beach-in|2|beach.jpg',
      'f-notes|3|notes.txt',
    ])
    // The same-name file in a subfolder is its OWN item (bundles are flat and
    // duplicates are allowed — the item id tells them apart).
    expect(scan.files.filter((f) => f.name === 'beach.jpg')).toHaveLength(2)
  })

  test('skips trashed files and never descends into a trashed folder', async () => {
    const deps = treeDeps()
    const scan = await collectFolderBundle('root', deps)
    expect(scan.files.filter((f) => f.fileId === 'f-old')).toHaveLength(0)
    expect(deps.calls.indexOf('f-trash')).toBe(-1)
  })

  test('over the cap: overCap true and stops at the cap', async () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n) => node(`f-${n}`, `${n}.txt`))
    const scan = await collectFolderBundle(
      'root',
      { listChildren: async () => many, decryptName: async (n) => n.name_encrypted.slice(4) },
      { maxItems: 3 },
    )
    expect(scan.overCap).toBe(true)
    expect(scan.files).toHaveLength(3)
    expect(FOLDER_BUNDLE_MAX_ITEMS).toBe(256)
  })

  test('an empty folder is zero files, not an error', async () => {
    const scan = await collectFolderBundle('root', {
      listChildren: async () => [],
      decryptName: async () => null,
    })
    expect(scan.files).toEqual([])
    expect(scan.overCap).toBe(false)
  })

  test('an undecryptable name still yields an item (sorted by id)', async () => {
    const scan = await collectFolderBundle('root', {
      listChildren: async () => [node('b-id', 'b'), node('a-id', 'a')],
      decryptName: async () => null,
    })
    expect(scan.files.map((f) => f.fileId)).toEqual(['a-id', 'b-id'])
    expect(scan.files.map((f) => f.name)).toEqual([null, null])
  })

})
