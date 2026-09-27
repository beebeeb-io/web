/**
 * Task 1584 — "a .docx renders as garbage text on iPhone Safari" (prod, Guus).
 *
 * Runs in three projects (e2e/1584-office-docx-rich.config.ts): Chromium
 * desktop, WebKit iPhone 15 portrait, WebKit iPhone 15 landscape.
 *
 * 1. A richly styled, multi-page .docx (headings, lists, table, image,
 *    embedded font), padded past the 4 MiB chunk size, goes through the real
 *    encrypted upload (asserted: >= 2 chunks) and the real decrypt, and opens
 *    in the real LibreOffice-WASM engine. Asserted: the bytes handed to the
 *    engine start with PK\x03\x04 and carry the .docx name, the loading cover
 *    hides the canvas while the status says "Preparing…", the outline lists
 *    the document's real headings, and the word count is the document's.
 *    Then edit → save as version 2 → reopen in a fresh tab → the saved
 *    document.xml has the edit and the headings.
 * 2. Bytes that are not a Word document (random, like ciphertext) under a
 *    .docx name are refused with a clear message and never reach the engine.
 * 3. An engine host document that arrives damaged (what prod sent iPhone
 *    Safari) is reported within seconds instead of after the boot timeout.
 *
 * What this cannot cover: the root cause was nginx double-encoding the
 * engine bundle (Brotli + gzip), which the Vite dev server never does. That
 * part is test/1584-nginx-office-encoding.test.ts plus the container proof
 * recorded in the task file.
 *
 * Run (private ports):
 *   VITE_FEATURE_OFFICE_EDITOR=true VITE_STATUS_URL=http://localhost:38751 \
 *   E2E_API_PORT=38751 E2E_VITE_PORT=38752 E2E_DB_NAME=beebeeb_web_e2e_1584 \
 *     ./e2e/scripts/web-e2e.sh e2e/1584-office-docx-rich.spec.ts
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { unzipSync } from 'fflate'
import { RICH_DOCX_HEADINGS, writeRichDocxFixture } from './helpers/office-fixtures'

const OFFICE_ASSETS_PRESENT = fs.existsSync('public/office/manifest.json')
const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'
test.skip(!OFFICE_ASSETS_PRESENT, 'public/office/manifest.json missing — run scripts/office-dev-assets.sh first')
test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true — this suite needs the real feature-flagged engine')

const PAD_BYTES = 4 * 1024 * 1024 + 512 * 1024 // > CHUNK_SIZE (4 MiB) → at least 2 chunks

async function dismissDevBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // never appeared
  }
}

/** Runs in every frame; only acts in the engine host document. Records what
 *  bbOffice.open() is actually handed (first bytes, length, filename). */
function recordEngineInput() {
  if (!location.pathname.endsWith('/bb-office-host.html')) return
  const log: Array<Record<string, unknown>> = []
  ;(window as unknown as { __bb1584: unknown }).__bb1584 = log
  let real: Record<string, unknown> | undefined
  Object.defineProperty(window, 'bbOffice', {
    configurable: true,
    get: () => real,
    set(v: Record<string, unknown>) {
      const open = v.open as (b: Uint8Array, n: string) => Promise<unknown>
      v.open = function (bytes: Uint8Array, name: string) {
        const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        log.push({
          first4: Array.from(u8.subarray(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' '),
          length: u8.byteLength,
          filename: name,
        })
        return open.call(this, bytes, name)
      }
      real = v
    },
  })
}

async function prepareContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => localStorage.setItem('bb-office-labs', 'true'))
  await context.addInitScript(recordEngineInput)
}

/** Uploads through the real encrypted path; returns the server's file row. */
async function upload(page: Page, filePath: string): Promise<{ id: string; chunk_count: number }> {
  await page.goto('/')
  await dismissDevBanner(page)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 60_000 })
  const completed = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/v1\/uploads\/[^/]+\/complete$/.test(r.url()) && r.ok(),
    { timeout: 120_000 },
  )
  await page.locator('input[type="file"]').first().setInputFiles(filePath)
  return (await (await completed).json()) as { id: string; chunk_count: number }
}

function engineFrame(page: Page) {
  const f = page.frames().find((fr) => fr.url().includes('bb-office-host.html'))
  if (!f) throw new Error('engine frame not found')
  return f
}

