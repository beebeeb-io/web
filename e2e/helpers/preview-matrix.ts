import { type Page, type Locator } from '@playwright/test'
import path from 'path'
import { scrollUntilRowAttached } from './thumb-fixtures'

export const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures', 'preview-matrix')

/**
 * Outcome buckets a preview can land in — mirrors task 1565's own three
 * honest outcomes plus the two FAIL states:
 *   - 'render'        content actually renders (image/video/audio/iframe-with-
 *                      content/text-table/markdown)
 *   - 'cant-preview'   the honest "Preview not available for this file type"
 *                      card (file-preview.tsx's own fallback OR
 *                      UnsupportedPreview, both read the same to a user)
 *   - 'spinner'        FAIL — a loading/converting spinner never resolved
 *   - 'blank'          FAIL — the overlay mounted but shows nothing at all
 *   - 'no-overlay'     FAIL (harness) — the preview never opened
 */
export type Outcome = 'render' | 'cant-preview' | 'spinner' | 'blank' | 'no-overlay'

export interface FixtureCase {
  /** Path relative to e2e/fixtures/preview-matrix/ */
  rel: string
  category: string
  ext: string
  /** Ground-truth prediction from reading src/components/preview/file-preview.tsx
   *  (pickRenderer) and src/lib/preview.ts BEFORE running anything — see the
   *  task file's "Expected results" table. */
  expected: 'render' | 'cant-preview'
  notes: string
}

