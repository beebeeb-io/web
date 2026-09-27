import { describe, test, expect } from 'bun:test'
import { resolveOfficeFileKind, officeAppLabel, defaultExtensionFor } from '../src/lib/office/office-file-kind'

describe('resolveOfficeFileKind', () => {
  test('routes docx/doc/odt to writer by mime type', () => {
    expect(resolveOfficeFileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'report.docx')).toEqual({ app: 'writer', ext: 'docx' })
    expect(resolveOfficeFileKind('application/msword', 'legacy.doc')).toEqual({ app: 'writer', ext: 'doc' })
    expect(resolveOfficeFileKind('application/vnd.oasis.opendocument.text', 'notes.odt')).toEqual({ app: 'writer', ext: 'odt' })
  })

  test('routes xlsx/xls/ods to calc', () => {
    expect(resolveOfficeFileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'budget.xlsx')).toEqual({ app: 'calc', ext: 'xlsx' })
    expect(resolveOfficeFileKind(null, 'legacy.xls')).toEqual({ app: 'calc', ext: 'xls' })
  })

  test('routes pptx/ppt/odp to impress', () => {
    expect(resolveOfficeFileKind('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx')).toEqual({ app: 'impress', ext: 'pptx' })
    expect(resolveOfficeFileKind(null, 'deck.odp')).toEqual({ app: 'impress', ext: 'odp' })
  })

  test('falls back to extension when mime type is null (ZK upload)', () => {
    expect(resolveOfficeFileKind(null, 'Q3-report.docx')).toEqual({ app: 'writer', ext: 'docx' })
  })

  test('is case-insensitive on extension', () => {
    expect(resolveOfficeFileKind(null, 'REPORT.DOCX')).toEqual({ app: 'writer', ext: 'docx' })
  })

  test('returns null for non-office files', () => {
    expect(resolveOfficeFileKind('text/plain', 'notes.txt')).toBeNull()
    expect(resolveOfficeFileKind('image/png', 'photo.png')).toBeNull()
    expect(resolveOfficeFileKind(null, 'archive')).toBeNull()
  })

  test('mime type wins over a misleading extension', () => {
    // A renamed file where the encrypted metadata's mime type is still correct.
    expect(resolveOfficeFileKind('application/vnd.oasis.opendocument.text', 'notes.txt')).toEqual({ app: 'writer', ext: 'txt' })
  })
})

describe('officeAppLabel / defaultExtensionFor', () => {
  test('label + default extension per app', () => {
    expect(officeAppLabel('writer')).toBe('Writer')
    expect(officeAppLabel('calc')).toBe('Calc')
    expect(officeAppLabel('impress')).toBe('Impress')
    expect(defaultExtensionFor('writer')).toBe('docx')
    expect(defaultExtensionFor('calc')).toBe('xlsx')
    expect(defaultExtensionFor('impress')).toBe('pptx')
  })
})
