/**
 * Task 1567 — container-level proof of the office editor against the REAL
 * production image (nginx + static build + prod CSP/COOP/COEP headers), not
 * the vite dev server. Driven by its own config (`container-proof.config.ts`;
 * the shared config's "authenticated" project relies on the dev-only
 * `devAutoAuth()`, which a production build does not contain).
 *
 * Topology this spec expects (see the task file's 2026-09-27 Legion notes):
 * one origin, E2E_WEB_URL, that serves the web image at `/` and proxies
 * `/api/*`, `/ws`, `/health` to an isolated beebeeb-api. Same origin is
 * required, not a convenience: the prod CSP's connect-src is 'self' plus
 * api.beebeeb.io, so a prod-shaped bundle can only reach a local API through
 * its own origin. The image must be built with VITE_API_URL=E2E_WEB_URL and
 * VITE_FEATURE_OFFICE_EDITOR=true.
 *
 * Proves:
 *   1. Signed out → `/office/:fileId` never renders the editor (the build
 *      flag is the only feature gate since the Labs opt-in was dropped;
 *      auth still guards the route).
 *   2. Real UI signup → upload .docx → Edit → type → Save as
 *      v2 → reopen in a fresh tab → the saved document.xml contains the edit.
 *   3. Same for .xlsx (cell A2 → 99, checked in xl/worksheets/sheet1.xml).
 *   4. (task 1584) Every office bundle asset is served with exactly one
 *      content coding and decodes to its manifest hash.
 *   Across 2 and 3: engine boot time (Edit click → canvas + outline/formula
 *   bar ready) and every request to a host other than E2E_WEB_URL.
 *   Results go to E2E_PROOF_OUT (default test-results/container-proof).
 *
 * Run: E2E_WEB_URL=http://localhost:18099 bunx playwright test --config=e2e/container-proof.config.ts
 */
