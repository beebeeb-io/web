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

export function escapeRe(s: string) {
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

/** The virtualized drive-list scroll container (file-list.tsx's `role="rowgroup"`
 *  div — `@tanstack/react-virtual`'s `getScrollElement()` target). */
export function fileListScrollContainer(page: Page) {
  return page.getByRole('rowgroup', { name: 'Files and folders' })
}

/**
 * Instantly (no waiting — pure `isVisible()` checks, which never auto-wait)
 * dismisses any first-run overlay that is CURRENTLY showing and would sit
 * on top of / interfere with the drive: the 3-step `<OnboardingTour>`
 * spotlight ("Upload your first file" / "Share securely" / "Get the iOS
 * app" — its "Skip tour" ghost button text is constant across all 3 steps,
 * see src/components/onboarding-tour.tsx) and the post-signup email
 * verification banner.
 *
 * Root-caused live for task 1565 (debug repro #3, screenshot evidence): the
 * onboarding tour is keyed off `[data-tour="upload"]` existing in the DOM,
 * which is ALWAYS true regardless of how many files already exist — it is
 * NOT automatically dismissed by the user having already uploaded files,
 * only by clicking through it once (which sets `beebeeb.onboarding.done` in
 * localStorage) or on Escape. A single one-shot dismissal attempt right
 * after signup (`dismissFirstRunOverlays` in the spec) can miss it under
 * load if the server's onboarding-state fetch + the component's own 600ms
 * mount delay together exceed that attempt's timeout — and once missed, it
 * stays un-dismissed (never markDone()'d) and remounts on every
 * `page.reload()` `uploadAndWait` does, for the rest of the run. This sweep
 * is cheap enough (near-zero cost when nothing is showing — `isVisible()`
 * never blocks) to call on every fixture iteration as a second, unconditional
 * line of defense instead of trusting a single early-timing-dependent catch.
 */
export async function sweepBlockingOverlaysFast(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: 'Skip tour' }),
    page.getByRole('button', { name: 'Dismiss verification banner' }),
  ]
  for (const loc of candidates) {
    if (await loc.first().isVisible().catch(() => false)) {
      await loc.first().click().catch(() => {})
    }
  }
}

/**
 * Waits for `base`'s row to be ATTACHED to the DOM, scrolling the virtualized
 * drive list to reveal it first if needed.
 *
 * file-list.tsx renders the drive with `@tanstack/react-virtual`: only rows
 * inside the current scroll position's visible window + a small overscan (8)
 * are ever mounted in the DOM — everything else genuinely does not exist as
 * a DOM node, it is not merely off-screen/clipped. A plain
 * `page.getByRole('row', { name }).waitFor()` has no way to know a row is
 * virtualized out rather than simply not-yet-rendered, so it just times out
 * at whatever timeout it was given.
 *
 * Root-caused live for task 1565: on a fresh 1280×720 Playwright viewport,
 * exactly 15 rows fit in the mounted window (≈7 visible at the default
 * 72px row height + 8 overscan, scrollTop 0). A drive with 15 files has
 * every row attached; the 16th file's row is appended past that window and
 * is NOT in the DOM until the container is scrolled — confirmed with a
 * throwaway repro spec that dumped `scrollHeight`/`clientHeight`/row count
 * right up to the failure: `{"totalRowsInDom":15,...,"scrollHeight":1264,
 * "clientHeight":520}` on fixture #15, then fixture #16's row never
 * attached and `uploadAndWait`'s own `.waitFor()` timed out at exactly the
 * default 30s. This is what previously misclassified the whole `code/`
 * category onward as a preview outcome of `'no-overlay'` in
 * `1565-preview-matrix.matrix.ts` — the file's actual preview was never even
 * attempted; the row it needed to double-click did not exist yet.
 *
 * Fix: scroll the list's own scroll container top→bottom in
 * `clientHeight`-sized steps (not assuming the target row sorts to any
 * particular position — a caller elsewhere in this suite may not use a
 * strictly-ascending name), re-checking for the row after each step, until
 * it attaches or the container bottoms out. For small lists (the common
 * case for every OTHER spec using `uploadAndWait`/`openPreview`) the row is
 * already attached and this returns on the very first (zero-cost) check.
 */
