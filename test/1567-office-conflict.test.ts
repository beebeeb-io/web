import { describe, test, expect } from 'bun:test'
import { hasVersionConflict, resolveOfficeConflictAction, insertBeforeExtension } from '../src/lib/office/office-conflict'

describe('hasVersionConflict (reused from editor-conflict.ts)', () => {
  test('server ahead of opened version is a conflict', () => {
    expect(hasVersionConflict({ openedVersion: 3, serverVersion: 4 })).toBe(true)
  })
  test('equal versions is not a conflict', () => {
    expect(hasVersionConflict({ openedVersion: 3, serverVersion: 3 })).toBe(false)
  })
})

describe('resolveOfficeConflictAction', () => {
  test('save-as-new-version targets the same file id, not a conflict-created row', () => {
    expect(resolveOfficeConflictAction('save-as-new-version', 'file-1')).toEqual({ fileId: 'file-1', conflictCreated: false })
  })

  test('keep-both targets a brand new file id and IS conflict-created', () => {
    const result = resolveOfficeConflictAction('keep-both', 'file-1')
    expect(result?.fileId).toBeUndefined()
    expect(result?.conflictCreated).toBe(true)
    expect(result?.nameSuffix).toBe(' (edited on web)')
  })

  test('discard uploads nothing — the binary-file replacement for "show differences"', () => {
    expect(resolveOfficeConflictAction('discard', 'file-1')).toBeNull()
  })
})

describe('insertBeforeExtension (reused from editor-conflict.ts)', () => {
  test('inserts a suffix before the extension for an office filename', () => {
    expect(insertBeforeExtension('Q3-report.docx', ' (edited on web)')).toBe('Q3-report (edited on web).docx')
  })
})