import { test, expect, type BrowserContext, type Page, type Request } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { unzipSync } from 'fflate'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'
import { writeDocxFixture } from './helpers/office-fixtures'
import { writeXlsxFixture } from './helpers/office-fixtures-calc'
import { uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:18099'
const WEB_ORIGIN = new URL(WEB_URL).origin
const OUT = process.env.E2E_PROOF_OUT ?? 'test-results/container-proof'
fs.mkdirSync(OUT, { recursive: true })

test.describe.configure({ mode: 'serial' })

interface Egress {
  url: string
  method: string
  frame: string
}

function trackEgress(context: BrowserContext, sink: Egress[]) {
  const record = (r: Request) => {
    const u = new URL(r.url())
    if (u.protocol === 'data:' || u.protocol === 'blob:') return
    if (u.origin === WEB_ORIGIN) return
    let frame = '(no frame)'
    try {
      frame = r.frame().url()
    } catch {
      // service-worker / worker requests have no frame
    }
    sink.push({ url: r.url(), method: r.method(), frame })
  }
  context.on('request', record)
}

function unzipEntry(bytes: Uint8Array, entry: string): string {
  const xml = unzipSync(bytes)[entry]
  if (!xml) throw new Error(`${entry} missing from saved file`)
  return new TextDecoder().decode(xml)
}

async function openEditor(page: Page, context: BrowserContext, base: string, readyTestId: string) {
  await openPreview(page, base)
  const editButton = previewOverlay(page).getByTestId('preview-edit-button')
  await editButton.waitFor({ state: 'visible', timeout: 15_000 })
  const popup = context.waitForEvent('page')
  const t0 = Date.now()
  await editButton.click()
  const tab = await popup
  const diag: string[] = []
  tab.on('console', (m) => diag.push(`[console.${m.type()}] ${m.text()}`))
  tab.on('pageerror', (e) => diag.push(`[pageerror] ${e.message}`))
  tab.on('requestfailed', (r) => diag.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`))
  tab.on('response', (r) => {
    if (r.status() >= 400) diag.push(`[http ${r.status()}] ${r.url()}`)
  })
  await tab.waitForLoadState('domcontentloaded')
  try {
    await tab.getByTestId(readyTestId).waitFor({ state: 'visible', timeout: Number(process.env.E2E_BOOT_TIMEOUT_MS ?? 300_000) })
  } finally {
    fs.writeFileSync(path.join(OUT, `diag-${readyTestId}-${Date.now()}.log`), diag.join('\n'))
  }
  await tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').waitFor({ state: 'visible', timeout: 60_000 })
  const frame = tab.frames().find((f) => f.url().includes('bb-office-host.html'))
  expect(frame, 'engine frame').toBeTruthy()
  // Bridge answering a real round trip = engine booted and document open.
  await frame!.evaluate(async () => {
    await (window as unknown as { bbOffice: { getDocStats(): Promise<unknown> } }).bbOffice.getDocStats()
  })
  const bootMs = Date.now() - t0
  const isolated = await frame!.evaluate(() => self.crossOriginIsolated)
  await page.keyboard.press('Escape')
  return { tab, frame: frame!, bootMs, isolated }
}

async function savedBytes(frame: import('@playwright/test').Frame): Promise<Uint8Array> {
  const arr: number[] = await frame.evaluate(async () => {
    const b = await (window as unknown as { bbOffice: { save(): Promise<Uint8Array> } }).bbOffice.save()
    return Array.from(b)
  })
  return new Uint8Array(arr)
}

test('container: /office/<fileId> itself is served with COOP + COEP (cross-origin isolation for the engine)', async ({ request }) => {
  // The SPA route document, not an engine asset: nginx's SPA fallback must
  // keep the /office/ block's isolation headers (a try_files internal
  // redirect to /index.html used to drop them — see nginx.conf).
  const r = await request.get('/office/00000000-0000-0000-0000-000000000000')
  expect(r.status()).toBe(200)
  expect(r.headers()['cross-origin-opener-policy']).toBe('same-origin')
  expect(r.headers()['cross-origin-embedder-policy']).toBe('require-corp')
  expect(await r.text()).toContain('<div id="root"')
})

test('container: every office bundle asset has ONE content coding and decodes to its manifest hash (task 1584)', async ({ request }) => {
  // Task 1584: nginx used to gzip the pre-compressed .br files again, sending
  // `Content-Encoding: br` AND `gzip`. Chromium decoded that; WebKit did not
  // (iPhone Safari showed the engine document as text). Asks for Brotli the
  // way Safari does over HTTPS, then checks every asset in the manifest.
  const manifest = (await (await request.get('/office/manifest.json')).json()) as {
    version: string
    assets: Array<{ path: string; integrity: string }>
  }
  expect(manifest.assets.length).toBeGreaterThan(0)
  const { createHash } = await import('crypto')
  const checked: string[] = []
  for (const asset of manifest.assets) {
    const r = await request.get(`/office/${manifest.version}/${asset.path}`, { headers: { 'Accept-Encoding': 'gzip, deflate, br' } })
    expect(r.status(), asset.path).toBe(200)
    const encoding = r.headers()['content-encoding'] ?? ''
    expect(encoding, `${asset.path} content-encoding`).toBe('br')
    const [algo, b64] = asset.integrity.split('-')
    const digest = createHash(algo).update(await r.body()).digest('base64')
    expect(digest, `${asset.path} decoded body vs manifest integrity`).toBe(b64)
    checked.push(asset.path)
  }
  expect(checked.length).toBe(manifest.assets.length)
})

test('container: office route never renders the editor for a signed-out visitor (build flag true)', async ({ page }) => {
  await page.goto('/office/00000000-0000-0000-0000-000000000000')
  await expect(page).not.toHaveURL(/\/office\//, { timeout: 15_000 })
  await expect(page.getByTestId('office-editor')).toHaveCount(0)
})

test('container: real signup → .docx and .xlsx open, edit, save as v2, reopen shows the edit', async ({ page, context }) => {
  test.setTimeout(1_200_000)
  const egress: Egress[] = []
  trackEgress(context, egress)
  const results: Record<string, unknown> = { webOrigin: WEB_ORIGIN, startedAt: new Date().toISOString() }

  await signupAndUnlock(page, { email: uniqueEmail('container-proof'), password: 'ContainerProof1567!' })
  results.version = await (await page.request.get(`${WEB_URL}/version.json`)).json()

  // ── .docx ──
  const docxBase = await uploadAndWait(page, writeDocxFixture(`container-proof-${process.pid}.docx`, ['Container proof paragraph.']))
  const w = await openEditor(page, context, docxBase, 'office-outline-pane')
  results.docx = { bootMsColdCache: w.bootMs, crossOriginIsolated: w.isolated }
  const typed = 'Edited inside the amd64 container'
  await w.tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').click()
  await w.frame.evaluate(async () => {
    await (window as unknown as { bbOffice: { dispatch(c: string): Promise<unknown> } }).bbOffice.dispatch('.uno:SelectAll')
  })
  await w.tab.keyboard.type(typed, { delay: 30 })
  await expect(w.tab.getByTestId('office-unsaved-dot')).toBeVisible({ timeout: 15_000 })
  await w.tab.getByTestId('office-save').click()
  await expect(w.tab.getByTestId('office-status-saved')).toHaveText(/saved as version 2/, { timeout: 60_000 })
  await w.tab.screenshot({ path: path.join(OUT, 'docx-saved-v2.png') })
  const docxId = new URL(w.tab.url()).pathname.split('/').pop()!
  const docxVersions = await (await page.request.get(`${WEB_URL}/api/v1/files/${docxId}/versions`)).json()
  expect(docxVersions.current_version).toBe(2)
  await w.tab.close()

  const w2 = await openEditor(page, context, docxBase, 'office-outline-pane')
  const docXml = unzipEntry(await savedBytes(w2.frame), 'word/document.xml')
  expect(docXml).toContain(typed)
  await w2.tab.screenshot({ path: path.join(OUT, 'docx-reopened.png') })
  ;(results.docx as Record<string, unknown>).bootMsWarmCache = w2.bootMs
  ;(results.docx as Record<string, unknown>).roundTrip = 'pass: v2 on server, reopened document.xml contains the typed text'
  await w2.tab.close()

  // ── .xlsx ──
  const xlsxBase = await uploadAndWait(page, writeXlsxFixture(`container-proof-${process.pid}.xlsx`, [10, 20, 30]))
  const c = await openEditor(page, context, xlsxBase, 'calc-formula-bar')
  results.xlsx = { bootMs: c.bootMs, crossOriginIsolated: c.isolated }
  const box = c.tab.getByTestId('calc-ref-box')
  await box.fill('A2')
  await box.press('Enter')
  await expect(c.tab.getByTestId('calc-formula-bar-status')).toHaveText('Went to A2', { timeout: 15_000 })
  await c.tab.keyboard.type('99', { delay: 30 })
  await c.tab.keyboard.press('Enter')
  await expect(c.tab.getByTestId('office-unsaved-dot')).toBeVisible({ timeout: 15_000 })
  await c.tab.getByTestId('office-save').click()
  await expect(c.tab.getByTestId('office-status-saved')).toHaveText(/saved as version 2/, { timeout: 60_000 })
  await c.tab.screenshot({ path: path.join(OUT, 'xlsx-saved-v2.png') })
  await c.tab.close()
  const c2 = await openEditor(page, context, xlsxBase, 'calc-formula-bar')
  const sheetXml = unzipEntry(await savedBytes(c2.frame), 'xl/worksheets/sheet1.xml')
  expect(sheetXml).toMatch(/<c r="A2"[^>]*>(?:<f>[^<]*<\/f>)?<v>99<\/v>/)
  ;(results.xlsx as Record<string, unknown>).roundTrip = 'pass: v2 saved, reopened sheet1.xml A2 = 99'
  await c2.tab.close()

  // ── Egress ──
  results.foreignRequests = egress
  // Engine = the bb-office-host.html iframe and anything with no frame
  // (its pthread workers). The office PAGE itself also mounts the app-wide
  // IncidentBanner, so its status-page poll is attributed to /office/<id>.
  results.foreignFromEngine = egress.filter((e) => e.frame.includes('bb-office-host.html') || e.frame === '(no frame)')
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  // Zero egress from the engine.
  expect(results.foreignFromEngine).toEqual([])
  // Anything foreign at all must be the app-wide incident banner poll the
  // prod image makes to the status page (not office code) — listed, not hidden.
  for (const e of egress) expect(e.url).toMatch(/^https:\/\/status\.beebeeb\.io\/api\/v1\/status\/incidents$/)
})