export async function scrollUntilRowAttached(
  page: Page,
  base: string,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const debug = !!process.env.BB_DEBUG_SCROLL
  await sweepBlockingOverlaysFast(page)
  const row = page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first()
  if ((await row.count()) > 0) return true

  const container = fileListScrollContainer(page).first()
  const start = Date.now()
  let didReset = false
  // Root-caused live (task 1565, debug repro #3): right after uploadAndWait's
  // `page.reload()`, `document.body.dataset.cryptoReady === 'true'` only means
  // the WASM crypto module is up — the file list itself may still be showing
  // its loading skeleton or be mid-fetch for another instant. A ONE-SHOT
  // "does the rowgroup exist yet?" check caught the app in that transient
  // window, saw containerCount=0, and bailed out immediately without ever
  // attempting to scroll — so the caller's own subsequent `.waitFor()` was
  // doomed before it started for any row past the virtualized window. Treat
  // "container not mounted yet" the same as "row not attached yet": keep
  // retrying within the same budget instead of giving up on the first look.
  while (Date.now() - start < timeoutMs) {
    if ((await row.count()) > 0) return true
    await sweepBlockingOverlaysFast(page)
    const containerCount = await container.count().catch(() => 0)
    if (debug) console.log(`[scrollDebug] ${base}: containerCount=${containerCount}`)
    if (containerCount === 0) {
      await page.waitForTimeout(150)
      continue
    }
    if (!didReset) {
      await container.evaluate((el) => { el.scrollTop = 0 }).catch(() => {})
      didReset = true
      await page.waitForTimeout(120)
      if ((await row.count()) > 0) return true
    }
    const step = await container
      .evaluate((el) => {
        const before = el.scrollTop
        el.scrollTop = Math.min(el.scrollTop + el.clientHeight, el.scrollHeight)
        return { atBottom: el.scrollTop === before, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
      })
      .catch((e) => {
        if (debug) console.log(`[scrollDebug] ${base}: evaluate threw: ${e instanceof Error ? e.message.slice(0, 150) : String(e)}`)
        return { atBottom: true, scrollTop: -1, scrollHeight: -1, clientHeight: -1 }
      })
    if (debug) console.log(`[scrollDebug] ${base}: ${JSON.stringify(step)}`)
    await page.waitForTimeout(150)
    if ((await row.count()) > 0) return true
    if (step.atBottom) {
      // Bottomed out without finding it. The list may still be growing
      // (another upload's reload hasn't landed) — reset to top and keep
      // trying within the remaining budget rather than give up immediately.
      didReset = false
    }
  }
  return (await row.count()) > 0
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
  // The drive row renders optimistically right after uploads/init — BEFORE the
  // chunk PUTs and POST /uploads/{id}/complete. For a non-image nothing else
  // below waits for the upload to finish, so the reload further down aborted
  // the in-flight /complete and left the file pending: every later
  // GET /files/{id}/download answered 409 Conflict (seen in the
  // preview-crypto-rail trace: complete status -1, download 409). Wait for the
  // server to accept /complete before touching the page.
  const uploadCompleted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/v1\/uploads\/[^/]+\/complete$/.test(r.url()) && r.ok(),
    { timeout: 30_000 },
  )
  await page.locator('input[type="file"]').first().setInputFiles(filePath)
  // Scroll the (possibly virtualized) list to reveal the new row before
  // waiting for it — see scrollUntilRowAttached's own doc comment for why a
  // plain waitFor() alone is not sufficient once the drive holds enough
  // files that the list no longer fits in one screenful.
  await scrollUntilRowAttached(page, base)
  await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().waitFor({ timeout: 30_000 })
  await uploadCompleted
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
  // A reload remounts the virtualizer at scrollTop 0 — the same "row may not
  // be in the mounted window" gap as the pre-reload wait above applies here
  // too, independently (this is the exact call site that actually threw in
  // the live repro for task 1565: 15 rows fit post-reload, the 16th did not).
  await scrollUntilRowAttached(page, base)
  await page.getByRole('row', { name: new RegExp(escapeRe(base)) }).first().waitFor({ timeout: 30_000 })
  // listFiles carries has_large_thumbnail (sync omits it) — make sure it has
  // landed so the gate sees the flag before we open the preview.
  await listRefreshed
  return base
}

/** Open a file's preview by double-clicking its row, then wait for the preview
 *  chrome to mount (the absolute inset-0 z-30 overlay is unique to it). */
export async function openPreview(page: Page, base: string) {
  await scrollUntilRowAttached(page, base)
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
