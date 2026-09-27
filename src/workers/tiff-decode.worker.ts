// ─── TIFF decode Web Worker (task 1574) ──────────────────────────────────────
// Chromium has no native TIFF codec (confirmed live, task 1565 — a real
// .tiff upload left the <img> tag firing 'error' forever). This worker
// decodes the TIFF into raw RGBA pixels using `utif2` (a small, MIT-licensed,
// pure-JS/no-native-deps TIFF decoder — the same family of maintained
// pure-JS decoder this task's brief asked for; chosen over the original
// `utif` because it's the actively maintained fork: 4.1.0/2023 vs upstream's
// 3.1.0/2019, ~2x the weekly npm downloads) and rasterizes it to a PNG blob
// entirely inside the worker via OffscreenCanvas, so the main thread only
// ever receives a small compressed image — never the decoded pixel buffer,
// and never blocks on the decode itself. No network access of any kind:
// `utif2` is a bundled, offline decoder — it reads only the bytes handed to
// it.
import * as Comlink from 'comlink'
import UTIF from 'utif2'

/**
 * Bounded input — this worker will not even ATTEMPT to decode a TIFF larger
 * than this (an honest fallback card instead, same as a genuinely corrupt
 * file), rather than risk hanging the tab on a pathological upload. 64MB
 * covers any realistic uncompressed consumer-camera TIFF export with wide
 * margin.
 */
const MAX_TIFF_INPUT_BYTES = 64 * 1024 * 1024

/**
 * Bounded decode-buffer size. RGBA8 is 4 bytes/pixel, so this caps any ONE
 * pixel buffer at 4 × MAX_TIFF_PIXELS bytes — but the real peak is higher
 * than that single number suggests (Codex review, task 1574 gate,
 * 2026-09-27): utif2's own internal decoded buffer (`ifd.data`, populated by
 * `decodeImage`), the `UTIF.toRGBA8` output (`rgba` below), and the
 * OffscreenCanvas's own backing store can all be alive at the same time —
 * up to 3 same-sized buffers, not 1 (a 4th, the `Uint8ClampedArray` copy
 * `ImageData` needs, is eliminated below via a zero-copy view wherever
 * safe, rather than budgeted for). At the ORIGINAL 64,000,000-pixel cap
 * that was 3 × 256MB ≈ 768MB of peak aggregate — enough to crash the tab on
 * a memory-constrained device instead of hitting the intended honest
 * fallback. Lowered to keep that same 3-buffer peak under ~300MB: 24
 * megapixels (e.g. 6000×4000, already larger than any full-frame consumer
 * camera TIFF export and far above every fixture this task tests against)
 * × 4 bytes × 3 buffers ≈ 288MB.
 */
const MAX_TIFF_PIXELS = 24_000_000

export interface TiffDecodeResult {
  blob: Blob | null
  /** Set only when `blob` is null — a short, non-user-facing diagnostic for
   *  the main thread to log (dedicated-worker `console.error` calls are NOT
   *  visible to a `page.on('console')` listener / most devtools capture
   *  flows, so a real decode failure would otherwise be silent). Never
   *  shown in the UI — the caller still renders the same honest "can't
   *  preview" card either way. */
  error?: string
}

/**
 * Decodes `blob` (TIFF bytes) to a PNG Blob (lossless — TIFF sources are
 * often lossless originals and may carry an alpha channel), or a null blob
 * when the input is empty, over the size/pixel-count bounds above, or fails
 * to decode as a TIFF at all (corrupt file, or a compression scheme this
 * decoder doesn't support) — the caller shows the same honest "can't
 * preview" card any other unsupported type gets.
 */
async function decodeTiffToPng(blob: Blob): Promise<TiffDecodeResult> {
  if (blob.size === 0) return { blob: null, error: 'empty file' }
  if (blob.size > MAX_TIFF_INPUT_BYTES) return { blob: null, error: `over MAX_TIFF_INPUT_BYTES (${blob.size} bytes)` }

  const buf = await blob.arrayBuffer()

  let ifds: ReturnType<typeof UTIF.decode>
  try {
    ifds = UTIF.decode(buf)
  } catch (err) {
    return { blob: null, error: `UTIF.decode threw: ${String(err)}` }
  }
  const ifd = ifds?.[0]
  if (!ifd) return { blob: null, error: `no usable IFD (count=${ifds?.length ?? 0})` }

  // `decode()` alone parses the tag dictionary (t256=ImageWidth,
  // t257=ImageLength — both IFD0 standard tags) but does NOT populate
  // `ifd.width`/`ifd.height`; those are only set as a side effect of
  // `decodeImage()` below. Read the raw tags directly so the pixel-count
  // safety cap can reject an oversized image BEFORE spending a decode on it.
  const rawWidth = Array.isArray(ifd.t256) ? Number(ifd.t256[0]) : undefined
  const rawHeight = Array.isArray(ifd.t257) ? Number(ifd.t257[0]) : undefined
  if (!rawWidth || !rawHeight) return { blob: null, error: 'IFD has no ImageWidth/ImageLength tags' }
  if (rawWidth * rawHeight > MAX_TIFF_PIXELS) {
    return { blob: null, error: `pixel cap exceeded (${rawWidth}x${rawHeight})` }
  }

  try {
    UTIF.decodeImage(buf, ifd, ifds)
  } catch (err) {
    return { blob: null, error: `UTIF.decodeImage threw: ${String(err)}` }
  }
  if (!ifd.width || !ifd.height) {
    return { blob: null, error: `decodeImage did not populate width/height (got ${ifd.width}x${ifd.height})` }
  }
  // Narrowed to plain `number` locals — `ifd.width`/`ifd.height` are typed
  // optional (see utif2.d.ts) since `decode()` alone never sets them; the
  // check above already proved they're populated now.
  const width = ifd.width
  const height = ifd.height

  let rgba: Uint8Array
  try {
    rgba = UTIF.toRGBA8(ifd)
  } catch (err) {
    return { blob: null, error: `UTIF.toRGBA8 threw: ${String(err)}` }
  }
  if (!rgba || rgba.length !== width * height * 4) {
    return { blob: null, error: `rgba length mismatch (got ${rgba?.length}, want ${width * height * 4})` }
  }

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: null, error: 'OffscreenCanvas 2d context unavailable' }

  // `ImageData` needs a plain-`ArrayBuffer`-backed `Uint8ClampedArray` (never
  // `SharedArrayBuffer`). The common case — `rgba` already IS a whole,
  // non-shared `ArrayBuffer` with no offset — can wrap that SAME buffer as a
  // zero-copy view instead of allocating and filling a full duplicate (up to
  // 96MB at this worker's own pixel cap, one of the 3 concurrent
  // same-sized buffers the MAX_TIFF_PIXELS comment above budgets for).
  // `rgba` is never read again after this point, so aliasing it is safe —
  // nothing else in this function still touches its bytes through the
  // original view. Falls back to a defensive copy only if utif2 ever hands
  // back something with an offset or a SharedArrayBuffer backing.
  const clamped =
    rgba.buffer instanceof ArrayBuffer && rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength
      ? new Uint8ClampedArray(rgba.buffer)
      : new Uint8ClampedArray(rgba)
  const imageData = new ImageData(clamped, width, height)
  ctx.putImageData(imageData, 0, 0)
  const pngBlob = await canvas.convertToBlob({ type: 'image/png' })
  return { blob: pngBlob }
}

const api = { decodeTiffToPng }
export type TiffDecodeWorker = typeof api
Comlink.expose(api)