/** Opens /office/<id> in a new tab and waits for the document to be open
 *  (docReady: the status bar leaves "Preparing…" and shows a word count). */
async function openInEditor(context: BrowserContext, fileId: string): Promise<Page> {
  const tab = await context.newPage()
  await tab.goto(`/office/${fileId}`)
  await dismissDevBanner(tab)
  await tab.getByTestId('office-editor').waitFor({ state: 'visible', timeout: 60_000 })
  const status = tab.getByTestId('office-status-bar')
  // While "Preparing…" shows, the engine canvas must be COVERED (task 1584:
  // the undecoded engine document was on screen behind this label, because
  // the loading cover sat underneath the iframe). Checked by hit-testing the
  // middle of the canvas area in the same evaluation that reads the status,
  // so the two cannot disagree; the engine boot takes seconds, so this state
  // is always observable.
  await tab.getByTestId('office-engine-frame-crop').waitFor({ state: 'attached', timeout: 60_000 })
  const cover = await tab.evaluate(() => {
    const statusText = document.querySelector('[data-testid="office-status-bar"]')?.textContent ?? ''
    const crop = document.querySelector('[data-testid="office-engine-frame-crop"]')!.getBoundingClientRect()
    const hit = document.elementFromPoint(crop.left + crop.width / 2, crop.top + crop.height / 2)
    return {
      preparing: statusText.includes('Preparing'),
      hitIsCover: !!hit?.closest('[data-testid="office-loading-thumbnail"]'),
      hit: hit ? `${hit.tagName}[${hit.getAttribute('data-testid') ?? ''}]` : null,
    }
  })
  expect(cover.preparing, 'the editor should still be preparing when the engine frame first mounts').toBe(true)
  expect(cover.hitIsCover, `canvas area must be covered while preparing; top element was ${cover.hit}`).toBe(true)
  await expect(status).toContainText(/\d[\d,]* words/, { timeout: 180_000 })
  await expect(status).not.toContainText('Preparing')
  await expect(tab.getByTestId('office-loading-thumbnail')).toHaveCount(0)
  return tab
}

function readDocumentXml(bytes: Uint8Array): string {
  const xml = unzipSync(bytes)['word/document.xml']
  if (!xml) throw new Error('word/document.xml missing')
  return new TextDecoder().decode(xml)
}

test('rich multi-chunk .docx: real text in the engine, then edit → save → reopen', async ({ page, context }, testInfo) => {
  await prepareContext(context)
  const fixture = writeRichDocxFixture(`rich-1584-${testInfo.project.name}-${process.pid}.docx`, { padBytes: PAD_BYTES })
  expect(fs.statSync(fixture).size).toBeGreaterThan(4 * 1024 * 1024)
  const file = await upload(page, fixture)
  expect(file.chunk_count).toBeGreaterThanOrEqual(2)

  const tab = await openInEditor(context, file.id)
  const engine = engineFrame(tab)

  // What the engine was handed: a zip (PK\x03\x04), the full plaintext, the .docx name.
  const input = (await engine.evaluate(() => (window as unknown as { __bb1584: unknown[] }).__bb1584)) as Array<{ first4: string; length: number; filename: string }>
  expect(input).toHaveLength(1)
  expect(input[0].first4).toBe('50 4b 03 04')
  expect(input[0].length).toBe(fs.statSync(fixture).size)
  expect(input[0].filename).toMatch(/\.docx$/)

  // Real document text: the outline pane lists the document's own headings.
  const outline = tab.getByTestId('office-outline-pane')
  for (const heading of RICH_DOCX_HEADINGS) {
    await expect(outline.getByText(heading, { exact: true })).toBeVisible()
  }
  const stats = (await engine.evaluate(() =>
    (window as unknown as { bbOffice: { getDocStats(): Promise<{ words: number }> } }).bbOffice.getDocStats(),
  )) as { words: number }
  expect(stats.words).toBe(2469) // the fixture's own word count (make-rich-docx.py)
  await tab.screenshot({ path: testInfo.outputPath('opened.png') })

  // Edit: caret to the start of the document, type, save as a new version.
  const typed = `Edited in 1584 ${testInfo.project.name}`
  await tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').click()
  await engine.evaluate(async () => {
    await (window as unknown as { bbOffice: { dispatch(c: string): Promise<unknown> } }).bbOffice.dispatch('.uno:GoToStartOfDoc')
  })
  await tab.keyboard.type(typed, { delay: 30 })
  await expect(tab.getByTestId('office-unsaved-dot')).toBeVisible({ timeout: 15_000 })
  await tab.getByTestId('office-save').click()
  await expect(tab.getByTestId('office-status-saved')).toHaveText(/saved as version 2/, { timeout: 120_000 })
  await tab.close()

  // Reopen in a fresh tab: fresh download, fresh decrypt, fresh engine.
  const tab2 = await openInEditor(context, file.id)
  await expect(tab2.getByTestId('office-outline-pane').getByText('Education', { exact: true })).toBeVisible()
  const savedBytes = (await engineFrame(tab2).evaluate(async () => {
    const bytes = await (window as unknown as { bbOffice: { save(): Promise<Uint8Array> } }).bbOffice.save()
    return Array.from(bytes)
  })) as number[]
  const xml = readDocumentXml(new Uint8Array(savedBytes))
  expect(xml).toContain(typed)
  for (const heading of RICH_DOCX_HEADINGS) expect(xml).toContain(heading)
  await tab2.screenshot({ path: testInfo.outputPath('reopened.png') })
  await tab2.close()
})

