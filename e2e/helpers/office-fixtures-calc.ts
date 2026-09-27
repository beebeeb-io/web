/**
 * Minimal, hand-built .xlsx fixture generator for the Calc lane's e2e suite
 * (task 1567). Its own file, deliberately not added to
 * `./office-fixtures.ts` (the Writer lane's docx fixture helper) -- avoids a
 * shared-file collision with the Impress lane, which will want its own pptx
 * fixture in the same spot. Mirrors that file's own minimalism: just
 * `fflate` zipping the smallest OOXML SpreadsheetML package LibreOffice will
 * open.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { strToU8, zipSync } from 'fflate'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

/** Builds sheet1.xml with column-A numeric cells A1..An = values[0..n-1]. */
function buildSheetXml(values: number[]): string {
  const rows = values.map((v, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${v}</v></c></row>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows}</sheetData>
</worksheet>`
}

/** Writes a minimal, valid .xlsx fixture (one sheet, column A numeric) to a
 *  temp path and returns it. Defaults to a 3-cell range whose Sum/Average/
 *  Count (60 / 20 / 3) this lane's e2e spec asserts against. */
export function writeXlsxFixture(name: string, values: number[] = [10, 20, 30]): string {
  const zipped = zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
      'xl/worksheets/sheet1.xml': strToU8(buildSheetXml(values)),
    },
    { level: 6 },
  )
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, zipped)
  return file
}
