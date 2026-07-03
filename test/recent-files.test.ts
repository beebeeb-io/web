import { expect, test } from 'bun:test'
import { mergeRecentlyChangedFiles } from '../src/lib/recent-files'
import type { DriveFile } from '../src/lib/api'

function file(id: string, updatedAt: string, isTrashed = false): DriveFile {
  return {
    id,
    parent_id: null,
    name_encrypted: id,
    size_bytes: 1,
    is_folder: false,
    is_trashed: isTrashed,
    created_at: updatedAt,
    updated_at: updatedAt,
    uploaded_at: updatedAt,
    chunk_count: 1,
  } as DriveFile
}

test('mergeRecentlyChangedFiles includes trashed files and sorts by updated_at descending', () => {
  const live = [
    file('old-live', '2026-07-03T10:00:00.000Z'),
    file('new-live', '2026-07-03T12:00:00.000Z'),
  ]
  const trashed = [
    file('deleted', '2026-07-03T11:00:00.000Z', true),
  ]

  const merged = mergeRecentlyChangedFiles(live, trashed, 10)

  expect(merged.map((f) => f.id)).toEqual(['new-live', 'deleted', 'old-live'])
  expect(merged.find((f) => f.id === 'deleted')?.is_trashed).toBe(true)
})

test('mergeRecentlyChangedFiles de-dupes and respects the limit', () => {
  const staleLive = file('same', '2026-07-03T09:00:00.000Z')
  const trashed = file('same', '2026-07-03T13:00:00.000Z', true)

  const merged = mergeRecentlyChangedFiles([staleLive, file('extra', '2026-07-03T08:00:00.000Z')], [trashed], 1)

  expect(merged).toHaveLength(1)
  expect(merged[0].id).toBe('same')
  expect(merged[0].is_trashed).toBe(true)
})
