/**
 * Blank file bytes for Drive's "+ New" menu (task 1582).
 *
 * Office types: real blank documents written by LibreOffice itself
 * ("File > New" then "Save as" with the same export filters our WASM fork
 * runs), regenerated with scripts/generate-blank-office-files.py and shipped
 * as base64 in ./blank-documents.generated.ts. Lazy-imported, so the ~60 KB
 * only loads when someone actually creates a document. test/1582-blank-
 * documents.test.ts validates these exact bytes (zip structure,
 * [Content_Types].xml, the officeDocument relationship, ODF's stored
 * `mimetype` entry, no author in docProps).
 *
 * Why not the engine: making an empty file would mean booting the ~55 MB
 * engine inside Drive, and would tie creating a file to the Labs-gated
 * editor bundle. Why not hand-written XML: a minimal .pptx needs a slide
 * master, layout and theme to open in PowerPoint; LibreOffice's own output
 * already has them and is what our editor round-trips.
 *
 * Text types start empty: the text editor (task 1563) is what fills them.
 */

import type { NewDocumentType } from '../new-document'

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function blankDocumentBytes(type: NewDocumentType): Promise<Uint8Array> {
  if (type.editor === 'text') return new Uint8Array(0)
  const { BLANK_DOCUMENTS_BASE64 } = await import('./blank-documents.generated')
  const b64 = BLANK_DOCUMENTS_BASE64[type.ext]
  if (!b64) throw new Error(`no blank document shipped for .${type.ext}`)
  return decodeBase64(b64)
}