test('bytes that are not a Word document are refused with a clear message, never opened', async ({ page, context }, testInfo) => {
  await prepareContext(context)
  const fixture = path.join(os.tmpdir(), `not-a-docx-1584-${testInfo.project.name}-${process.pid}.docx`)
  // High-entropy bytes, like ciphertext that slipped through.
  const junk = new Uint8Array(64 * 1024)
  let x = 0x0badf00d
  for (let i = 0; i < junk.length; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    junk[i] = x & 0xff
  }
  junk[0] = 0x9c // never "PK"
  fs.writeFileSync(fixture, junk)
  const file = await upload(page, fixture)

  const tab = await context.newPage()
  await tab.goto(`/office/${file.id}`)
  await dismissDevBanner(tab)
  const error = tab.getByTestId('office-editor-page-error')
  await expect(error).toBeVisible({ timeout: 60_000 })
  await expect(error).toContainText('This file could not be decrypted or is not a valid Word document.')
  // The engine was never mounted, so nothing could render these bytes.
  await expect(tab.getByTestId('office-engine-frame')).toHaveCount(0)
  await expect(tab.getByTestId('office-editor')).toHaveCount(0)
  await tab.screenshot({ path: testInfo.outputPath('refused.png') })
})

test('a damaged engine document is reported at once, not after the boot timeout', async ({ page, context }, testInfo) => {
  // Replays what iPhone Safari got from prod: the engine host page arriving
  // as bytes that are not our HTML (there, Brotli bytes after Safari undid
  // only the gzip layer). The editor must say so within seconds, not poll
  // for a bridge that cannot appear for the 90 s boot timeout.
  await prepareContext(context)
  const file = await upload(page, writeRichDocxFixture(`damaged-host-1584-${testInfo.project.name}-${process.pid}.docx`))
  const garbage = Buffer.alloc(898)
  let x = 0x51a7e
  for (let i = 0; i < garbage.length; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    garbage[i] = x & 0xff
  }
  await context.route(/\/office\/[^/]+\/bb-office-host\.html$/, (route) =>
    route.fulfill({
      status: 200,
      body: garbage,
      headers: {
        'Content-Type': 'text/html',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    }),
  )
  const tab = await context.newPage()
  await tab.goto(`/office/${file.id}`)
  await dismissDevBanner(tab)
  const t0 = Date.now()
  await expect(tab.getByText("The editor's files did not arrive intact on this device. Reload the page to try again.")).toBeVisible({ timeout: 30_000 })
  expect(Date.now() - t0).toBeLessThan(30_000)
  await expect(tab.getByTestId('office-engine-frame')).toHaveCount(0)
  await expect(tab.getByTestId('office-status-bar')).not.toContainText('Preparing')
  await tab.screenshot({ path: testInfo.outputPath('damaged-host.png') })
})
