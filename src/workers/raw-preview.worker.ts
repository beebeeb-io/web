// ─── RAW embedded-preview extraction Web Worker (task 1574) ─────────────────
// Runs the byte scan (and TIFF/EXIF read) off the main thread — a RAW file
// can be tens of MB and scanning it synchronously on the main thread would
// jank the preview overlay's open animation. Exposed via Comlink, same
// convention as crypto.worker.ts.
import * as Comlink from 'comlink'
import {
  findJpegExifTiffOffset,
  findLargestJpegSpan,
  mapExifToRawInfo,
  parseTiffExifTags,
  type RawExifInfo,
} from '../lib/raw-embedded-jpeg'

/**
 * Bounded read cap — this worker NEVER loads a whole RAW file into memory,
 * however large the source is (medium-format RAW can run into the hundreds
 * of MB or more). Verified against this task's own 6 real fixtures
 * (raw.pixls.us CR2/CR3/ARW/NEF/RAF/DNG — see the task file's Notes): every
 * real embedded preview was found well inside the first 1.5MB of the file,
 * so 32MB has wide margin above every real fixture while staying well under
 * this task's own stated ceiling ("never loading 100 MB into memory at
 * once"). A RAW file whose preview genuinely lies past this window is rare
 * enough, and the consequence honest enough (the same "can't preview" card
 * a corrupt file gets), that scanning further is not worth giving up the
 * bound for.
 */
const MAX_RAW_SCAN_BYTES = 32 * 1024 * 1024

export interface RawWorkerResult {
  /** The extracted embedded JPEG as a Blob, ready for an object URL — or
   *  `null` when no plausible embedded preview was found within the bounded
   *  read (a corrupt file, or one whose preview lies past the scan cap). */
  previewBlob: Blob | null
  exif: RawExifInfo | null
}

async function extractRawPreview(blob: Blob): Promise<RawWorkerResult> {
  const scanSize = Math.min(blob.size, MAX_RAW_SCAN_BYTES)
  const buf = await blob.slice(0, scanSize).arrayBuffer()
  const bytes = new Uint8Array(buf)

  const span = findLargestJpegSpan(bytes)
  const previewBlob = span ? new Blob([bytes.slice(span.start, span.end)], { type: 'image/jpeg' }) : null

  // EXIF: the RAW container's own TIFF header first (works for CR2/ARW/
  // NEF/DNG — all TIFF-based at byte 0 — see raw-embedded-jpeg.ts's top
  // comment). CR3's ISO-BMFF box container and RAF's proprietary layout
  // aren't TIFF at the top level, so fall back to the extracted preview
  // JPEG's own Exif segment (recovers real tags for RAF; CR3's embedded
  // preview carries no Exif segment either, in which case this correctly
  // returns null rather than guessing).
  let exifTags = parseTiffExifTags(bytes)
  if (!exifTags && span) {
    const jpegBytes = bytes.subarray(span.start, span.end)
    const tiffOffset = findJpegExifTiffOffset(jpegBytes)
    if (tiffOffset != null) exifTags = parseTiffExifTags(jpegBytes, tiffOffset)
  }

  return { previewBlob, exif: mapExifToRawInfo(exifTags) }
}

const api = { extractRawPreview }
export type RawPreviewWorker = typeof api
Comlink.expose(api)
