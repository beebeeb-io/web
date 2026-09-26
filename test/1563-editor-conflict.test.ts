import { describe, expect, test } from 'bun:test'
import {
  hasVersionConflict,
  insertBeforeExtension,
  resolveConflictAction,
} from '../src/lib/editor-conflict'

describe('hasVersionConflict', () => {
  test('no conflict when the server version equals the opened version', () => {
    expect(hasVersionConflict({ openedVersion: 4, serverVersion: 4 })).toBe(false)
  })

  test('conflict when the server has moved ahead', () => {
    expect(hasVersionConflict({ openedVersion: 4, serverVersion: 5 })).toBe(true)
  })

  test('no conflict when the server version is behind (e.g. a restore)', () => {
    expect(hasVersionConflict({ openedVersion: 4, serverVersion: 2 })).toBe(false)
  })
})

describe('resolveConflictAction', () => {
  const fileId = 'file-123'

  test('save-as-new-version targets the same file id, not conflict_created', () => {
    expect(resolveConflictAction('save-as-new-version', fileId)).toEqual({
      fileId,
      conflictCreated: false,
    })
  })

  test('keep-both targets a new file (undefined id) with conflict_created and a suffix', () => {
    expect(resolveConflictAction('keep-both', fileId)).toEqual({
      fileId: undefined,
      conflictCreated: true,
      nameSuffix: ' (edited on web)',
    })
  })

  test('show-differences uploads nothing', () => {
    expect(resolveConflictAction('show-differences', fileId)).toBeNull()
  })
})

describe('insertBeforeExtension', () => {
  test('inserts before the last extension', () => {
    expect(insertBeforeExtension('notes.md', ' (edited on web)')).toBe(
      'notes (edited on web).md',
    )
  })

  test('handles a multi-dot filename by splitting at the LAST dot', () => {
    expect(insertBeforeExtension('server-versions.spec.ts', ' (edited on web)')).toBe(
      'server-versions.spec (edited on web).ts',
    )
  })

  test('appends at the end when there is no extension', () => {
    expect(insertBeforeExtension('README', ' (edited on web)')).toBe('README (edited on web)')
  })

  test('a leading dot (dotfile) is not treated as an extension separator', () => {
    // dot at index 0 => dot <= 0 branch => suffix appended at the end, the
    // whole name (including the leading dot) is preserved intact.
    expect(insertBeforeExtension('.gitignore', ' (edited on web)')).toBe(
      '.gitignore (edited on web)',
    )
  })
})
