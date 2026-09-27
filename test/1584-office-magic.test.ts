/**
 * Task 1584 — the office editor's input guards.
 *
 * 1. checkOfficeBytes: the engine only gets bytes whose signature matches the
 *    claimed type (zip for OOXML/ODF, OLE2 for legacy .doc/.xls/.ppt). Anything
 *    else, ciphertext included, is refused with a clear message.
 * 2. inspectHostDocument: the engine iframe's document must be our host page
 *    (it carries the bb-office-api.js script). A damaged one, e.g. the
 *    double-encoded bytes iPhone Safari showed as text, is reported at once.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import path from 'path'
import { checkOfficeBytes, sniffOfficeContainer } from '../src/lib/office/office-magic'
import { inspectHostDocument, DAMAGED_HOST_MESSAGE } from '../src/components/office/office-engine-host'

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])
const RTF = new TextEncoder().encode('{\\rtf1\\ansi hello}')
// What an AES-256-GCM chunk looks like on the wire: a 12-byte nonce, then ciphertext.
const CIPHERTEXT = new Uint8Array([0x9c, 0x3e, 0x71, 0x02, 0xaf, 0x5b, 0x18, 0xe4, 0x6d, 0x21, 0x8a, 0x40, 0x13, 0x77])

describe('sniffOfficeContainer', () => {
  test('recognises zip, OLE2 and RTF signatures', () => {
    expect(sniffOfficeContainer(ZIP)).toBe('zip')
    expect(sniffOfficeContainer(OLE)).toBe('ole')
    expect(sniffOfficeContainer(RTF)).toBe('rtf')
  })
  test('returns null for ciphertext, empty and too-short input', () => {
    expect(sniffOfficeContainer(CIPHERTEXT)).toBeNull()
    expect(sniffOfficeContainer(new Uint8Array())).toBeNull()
    expect(sniffOfficeContainer(new Uint8Array([0x50, 0x4b]))).toBeNull()
  })
})

describe('checkOfficeBytes', () => {
  test('accepts the committed rich fixture as a .docx', () => {
    const fixture = new Uint8Array(readFileSync(path.join(__dirname, '../e2e/fixtures/office/rich-styled.docx')))
    expect(checkOfficeBytes(fixture, 'docx')).toEqual({ ok: true, container: 'zip' })
  })

  test('accepts each modern and legacy format with its own signature', () => {
    for (const ext of ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']) expect(checkOfficeBytes(ZIP, ext).ok).toBe(true)
    for (const ext of ['doc', 'xls', 'ppt']) expect(checkOfficeBytes(OLE, ext).ok).toBe(true)
    expect(checkOfficeBytes(RTF, 'rtf').ok).toBe(true)
  })

  test('refuses ciphertext named .docx, with the Word wording', () => {
    const r = checkOfficeBytes(CIPHERTEXT, 'docx')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toBe('This file could not be decrypted or is not a valid Word document.')
    expect(r.found).toBeNull()
    expect(r.expected).toBe('zip')
    expect(r.firstBytesHex).toBe('9c 3e 71 02 af 5b 18 e4')
  })

  test('refuses a container that does not match the extension', () => {
    const oleAsDocx = checkOfficeBytes(OLE, 'docx')
    expect(oleAsDocx.ok).toBe(false)
    const zipAsXls = checkOfficeBytes(ZIP, 'xls')
    expect(zipAsXls.ok).toBe(false)
    if (!zipAsXls.ok) expect(zipAsXls.message).toBe('This file could not be decrypted or is not a valid Excel spreadsheet.')
    const zipAsRtf = checkOfficeBytes(ZIP, 'rtf')
    expect(zipAsRtf.ok).toBe(false)
  })

  test('uses the right noun per format', () => {
    const msg = (ext: string) => {
      const r = checkOfficeBytes(CIPHERTEXT, ext)
      return r.ok ? '' : r.message
    }
    expect(msg('pptx')).toBe('This file could not be decrypted or is not a valid PowerPoint presentation.')
    expect(msg('odt')).toBe('This file could not be decrypted or is not a valid OpenDocument text document.')
  })

  test('refuses empty bytes', () => {
    expect(checkOfficeBytes(new Uint8Array(), 'docx').ok).toBe(false)
  })

  test('csv has no signature and is not checked', () => {
    expect(checkOfficeBytes(new TextEncoder().encode('a,b\n1,2\n'), 'csv').ok).toBe(true)
  })

  test('an extension known only through the MIME type still needs a zip or OLE container', () => {
    expect(checkOfficeBytes(ZIP, 'bin').ok).toBe(true)
    expect(checkOfficeBytes(OLE, 'bin').ok).toBe(true)
    const r = checkOfficeBytes(CIPHERTEXT, 'bin')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toBe('This file could not be decrypted or is not a valid office document.')
  })
})

function fakeWindow(href: string, scriptSrcs: string[] | 'throws'): Window {
  return {
    location: { href },
    get document() {
      if (scriptSrcs === 'throws') throw new Error('SecurityError')
      return {
        getElementsByTagName: (tag: string) =>
          tag === 'script' ? scriptSrcs.map((src) => ({ getAttribute: (n: string) => (n === 'src' ? src : null) })) : [],
      }
    },
  } as unknown as Window
}

describe('inspectHostDocument', () => {
  test('the real host page (qtloader.js + bb-office-api.js) passes', () => {
    expect(inspectHostDocument(fakeWindow('https://app.beebeeb.io/office/v1/bb-office-host.html', ['', 'qtloader.js', 'bb-office-api.js']))).toBeNull()
  })

  test('a document without the bridge script is reported as damaged', () => {
    // What Safari parsed out of the Brotli bytes: a body of text, no scripts.
    expect(inspectHostDocument(fakeWindow('https://app.beebeeb.io/office/v1/bb-office-host.html', []))).toBe(DAMAGED_HOST_MESSAGE)
    expect(inspectHostDocument(fakeWindow('https://app.beebeeb.io/office/v1/bb-office-host.html', ['qtloader.js']))).toBe(DAMAGED_HOST_MESSAGE)
    expect(inspectHostDocument(fakeWindow('https://app.beebeeb.io/office/v1/bb-office-host.html', ['not-bb-office-api.jsx']))).toBe(DAMAGED_HOST_MESSAGE)
  })

  test('the initial about:blank and an unreadable document are not judged', () => {
    expect(inspectHostDocument(fakeWindow('about:blank', []))).toBeNull()
    expect(inspectHostDocument(fakeWindow('https://elsewhere.example/', 'throws'))).toBeNull()
  })
})
