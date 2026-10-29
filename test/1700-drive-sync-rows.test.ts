import { describe, expect, test } from 'bun:test'
import type { DriveFile } from '../src/lib/api'
import { decideSyncRows, rowsSignature } from '../src/lib/sync-rows'

/**
 * Task 1700 — drive list updates must not clobber a good list, and unrelated
 * sync ops must not re-render the list. `decideSyncRows` is the pure decision
 * the drive's `refreshFromSync` applies before calling `setFiles`:
 *  - identical rows (id+name+size+updated_at+parent+flags) → no state write;
 *  - an all-empty derive is NEVER applied while tree coverage is incomplete;
 *  - an all-empty derive is deferred (confirmEmpty) so a delete+create burst
 *    cannot flash EmptyDrive.
 */

function row(id: string, overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id,
    name_encrypted: `enc-${id}`,
    mime_type: null,
    size_bytes: 1,
    is_folder: false,
    is_trashed: false,
    parent_id: null,
    chunk_count: 1,
    is_starred: false,
    has_thumbnail: false,
    has_large_thumbnail: false,
    version_number: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('1700: decideSyncRows', () => {
  test('T4 partial tree (!coverageComplete) + non-empty list → never apply an empty list', () => {
    const current = [row('a')]
    const decision = decideSyncRows({
      next: [],
      current,
      coverageComplete: false,
      emptyConfirmed: false,
    })
    expect(decision.apply).toBe(false)
    expect(decision.confirmEmpty).toBe(false) // not even a confirmation path
    // Even a "confirmed" empty must not clobber while coverage is incomplete.
    expect(decideSyncRows({
      next: [],
      current,
      coverageComplete: false,
      emptyConfirmed: true,
    }).apply).toBe(false)
  })

  test('T5 unchanged derive → zero list state change (fresh object instances)', () => {
    const current = [row('a', { name_encrypted: 'x' }), row('b')]
    const next = current.map((f) => ({ ...f }))
    const decision = decideSyncRows({
      next,
      current,
      coverageComplete: true,
      emptyConfirmed: false,
    })
    expect(decision.apply).toBe(false)
    expect(decision.confirmEmpty).toBe(false)
    // …and a genuinely changed row DOES apply.
    const renamed = [row('a', { name_encrypted: 'y' }), row('b')]
    expect(decideSyncRows({
      next: renamed,
      current,
      coverageComplete: true,
      emptyConfirmed: false,
    }).apply).toBe(true)
  })

  test('the signature covers id, name, size, updated_at, parent and flags', () => {
    const base = [row('a')]
    const mutations: Partial<DriveFile>[] = [
      { name_encrypted: 'other' },
      { size_bytes: 2 },
      { updated_at: '2026-10-02T00:00:00.000Z' },
      { parent_id: 'p' },
      { is_starred: true },
      { is_trashed: true },
      { is_folder: true },
      { has_thumbnail: true },
      { has_large_thumbnail: true },
    ]
    for (const m of mutations) {
      const next = [{ ...row('a'), ...m }]
      expect(rowsSignature(next)).not.toBe(rowsSignature(base))
    }
  })

  test('T6 delete+create burst in one window → no transient empty apply', () => {
    const current = [row('a')]
    // Delete op: derive is empty → defer, never apply EmptyDrive immediately.
    const afterDelete = decideSyncRows({
      next: [],
      current,
      coverageComplete: true,
      emptyConfirmed: false,
    })
    expect(afterDelete.apply).toBe(false)
    expect(afterDelete.confirmEmpty).toBe(true)
    // Create op lands before the confirmation window elapses → rows apply,
    // so the list was never set to empty.
    const afterCreate = decideSyncRows({
      next: [row('b')],
      current,
      coverageComplete: true,
      emptyConfirmed: false,
    })
    expect(afterCreate.apply).toBe(true)
    expect(afterCreate.confirmEmpty).toBe(false)
  })

  test('a genuinely empty folder still renders empty after confirmation', () => {
    const decision = decideSyncRows({
      next: [],
      current: [row('a')],
      coverageComplete: true,
      emptyConfirmed: true,
    })
    expect(decision.apply).toBe(true)
    expect(decision.confirmEmpty).toBe(false)
  })

  test('a real empty folder (nothing shown, nothing derived) is a no-op', () => {
    const decision = decideSyncRows({
      next: [],
      current: [],
      coverageComplete: true,
      emptyConfirmed: false,
    })
    expect(decision.apply).toBe(false)
    expect(decision.confirmEmpty).toBe(false)
  })
})