export const FIXTURES: FixtureCase[] = [
  // ── Office ──────────────────────────────────────────────────────────────
  { rel: 'office/sample.docx', category: 'office', ext: 'docx', expected: 'render', notes: 'DocxPreview (mammoth)' },
  { rel: 'office/sample.doc', category: 'office', ext: 'doc', expected: 'cant-preview', notes: 'legacy .doc — no handling in pickRenderer, generic fallback' },
  { rel: 'office/sample.xlsx', category: 'office', ext: 'xlsx', expected: 'render', notes: 'XlsxPreview (SheetJS)' },
  { rel: 'office/sample.xls', category: 'office', ext: 'xls', expected: 'cant-preview', notes: 'legacy .xls — no handling in pickRenderer, generic fallback' },
  { rel: 'office/sample.pptx', category: 'office', ext: 'pptx', expected: 'cant-preview', notes: 'PPTX_EXTS → UnsupportedPreview by design (download-only card)' },
  { rel: 'office/sample.ppt', category: 'office', ext: 'ppt', expected: 'cant-preview', notes: 'PPTX_EXTS includes legacy .ppt → UnsupportedPreview by design' },

  // ── Text ────────────────────────────────────────────────────────────────
  { rel: 'text/sample.txt', category: 'text', ext: 'txt', expected: 'render', notes: 'TEXT_EXTENSIONS → TextPreview (plain)' },
  { rel: 'text/sample.md', category: 'text', ext: 'md', expected: 'render', notes: 'MarkdownPreview' },
  { rel: 'text/sample.csv', category: 'text', ext: 'csv', expected: 'render', notes: 'TEXT_EXTENSIONS → TextPreview (plain)' },
  { rel: 'text/sample.tsv', category: 'text', ext: 'tsv', expected: 'render', notes: 'TEXT_EXTENSIONS → TextPreview (plain)' },
  { rel: 'text/sample.json', category: 'text', ext: 'json', expected: 'render', notes: 'EXT_LANGUAGE(json) → TextPreview (code)' },
  { rel: 'text/sample.yaml', category: 'text', ext: 'yaml', expected: 'render', notes: 'EXT_LANGUAGE(yaml) → TextPreview (code)' },
  { rel: 'text/sample.xml', category: 'text', ext: 'xml', expected: 'render', notes: 'EXT_LANGUAGE(xml) → TextPreview (code)' },
  { rel: 'text/sample.html', category: 'text', ext: 'html', expected: 'render', notes: 'EXT_LANGUAGE(html) → TextPreview (rendered iframe / source toggle)' },
  { rel: 'text/sample.log', category: 'text', ext: 'log', expected: 'render', notes: 'TEXT_EXTENSIONS → TextPreview (plain)' },

  // ── Code ────────────────────────────────────────────────────────────────
  { rel: 'code/sample.py', category: 'code', ext: 'py', expected: 'render', notes: 'EXT_LANGUAGE(py)' },
  { rel: 'code/sample.go', category: 'code', ext: 'go', expected: 'render', notes: 'EXT_LANGUAGE(go)' },
  { rel: 'code/sample.rs', category: 'code', ext: 'rs', expected: 'render', notes: 'EXT_LANGUAGE(rs)' },
  { rel: 'code/sample.ts', category: 'code', ext: 'ts', expected: 'render', notes: 'EXT_LANGUAGE(ts)' },
  { rel: 'code/sample.tsx', category: 'code', ext: 'tsx', expected: 'render', notes: 'EXT_LANGUAGE(tsx)' },
  { rel: 'code/sample.js', category: 'code', ext: 'js', expected: 'render', notes: 'EXT_LANGUAGE(js)' },
  { rel: 'code/sample.java', category: 'code', ext: 'java', expected: 'render', notes: 'EXT_LANGUAGE(java)' },
  { rel: 'code/sample.kt', category: 'code', ext: 'kt', expected: 'render', notes: 'EXT_LANGUAGE(kt)' },
  { rel: 'code/sample.swift', category: 'code', ext: 'swift', expected: 'render', notes: 'EXT_LANGUAGE(swift)' },
  { rel: 'code/sample.c', category: 'code', ext: 'c', expected: 'render', notes: 'EXT_LANGUAGE(c)' },
  { rel: 'code/sample.cpp', category: 'code', ext: 'cpp', expected: 'render', notes: 'EXT_LANGUAGE(cpp)' },
  { rel: 'code/sample.h', category: 'code', ext: 'h', expected: 'render', notes: 'EXT_LANGUAGE(h)' },
  {
    rel: 'code/sample.cs', category: 'code', ext: 'cs', expected: 'render',
    notes: 'C# — NOT in EXT_LANGUAGE before this task\'s fix (bug: fixed in file-preview.tsx, see commit)',
  },
  { rel: 'code/sample.rb', category: 'code', ext: 'rb', expected: 'render', notes: 'EXT_LANGUAGE(rb)' },
  { rel: 'code/sample.php', category: 'code', ext: 'php', expected: 'render', notes: 'EXT_LANGUAGE(php)' },
  { rel: 'code/sample.sh', category: 'code', ext: 'sh', expected: 'render', notes: 'EXT_LANGUAGE(sh)' },
  { rel: 'code/sample.sql', category: 'code', ext: 'sql', expected: 'render', notes: 'EXT_LANGUAGE(sql)' },
  { rel: 'code/sample.css', category: 'code', ext: 'css', expected: 'render', notes: 'EXT_LANGUAGE(css)' },
  { rel: 'code/sample.toml', category: 'code', ext: 'toml', expected: 'render', notes: 'EXT_LANGUAGE(toml)' },
  { rel: 'code/sample.ini', category: 'code', ext: 'ini', expected: 'render', notes: 'TEXT_EXTENSIONS(ini) → plain text' },
  {
    rel: 'code/Dockerfile', category: 'code', ext: '(none)', expected: 'render',
    notes: 'bare "Dockerfile" filename, no extension — NOT matched before this task\'s fix (bug: fixed in file-preview.tsx, see commit)',
  },

  // ── Images ──────────────────────────────────────────────────────────────
  { rel: 'images/sample.png', category: 'image', ext: 'png', expected: 'render', notes: 'ImagePreview' },
  { rel: 'images/sample.jpg', category: 'image', ext: 'jpg', expected: 'render', notes: 'ImagePreview' },
  { rel: 'images/sample.gif', category: 'image', ext: 'gif', expected: 'render', notes: 'ImagePreview (animated)' },
  { rel: 'images/sample.webp', category: 'image', ext: 'webp', expected: 'render', notes: 'ImagePreview' },
  { rel: 'images/sample.bmp', category: 'image', ext: 'bmp', expected: 'render', notes: 'ImagePreview' },
  {
    rel: 'images/sample.tiff', category: 'image', ext: 'tiff', expected: 'render',
    notes: 'Task 1574: TiffPreview decodes off the main thread (Web Worker, utif2) to a PNG blob, then delegates to ImagePreview — Chromium itself still has no native TIFF codec (task 1565 finding, why the old plain <img> path failed), so this is a real decode, not a workaround of that finding.',
  },
  { rel: 'images/sample.svg', category: 'image', ext: 'svg', expected: 'render', notes: 'ImagePreview (native <img>, no WebView — unlike mobile task 1564)' },
  { rel: 'images/sample.heic', category: 'image', ext: 'heic', expected: 'render', notes: 'HeicPreview (WASM decode) or honest fallback if decode fails' },
  { rel: 'images/sample.heif', category: 'image', ext: 'heif', expected: 'render', notes: 'HeicPreview (WASM decode) or honest fallback if decode fails' },

  // ── RAW ─────────────────────────────────────────────────────────────────
  // Task 1574: RawPreview no longer uses exifr.thumbnail() at all (it found
  // a usable preview for only 2 of these 6 real fixtures — CR2/ARW).
  // Ported mobile's task-1569 approach instead (a Web Worker scans the raw
  // bytes for the largest embedded SOI…EOI JPEG span, bounded to the first
  // 32MB): verified directly against these exact 6 fixtures before writing
  // these expectations — every one has a real, correctly-oriented,
  // correctly-dimensioned embedded preview findable this way (confirmed via
  // macOS `sips` against the extracted bytes; dimensions matched mobile's
  // own fixture dimensions exactly for DNG/CR3/ARW/NEF/RAF, same
  // raw.pixls.us source files). All 6 now render.
  { rel: 'raw/sample.dng', category: 'raw', ext: 'dng', expected: 'render', notes: 'RawPreview: embedded-JPEG byte scan (task 1574) finds a real 3960×2640 preview' },
  { rel: 'raw/sample.nef', category: 'raw', ext: 'nef', expected: 'render', notes: 'RawPreview: embedded-JPEG byte scan (task 1574) finds a real 570×375 preview' },
  { rel: 'raw/sample.cr2', category: 'raw', ext: 'cr2', expected: 'render', notes: 'RawPreview: embedded-JPEG byte scan (task 1574) finds a real 1936×1288 preview (already rendered before this task, via exifr)' },
  { rel: 'raw/sample.cr3', category: 'raw', ext: 'cr3', expected: 'render', notes: 'RawPreview: embedded-JPEG byte scan (task 1574) finds a real 3408×2272 preview — exifr could not (CR3\'s ISO-BMFF container isn\'t a format it recognizes as a top-level file at all)' },
  { rel: 'raw/sample.arw', category: 'raw', ext: 'arw', expected: 'render', notes: 'RawPreview: embedded-JPEG byte scan (task 1574) finds a real 1616×1080 preview (already rendered before this task, via exifr)' },
  { rel: 'raw/sample.raf', category: 'raw', ext: 'raf', expected: 'render', notes: 'RawPreview: embedded-JPEG byte scan (task 1574) finds a real 1280×960 preview — exifr could not (RAF\'s proprietary layout isn\'t a format it recognizes as a top-level file at all)' },

  // ── PDF ─────────────────────────────────────────────────────────────────
  { rel: 'pdf/sample.pdf', category: 'pdf', ext: 'pdf', expected: 'render', notes: 'PdfPreview (native PDFium iframe)' },

  // ── Media ───────────────────────────────────────────────────────────────
  { rel: 'media/sample.mp4', category: 'media', ext: 'mp4', expected: 'render', notes: 'VideoPreview' },
  { rel: 'media/sample.mov', category: 'media', ext: 'mov', expected: 'render', notes: 'VideoPreview (HEVC — Chromium codec support not guaranteed)' },
  { rel: 'media/sample.mp3', category: 'media', ext: 'mp3', expected: 'render', notes: 'AudioPreview' },
  { rel: 'media/sample.m4a', category: 'media', ext: 'm4a', expected: 'render', notes: 'AudioPreview' },
  { rel: 'media/sample.wav', category: 'media', ext: 'wav', expected: 'render', notes: 'AudioPreview' },

  // ── Archive / binary ────────────────────────────────────────────────────
  { rel: 'archive/sample.zip', category: 'archive', ext: 'zip', expected: 'render', notes: 'Task 1574: ZipListingPreview reads a file listing (names/sizes/folders) from the archive\'s own Central Directory — no extraction, no decompression' },
  { rel: 'binary/sample.bin', category: 'binary', ext: 'bin', expected: 'cant-preview', notes: 'honest fallback by design' },
]

