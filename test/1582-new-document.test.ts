import { describe, expect, test } from 'bun:test'
import {
  NEW_DOCUMENT_TYPES,
  checkNewDocumentName,
  defaultNewDocumentName,
  getNewDocumentType,
  uniqueFileName,
  visibleNewDocumentTypes,
} from '../src/lib/new-document'
import { resolveOfficeFileKind } from '../src/lib/office/office-file-kind'

describe('type table', () => {
  test('Labs off: only Text file and Markdown (no office type the app cannot open)', () => {
    expect(visibleNewDocumentTypes(false).map((t) => t.id)).toEqual(['txt', 'md'])
  })

  test('Labs on: Document, Spreadsheet, Presentation, the OpenDocument trio, then text', () => {
    expect(visibleNewDocumentTypes(true).map((t) => t.id)).toEqual(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'txt', 'md'])
  })

  test('every office type routes to the office editor app its extension implies', () => {
    const expected: Record<string, string> = { docx: 'writer', odt: 'writer', xlsx: 'calc', ods: 'calc', pptx: 'impress', odp: 'impress' }
    for (const t of NEW_DOCUMENT_TYPES.filter((x) => x.editor === 'office')) {
      // Both by mime (what the encrypted metadata carries) and by name alone.
      expect(resolveOfficeFileKind(t.mimeType, `x.${t.ext}`)?.app).toBe(expected[t.ext])
      expect(resolveOfficeFileKind(null, `x.${t.ext}`)?.app).toBe(expected[t.ext])
    }
  })

  test('text types never route to the office editor', () => {
    for (const t of NEW_DOCUMENT_TYPES.filter((x) => x.editor === 'text')) {
      expect(resolveOfficeFileKind(t.mimeType, `x.${t.ext}`)).toBeNull()
    }
  })

  test('ids are unique and equal the extension', () => {
    const ids = NEW_DOCUMENT_TYPES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of NEW_DOCUMENT_TYPES) expect(t.id).toBe(t.ext as typeof t.id)
  })
})

describe('uniqueFileName', () => {
  test('free name is returned as-is', () => {
    expect(uniqueFileName('Untitled document.docx', ['Other.docx'])).toBe('Untitled document.docx')
  })

  test('first clash gets " 2" before the extension', () => {
    expect(uniqueFileName('Untitled document.docx', ['Untitled document.docx'])).toBe('Untitled document 2.docx')
  })

  test('skips every taken number', () => {
    expect(
      uniqueFileName('Untitled.md', ['Untitled.md', 'Untitled 2.md', 'Untitled 3.md']),
    ).toBe('Untitled 4.md')
  })

  test('comparison is case-insensitive', () => {
    expect(uniqueFileName('Untitled.md', ['UNTITLED.MD'])).toBe('Untitled 2.md')
  })

  test('case folding does not depend on the locale (Turkish dotted/dotless I)', () => {
    const orig = String.prototype.toLocaleLowerCase
    // Simulate a tr-TR default locale: "I" folds to dotless "ı".
    String.prototype.toLocaleLowerCase = function (this: string) {
      return orig.call(this.replace(/I/g, 'ı'))
    }
    try {
      expect(uniqueFileName('title.docx', ['TITLE.docx'])).toBe('title 2.docx')
      expect(checkNewDocumentName('title', getNewDocumentType('docx'), ['TITLE.docx']).ok).toBe(false)
    } finally {
      String.prototype.toLocaleLowerCase = orig
    }
  })

  test('no extension', () => {
    expect(uniqueFileName('Notes', ['Notes'])).toBe('Notes 2')
  })
})

describe('defaultNewDocumentName', () => {
  test('per-type defaults', () => {
    expect(defaultNewDocumentName(getNewDocumentType('docx'), [])).toBe('Untitled document.docx')
    expect(defaultNewDocumentName(getNewDocumentType('xlsx'), [])).toBe('Untitled spreadsheet.xlsx')
    expect(defaultNewDocumentName(getNewDocumentType('pptx'), [])).toBe('Untitled presentation.pptx')
    expect(defaultNewDocumentName(getNewDocumentType('txt'), [])).toBe('Untitled.txt')
    expect(defaultNewDocumentName(getNewDocumentType('md'), [])).toBe('Untitled.md')
  })

  test('unique in the folder', () => {
    expect(defaultNewDocumentName(getNewDocumentType('xlsx'), ['Untitled spreadsheet.xlsx'])).toBe('Untitled spreadsheet 2.xlsx')
  })
})

describe('checkNewDocumentName', () => {
  const docx = getNewDocumentType('docx')

  test('appends the extension when missing', () => {
    expect(checkNewDocumentName('  Budget ', getNewDocumentType('xlsx'), [])).toEqual({ ok: true, name: 'Budget.xlsx' })
  })

  test('keeps a typed extension (any case)', () => {
    expect(checkNewDocumentName('Plan.DOCX', docx, [])).toEqual({ ok: true, name: 'Plan.DOCX' })
  })

  test('a different extension is kept and the right one appended', () => {
    expect(checkNewDocumentName('notes.txt', docx, [])).toEqual({ ok: true, name: 'notes.txt.docx' })
  })

  test('empty, whitespace or bare extension is refused', () => {
    expect(checkNewDocumentName('   ', docx, []).ok).toBe(false)
    expect(checkNewDocumentName('.docx', docx, []).ok).toBe(false)
    expect(checkNewDocumentName('.DOCX', docx, []).ok).toBe(false)
  })

  test('slashes are refused', () => {
    expect(checkNewDocumentName('a/b', docx, []).ok).toBe(false)
    expect(checkNewDocumentName('a\\b', docx, []).ok).toBe(false)
  })

  test('a clash is reported, never silently renamed', () => {
    const r = checkNewDocumentName('Plan', docx, ['plan.docx'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('already exists')
  })
})
