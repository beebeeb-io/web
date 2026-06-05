import zlib from 'zlib'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Page } from '@playwright/test'

/** Build a real RGB PNG of the given size (big enough that the client actually
 *  generates medium + large WebP thumbnails — a 1×1 pixel produces none). */
export function writePng(name: string, size = 256): string {
  const w = size
  const h = size
  const raw = Buffer.alloc(h * (1 + w * 3))
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0 // filter byte: none
    for (let x = 0; x < w; x++) {
      raw[o++] = (x * 7 + y * 3) & 0xff
      raw[o++] = (x * 3) & 0xff
      raw[o++] = (y * 5) & 0xff
    }
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(t), 0)
    return Buffer.concat([len, t, crc])
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, png)
  return file
}

export function writeText(name: string, body = 'plain text — no thumbnail\n'): string {
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, body, 'utf-8')
  return file
}

export function writePdf(name: string): string {
  const pdf =
    '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n'
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, pdf, 'latin1')
  return file
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The drive list region (excludes toasts, which also echo the filename). */
export function fileList(page: Page) {
  return page.getByRole('region', { name: 'Drop files here to upload' })
}

/** The open file-preview overlay (absolute inset-0 z-30 chrome). */
export function previewOverlay(page: Page) {
  return page.locator('.absolute.inset-0.z-30')
}

/** The decrypted image rendered inside the preview (a blob: <img>). Scoped to
 *  the overlay so it never matches a drive-row thumbnail (also a blob: img). */
export function previewImage(page: Page) {
  return previewOverlay(page).locator('img[src^="blob:"]')
}

/** Upload via the hidden <input type=file> (bypasses the toolbar button, which
 *  transient toasts can overlap), then wait for the row to appear. */
export async function uploadAndWait(page: Page, filePath: string): Promise<string> {
  const base = path.basename(filePath)
  const isImage = /\.(png|jpe?g|webp|gif|avif)$/i.test(base)
  // The medium+large thumbnail PUTs are best-effort and fire AFTER completeUpload.
  // For an image, wait for the large PUT to land before opening, so the preview's
  // thumbnail-first path finds the variant instead of falling back to a full
  // download. (Set up the listener before the upload so we can't miss it.)
  const largeThumbStored = isImage
    ? page
        .waitForResponse(
          (r) => r.request().method() === 'PUT' && /\/thumbnail\/large/.test(r.url()) && r.ok(),
          { timeout: 30_000 },
        )
        .catch(() => null)
    : Promise.resolve(null)
  await page.locator('input[type="file"]').first().setInputFiles(filePath)
  await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().waitFor({ timeout: 30_000 })
  await largeThumbStored
  // Reload to a STEADY-STATE drive before opening a preview. Immediately after
  // upload the sync stream pushes a create op that re-renders the drive list and
  // aborts an in-flight preview fetch (the upload→instant-preview race tracked in
  // task 0691). A reload loads the drive from a stable snapshot + listFiles, so
  // opening a settled file exercises thumbnail-first deterministically — which is
  // what 0628/0685 assert. (storageState keeps us authed + overlays suppressed.)
  const listRefreshed = page
    .waitForResponse((r) => /\/api\/v1\/files(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.ok(), {
      timeout: 15_000,
    })
    .catch(() => null)
  await page.reload()
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
  await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().waitFor({ timeout: 30_000 })
  // listFiles carries has_large_thumbnail (sync omits it) — make sure it has
  // landed so the gate sees the flag before we open the preview.
  await listRefreshed
  return base
}

/** Open a file's preview by double-clicking its row, then wait for the preview
 *  chrome to mount (the absolute inset-0 z-30 overlay is unique to it). */
export async function openPreview(page: Page, base: string) {
  await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().dblclick()
  await previewOverlay(page).first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** Open an IMAGE preview and wait for the decrypted image to render. On a
 *  steady-state drive (uploadAndWait reloads + waits for the large-thumb PUT)
 *  the thumbnail-first path renders on the first open — no reopen-retry needed,
 *  which also avoids a stray full-download from a second attempt. */
export async function openImagePreview(page: Page, base: string) {
  await openPreview(page, base)
  await previewImage(page).waitFor({ state: 'visible', timeout: 15_000 })
}