/** The overlay mounted by PreviewChrome (absolute inset-0 z-30). */
export function previewOverlay(page: Page): Locator {
  return page.locator('.absolute.inset-0.z-30')
}

/**
 * Classify the CURRENT state of an open preview overlay into one of the
 * Outcome buckets. Pure DOM inspection — no knowledge of which fixture is
 * open — so the same function verifies every row of the matrix identically.
 */
export async function classifyOutcome(page: Page): Promise<{ outcome: Outcome; detail: string }> {
  return page.evaluate(() => {
    const overlay = document.querySelector('.absolute.inset-0.z-30')
    if (!overlay) return { outcome: 'no-overlay' as const, detail: 'overlay not mounted' }

    const text = (overlay.textContent || '').replace(/\s+/g, ' ').trim()

    // Honest can't-preview card — either file-preview.tsx's own generic
    // fallback or UnsupportedPreview's copy both say this exact phrase.
    if (/Preview not available for this file type/.test(text)) {
      return { outcome: 'cant-preview' as const, detail: text.slice(0, 160) }
    }

    // A real, decoded, non-empty <img> (blob: URL from any image-ish renderer:
    // ImagePreview, HeicPreview success, or RawPreview's embedded-thumbnail
    // success — all three render the same way).
    const img = overlay.querySelector('img[src^="blob:"]') as HTMLImageElement | null
    if (img) {
      // naturalWidth can still be 0 for a split second while decoding —
      // callers already waited for 'load' via Playwright before classifying,
      // but guard here too so a genuinely broken image doesn't false-PASS.
      if (img.complete && img.naturalWidth > 0) {
        return { outcome: 'render' as const, detail: `img ${img.naturalWidth}x${img.naturalHeight}` }
      }
      // Image element present but not yet decoded / broken — caller should
      // have waited; report as spinner-ish so it's investigated, not silently
      // marked blank.
      return { outcome: 'spinner' as const, detail: 'img present but not decoded (broken or still loading)' }
    }

    const video = overlay.querySelector('video') as HTMLVideoElement | null
    if (video && video.getAttribute('src')) {
      return { outcome: 'render' as const, detail: `video readyState=${video.readyState}` }
    }

    const audio = overlay.querySelector('audio') as HTMLAudioElement | null
    if (audio && audio.getAttribute('src')) {
      return { outcome: 'render' as const, detail: `audio readyState=${audio.readyState}` }
    }

    // PDF: iframe pointed at a blob: URL (the decrypted PDF itself).
    const pdfIframe = overlay.querySelector('iframe[src^="blob:"]') as HTMLIFrameElement | null
    if (pdfIframe) {
      return { outcome: 'render' as const, detail: 'pdf iframe with blob: src' }
    }

    // DOCX / XLSX: the shared PreviewBanner only mounts once mammoth/SheetJS
    // has actually produced content (it's absent during the "Rendering…"
    // spinner and the error card shows different copy).
    if (/Preview — some formatting may differ from the original/.test(text)) {
      return { outcome: 'render' as const, detail: 'office PreviewBanner + iframe present' }
    }
    if (/Could not render this (document|spreadsheet)/.test(text)) {
      return { outcome: 'blank' as const, detail: text.slice(0, 160) }
    }

    // HTML "Rendered" mode: a titled iframe with non-trivial srcdoc content.
    const htmlIframe = overlay.querySelector('iframe[title="HTML preview"]') as HTMLIFrameElement | null
    if (htmlIframe && (htmlIframe.getAttribute('srcdoc') || '').length > 20) {
      return { outcome: 'render' as const, detail: 'html rendered iframe with srcdoc content' }
    }

    // Text / code (TextPreview's line-table) or Markdown — both put real
    // decrypted content directly in the light DOM (no iframe).
    const table = overlay.querySelector('table')
    if (table && table.querySelectorAll('tr').length > 0 && table.textContent && table.textContent.trim().length > 0) {
      return { outcome: 'render' as const, detail: `text table, ${table.querySelectorAll('tr').length} rows` }
    }
    const markdownHeading = overlay.querySelector('h1, h2, h3, p')
    if (markdownHeading && markdownHeading.textContent && markdownHeading.textContent.trim().length > 0) {
      return { outcome: 'render' as const, detail: 'markdown heading/paragraph content' }
    }

    // Still loading — every renderer's own spinner copy.
    if (/Decrypting\.\.\.|Rendering document|Rendering spreadsheet|Extracting preview|Loading highlighter|Decoding .* for playback|Decoding TIFF|Reading archive/.test(text)) {
      return { outcome: 'spinner' as const, detail: text.slice(0, 160) }
    }

    return { outcome: 'blank' as const, detail: text ? text.slice(0, 160) : '(empty overlay)' }
  })
}

