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
  await page.locator('input[type="file"]').first().setInputFiles(filePath)
  await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().waitFor({ timeout: 30_000 })
  // Let the post-upload churn settle before opening a preview: the best-effort
  // thumbnail PUTs finish after completeUpload, and the sync stream op triggers
  // a drive list re-render that would otherwise abort the preview's in-flight
  // fetch ("Failed to fetch"). A brief settle makes the open deterministic.
  await page.waitForTimeout(3500)
  return base
}

/** Open a file's preview by double-clicking its row, then wait for the preview
 *  chrome to mount (the absolute inset-0 z-30 overlay is unique to it). */
export async function openPreview(page: Page, base: string) {
  await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().dblclick()
  await previewOverlay(page).first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** Open an IMAGE preview and ensure the decrypted image actually renders.
 *  Right after upload, a sync-stream op can re-render the drive list and abort
 *  the preview's in-flight fetch ("Failed to fetch"); reopening after the churn
 *  settles is deterministic. Retries the open a few times before giving up. */
export async function openImagePreview(page: Page, base: string, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    await openPreview(page, base)
    try {
      await previewImage(page).waitFor({ state: 'visible', timeout: 8_000 })
      return
    } catch {
      if (i === attempts - 1) throw new Error(`image preview never rendered for ${base}`)
      await page.keyboard.press('Escape')
      await previewOverlay(page).first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(2_000)
    }
  }
}
