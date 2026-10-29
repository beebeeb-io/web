/**
 * Minimal, hand-built .docx fixture generator for the office editor e2e
 * suite (task 1567). No `docx`/`officegen` dependency — just `fflate`
 * (already a direct dependency, see package.json) zipping the smallest OOXML
 * WordprocessingML package LibreOffice will open: `[Content_Types].xml`,
 * `_rels/.rels`, `word/document.xml` + its own (empty) rels part.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Builds document.xml with one <w:p> per paragraph string. */
function buildDocumentXml(paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`
}

/** Writes a minimal, valid .docx fixture to a temp path and returns it. */
export function writeDocxFixture(name: string, paragraphs: string[] = ['Fixture body text.']): string {
  const zipped = zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'word/document.xml': strToU8(buildDocumentXml(paragraphs)),
      'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS),
    },
    { level: 6 },
  )
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, zipped)
  return file
}

/**
 * .pptx fixture for the Impress lane e2e suite (task 1567). A hand-built
 * minimal OOXML PresentationML package, one .docx generator's boilerplate
 * for pptx, is a much deeper part list (presentation.xml + its own rels,
 * slide master, slide layout, theme, presProps/viewProps/tableStyles —
 * LibreOffice's pptx importer was confirmed, by directly inspecting a real
 * fixture that already opens/edits/saves cleanly in this task's own phase-3
 * round-trip evidence, to tolerate the slide/layout/master parts having NO
 * `_rels` file at all when they declare no relationships of their own).
 * Rather than re-derive and risk a subtly-malformed hand rebuild, this
 * copies that ALREADY-PROVEN-GOOD package's bytes (checked into THIS repo
 * at `e2e/fixtures/office/sample.pptx`, not read from the sibling `office`
 * repo — no cross-repo runtime coupling) to a temp path, matching
 * `writeDocxFixture`'s own signature/behaviour (returns a fs path).
 */
export function writePptxFixture(name: string): string {
  const template = path.join(__dirname, '..', 'fixtures', 'office', 'sample.pptx')
  const file = path.join(os.tmpdir(), name)
  fs.copyFileSync(template, file)
  return file
}

/** Headings in e2e/fixtures/office/rich-styled.docx (see make-rich-docx.py). */
export const RICH_DOCX_TITLE = 'Beebeeb Rich Fixture 1584'
export const RICH_DOCX_HEADINGS = ['Experience', 'Education', 'Skills and Tools', 'Projects', 'References']

/**
 * Task 1584: the committed rich fixture (multi-page, headings, lists, a table,
 * an image and an embedded obfuscated font — e2e/fixtures/office/make-rich-docx.py),
 * optionally padded past the web client's 4 MiB CHUNK_SIZE so the upload and
 * the download both take the multi-chunk path.
 *
 * The padding is one extra package part, `customXml/pad1584.bin`, stored
 * (not deflated) and filled from a fixed-seed PRNG so it cannot compress. It
 * is not referenced by any relationship, so Word and LibreOffice ignore it;
 * it only makes the encrypted file span several chunks. Written to a temp
 * path, like the other helpers here.
 */
export function writeRichDocxFixture(name: string, opts: { padBytes?: number } = {}): string {
  const source = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'office', 'rich-styled.docx'))
  const file = path.join(os.tmpdir(), name)
  if (!opts.padBytes) {
    fs.writeFileSync(file, source)
    return file
  }
  const parts = unzipSync(new Uint8Array(source))
  const pad = new Uint8Array(opts.padBytes)
  let x = 0x1584abcd
  for (let i = 0; i < pad.length; i++) {
    // xorshift32 — deterministic, incompressible enough for a stored part.
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    pad[i] = x & 0xff
  }
  const contentTypes = new TextDecoder().decode(parts['[Content_Types].xml'])
  const zippable: Zippable = {}
  for (const [partName, data] of Object.entries(parts)) {
    zippable[partName] =
      partName === '[Content_Types].xml' && !contentTypes.includes('Extension="bin"')
        ? strToU8(contentTypes.replace('<Default ', '<Default Extension="bin" ContentType="application/octet-stream"/><Default '))
        : data
  }
  zippable['customXml/pad1584.bin'] = [pad, { level: 0 }]
  fs.writeFileSync(file, zipSync(zippable, { level: 6 }))
  return file
}