/**
 * Double-click `rowName`'s row and wait for EITHER the preview overlay to
 * mount OR the toast (`role="alert"`) file-list.tsx's own onDoubleClick
 * fires when `isPreviewable()` says no BEFORE ever opening one ("This file
 * type can't be previewed ... Use Open to download it", src/components/
 * file-list.tsx). Found live running the full matrix: legacy .doc/.ppt and
 * .zip correctly fail `isPreviewable` by design (pickRenderer has no
 * renderer for any of them either) — for those, NO overlay EVER appears,
 * and the shared thumb-fixtures.ts `openPreview` (which unconditionally
 * waits 15s for the overlay) throws, aborting the whole spec run with no
 * per-fixture resilience. The toast is an equally HONEST "can't preview
 * this" signal — just delivered without an overlay — so it resolves to the
 * same 'cant-preview' outcome bucket, not a FAIL.
 */
export async function openPreviewOrToast(
  page: Page,
  rowName: string,
  timeoutMs = 15_000,
): Promise<{ opened: boolean; toastText?: string }> {
  // See scrollUntilRowAttached's doc comment (thumb-fixtures.ts) — this was
  // the actual root cause of every fixture from the `code/` category onward
  // reporting a false 'no-overlay' in this matrix: the drive list is
  // virtualized (@tanstack/react-virtual) and a row appended past the
  // current visible+overscan window genuinely is not in the DOM yet, so the
  // un-scrolled dblclick below just times out waiting for an element that
  // was never going to appear on its own.
  await scrollUntilRowAttached(page, rowName)
  await page.getByRole('row', { name: new RegExp(rowName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().dblclick()
  const overlay = previewOverlay(page).first()
  const toast = page.getByRole('alert').filter({ hasText: /can't be previewed/i })
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await overlay.isVisible().catch(() => false)) return { opened: true }
    if (await toast.first().isVisible().catch(() => false)) {
      const toastText = (await toast.first().textContent().catch(() => null)) ?? 'can\'t be previewed'
      return { opened: false, toastText }
    }
    await page.waitForTimeout(200)
  }
  return { opened: false }
}

/**
 * Poll classifyOutcome() until it settles on something other than
 * 'no-overlay' (the overlay opening) — but do NOT resolve on 'spinner': a
 * spinner that is still there after the full budget IS the FAIL we're
 * testing for, so it must be returned, not retried past.
 */
export async function waitForOutcome(page: Page, timeoutMs = 25_000): Promise<{ outcome: Outcome; detail: string }> {
  const start = Date.now()
  let last: { outcome: Outcome; detail: string } = { outcome: 'no-overlay', detail: '' }
  while (Date.now() - start < timeoutMs) {
    last = await classifyOutcome(page)
    // Only 'render' / 'cant-preview' are terminal-good states — resolve
    // immediately. 'spinner' keeps polling by definition. 'blank' ALSO keeps
    // polling here rather than failing on the first sighting: several
    // renderers (MarkdownPreview, TextPreview) return `null` for one React
    // tick between "blob decrypted" and "async blob.text() resolved", which
    // reads as a momentarily-empty overlay and is NOT the bug this task is
    // hunting for. Only a 'blank' that is STILL blank when the timeout
    // expires is the real FAIL (see the loop's final return below).
    if (last.outcome === 'render' || last.outcome === 'cant-preview') {
      return last
    }
    await page.waitForTimeout(300)
  }
  return last // whatever it settled on last — 'spinner'/'blank'/'no-overlay' is the FAIL
}
