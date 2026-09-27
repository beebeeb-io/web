/**
 * Task 1582 — the blank documents behind "+ New" are real, valid files.
 * Validates the EXACT bytes the app ships (the base64 module), not just the
 * fixture files on disk, and that the two are identical.
 */
import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { unzipSync } from 'fflate'
import { BLANK_DOCUMENTS_BASE64 } from '../src/lib/office/blank-documents.generated'
import { blankDocumentBytes, decodeBase64 } from '../src/lib/office/blank-documents'
import { NEW_DOCUMENT_TYPES, getNewDocumentType } from '../src/lib/new-document'

const BLANK_DIR = path.join(import.meta.dir, '..', 'src', 'lib', 'office', 'blank')
const td = new TextDecoder()

// OOXML: the main part [Content_Types].xml must declare, and where the
// package relationship must point.
const OOXML: Record<string, { mainPart: string; contentType: string }> = {
  docx: { mainPart: 'word/document.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' },
  xlsx: { mainPart: 'xl/workbook.xml', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' },
  pptx: { mainPart: 'ppt/presentation.xml', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml' },
}

function shipped(ext: string): Uint8Array {
  const b64 = BLANK_DOCUMENTS_BASE64[ext]
  expect(b64).toBeDefined()
  return decodeBase64(b64!)
}

describe('shipped bytes match the committed fixtures', () => {
  for (const t of NEW_DOCUMENT_TYPES.filter((x) => x.editor === 'office')) {
    test(`.${t.ext}`, () => {
      const onDisk = new Uint8Array(fs.readFileSync(path.join(BLANK_DIR, `blank.${t.ext}`)))
      expect(Buffer.from(shipped(t.ext)).equals(Buffer.from(onDisk))).toBe(true)
    })
  }
})

describe('OOXML blanks are valid packages', () => {
  for (const ext of Object.keys(OOXML)) {
    test(`.${ext}: zip, [Content_Types].xml, officeDocument relationship, main part`, () => {
      const bytes = shipped(ext)
      // Local file header signature PK\x03\x04.
      expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
      const files = unzipSync(bytes)
      const ct = files['[Content_Types].xml']
      expect(ct).toBeDefined()
      const ctXml = td.decode(ct)
      expect(ctXml).toContain(`PartName="/${OOXML[ext].mainPart}"`)
      expect(ctXml).toContain(`ContentType="${OOXML[ext].contentType}"`)
      const rels = files['_rels/.rels']
      expect(rels).toBeDefined()
      const relsXml = td.decode(rels)
      const m = relsXml.match(/Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/officeDocument"\s+Target="([^"]+)"|Target="([^"]+)"\s+Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/officeDocument"/)
      expect(m).not.toBeNull()
      const target = (m![1] ?? m![2]).replace(/^\//, '')
      expect(target).toBe(OOXML[ext].mainPart)
      expect(files[target]).toBeDefined()
      expect(files[target].length).toBeGreaterThan(0)
    })
  }

  test('.docx body is empty (no stray text)', () => {
    const xml = td.decode(unzipSync(shipped('docx'))['word/document.xml'])
    expect(xml).not.toMatch(/<w:t[ >]/)
  })

  test('.pptx has exactly one slide', () => {
    const slides = Object.keys(unzipSync(shipped('pptx'))).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    expect(slides).toEqual(['ppt/slides/slide1.xml'])
  })
})

describe('ODF blanks are valid packages', () => {
  for (const ext of ['odt', 'ods', 'odp']) {
    test(`.${ext}: first entry is an uncompressed "mimetype" naming the right type, manifest + content present`, () => {
      const bytes = shipped(ext)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      expect(view.getUint32(0, true)).toBe(0x04034b50)
      expect(view.getUint16(8, true)).toBe(0) // compression method: stored
      const nameLen = view.getUint16(26, true)
      expect(td.decode(bytes.slice(30, 30 + nameLen))).toBe('mimetype')
      const files = unzipSync(bytes)
      expect(td.decode(files['mimetype'])).toBe(getNewDocumentType(ext as 'odt').mimeType)
      expect(files['META-INF/manifest.xml']).toBeDefined()
      expect(files['content.xml']).toBeDefined()
    })
  }
})

describe('privacy: nobody\'s name is baked into the blanks', () => {
  for (const ext of ['docx', 'xlsx', 'pptx']) {
    test(`.${ext} docProps/core.xml has no creator / lastModifiedBy`, () => {
      const core = td.decode(unzipSync(shipped(ext))['docProps/core.xml'])
      expect(core).not.toMatch(/<dc:creator>[^<]+</)
      expect(core).not.toMatch(/<cp:lastModifiedBy>[^<]+</)
    })
  }
  for (const ext of ['odt', 'ods', 'odp']) {
    test(`.${ext} meta.xml has no initial-creator / creator`, () => {
      const meta = td.decode(unzipSync(shipped(ext))['meta.xml'])
      expect(meta).not.toMatch(/<meta:initial-creator>[^<]+</)
      expect(meta).not.toMatch(/<dc:creator>[^<]+</)
    })
  }
})

describe('blankDocumentBytes', () => {
  test('office types return the shipped blank', async () => {
    const bytes = await blankDocumentBytes(getNewDocumentType('xlsx'))
    expect(Buffer.from(bytes).equals(Buffer.from(shipped('xlsx')))).toBe(true)
  })

  test('text types start empty', async () => {
    expect((await blankDocumentBytes(getNewDocumentType('md'))).length).toBe(0)
    expect((await blankDocumentBytes(getNewDocumentType('txt'))).length).toBe(0)
  })
})
