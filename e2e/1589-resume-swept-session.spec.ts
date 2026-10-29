import { test, expect, type Page, type Request } from '@playwright/test'

// (A spec may not import global.setup.ts — Playwright rejects it — so the API
// origin and the welcome-tour preference write are repeated here.)
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

/**
 * Task 1589 — the web "paused uploads → Resume" flow survives a swept session.
 *
 * The server gives every v2 upload session a lease (`UPLOAD_LEASE_SECS`) and a
 * sweeper (every 30 s) abandons a session whose lease ran out: for a new file
 * the file row + session are deleted, so the session's chunk / complete routes
 * answer 404. Before 1589 the web client then fell back to the LEGACY
 * `/files/{id}/…` routes and failed ("Resume failed"), and the IndexedDB
 * entry stayed, so the banner offered the dead upload forever.
 *
 * This spec: start an upload whose chunk PUT never answers, CLOSE THE TAB
 * (the upload is paused, its resume entry is in IndexedDB), wait until the
 * server has swept the session, reopen the drive, click Resume, and require:
 *   - the stale session's chunk PUT answered 404,
 *   - a fresh POST /uploads/init for the SAME file id,
 *   - the upload completes on the new session ("Upload resumed"),
 *   - NO request ever reaches the legacy /files/{id}/chunks or
 *     /files/{id}/upload/complete routes,
 *   - after a reload the banner is gone (the entry was cleared).
 *
 * Needs the harness API started with a short lease — the default (3600 s)
 * would make the wait an hour:
 *   UPLOAD_LEASE_SECS=60 ./e2e/scripts/web-e2e.sh e2e/1589-resume-swept-session.spec.ts
 * Skips itself (with a reason) when the API's lease is longer than 120 s.
 */

const LEASE_WAIT_CAP_MS = 240_000

async function sessionCookie(page: Page): Promise<string> {
  const c = (await page.context().cookies()).find((k) => k.name === 'bb_session')
  if (!c) throw new Error('bb_session cookie missing')
  return `bb_session=${c.value}`
}

async function openDrive(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 30_000 })
  await expect(
    page
      .getByRole('heading', { name: 'All files', exact: true })
      .or(page.locator('#main-content, main, [role="main"]').getByText('All files').first()),
  ).toBeVisible({ timeout: 20_000 })
}

test('a paused upload whose session the server swept resumes by re-initing (no legacy fallback)', async ({ context }) => {
  test.setTimeout(LEASE_WAIT_CAP_MS + 120_000)

  const fileName = `bb-1589-resume-${Date.now()}.txt`
  const fileBuffer = Buffer.from(`task 1589 swept-session resume ${'x'.repeat(2048)}\n`)

  // Every request the browser makes, across both tabs.
  const seen: Array<{ method: string; url: string; status?: number }> = []
  context.on('requestfinished', async (req: Request) => {
    const res = await req.response().catch(() => null)
    seen.push({ method: req.method(), url: req.url(), status: res?.status() })
  })
  context.on('requestfailed', (req: Request) => {
    seen.push({ method: req.method(), url: req.url() })
  })

  // ── Tab 1: start the upload, stall its chunk PUT, close the tab ─────────
  const tab1 = await context.newPage()
  await openDrive(tab1)
  const cookie = await sessionCookie(tab1)
  // Keep the welcome-tour backdrop from covering the banner button later.
  await context.request.put(`${API_URL}/api/v1/preferences/welcome_tour`, {
    data: { seen: true, completed: [] },
    headers: { Cookie: cookie },
  })

  // Chunk PUTs hang (never answered) in tab 1 only — the upload is mid-flight
  // when the tab closes, exactly like a user closing it during an upload.
  await tab1.route('**/api/v1/uploads/*/chunks/*', () => { /* never fulfil */ })

  const initResp = tab1.waitForResponse(
    (r) => r.url().includes('/api/v1/uploads/init') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  const chunkReq = tab1.waitForRequest((r) => /\/api\/v1\/uploads\/[^/]+\/chunks\/0$/.test(r.url()), { timeout: 30_000 })
  await tab1.locator('input[type="file"]').first().setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: fileBuffer })
  const init = await (await initResp).json() as { file_id: string; upload_session_id: string; lease_seconds?: number }
  await chunkReq
  const fileId = init.file_id
  const oldSession = init.upload_session_id
  expect(fileId).toBeTruthy()
  expect(oldSession).toBeTruthy()

  const lease = init.lease_seconds
  test.skip(lease === undefined, 'API has no upload lease (server PR #120 not in E2E_API_BIN)')
  test.skip((lease ?? 0) > 120, `API lease is ${lease}s; run with UPLOAD_LEASE_SECS=60`)

  // The resume entry is written right after init; give IndexedDB a beat.
  await expect.poll(
    () => tab1.evaluate(() => new Promise<number>((resolve) => {
      const r = indexedDB.open('beebeeb_uploads')
      r.onsuccess = () => {
        const tx = r.result.transaction('active_uploads', 'readonly')
        const c = tx.objectStore('active_uploads').count()
        c.onsuccess = () => { resolve(c.result); r.result.close() }
      }
      r.onerror = () => resolve(-1)
    })),
    { timeout: 10_000 },
  ).toBe(1)
  await tab1.close()

  // ── Wait for the sweeper: the new file (and its session) is deleted ─────
  const sweptAt = Date.now()
  await expect.poll(
    async () => (await context.request.get(`${API_URL}/api/v1/files/${fileId}`, { headers: { Cookie: cookie } })).status(),
    { timeout: LEASE_WAIT_CAP_MS, intervals: [5_000] },
  ).toBe(404)
  const sweepSecs = Math.round((Date.now() - sweptAt) / 1000)
  console.log(`[1589] lease=${lease}s; session ${oldSession} swept after ~${sweepSecs}s of waiting`)

  // ── Tab 2: the banner offers the paused upload; Resume it ───────────────
  const tab2 = await context.newPage()
  await openDrive(tab2)
  await expect(tab2.getByText('1 upload paused')).toBeVisible({ timeout: 15_000 })

  const chooser = tab2.waitForEvent('filechooser')
  await tab2.getByRole('button', { name: 'Select file to resume' }).click()
  await (await chooser).setFiles({ name: fileName, mimeType: 'text/plain', buffer: fileBuffer })

  await expect(tab2.getByText('Upload resumed')).toBeVisible({ timeout: 60_000 })
  await expect(tab2.getByText('Resume failed')).toHaveCount(0)

  // Server truth: the file exists again, complete, under the SAME id.
  const after = await context.request.get(`${API_URL}/api/v1/files/${fileId}`, { headers: { Cookie: cookie } })
  expect(after.status()).toBe(200)
  const meta = await after.json() as { id: string; is_uploading?: boolean; size_bytes: number }
  expect(meta.id).toBe(fileId)
  expect(meta.is_uploading ?? false).toBe(false)
  expect(meta.size_bytes).toBe(fileBuffer.length)

  // Request log.
  const staleChunk = seen.filter((r) => r.method === 'PUT' && r.url.includes(`/uploads/${oldSession}/chunks/`) && r.status !== undefined)
  expect(staleChunk.map((r) => r.status)).toContain(404)
  const inits = seen.filter((r) => r.method === 'POST' && r.url.includes('/api/v1/uploads/init'))
  expect(inits.length).toBe(2) // tab 1's original + exactly ONE re-init
  const newChunks = seen.filter((r) => r.method === 'PUT' && /\/api\/v1\/uploads\/[^/]+\/chunks\//.test(r.url) && !r.url.includes(oldSession) && r.status === 200)
  expect(newChunks.length).toBeGreaterThanOrEqual(1)
  const legacy = seen.filter((r) => /\/api\/v1\/files\/[^/]+\/(chunks\/|upload\/complete)/.test(r.url))
  expect(legacy, `legacy fallback requests: ${JSON.stringify(legacy)}`).toEqual([])
  console.log(`[1589] stale PUT statuses=${JSON.stringify(staleChunk.map((r) => r.status))} inits=${inits.length} newChunkPUTs=${newChunks.length} legacy=${legacy.length}`)

  // The dead entry is gone: a reload shows no banner.
  await openDrive(tab2)
  await expect(tab2.getByText(/upload(s)? paused/)).toHaveCount(0)
})


/**
 * Task 1589 follow-up (Codex review, PR #122, upload-session-reinit.ts:102) —
 * the RE-INITED session is swept too (a second sleep during the restarted
 * transfer, or an unlucky short lease). `runWithSessionReinit` is bounded to
 * ONE re-init per resume click — it must not chain a second re-init — and the
 * terminal failure must surface as the same typed `UploadRestartFailedError`
 * the first-sweep-then-failed-reinit path already uses, so drive.tsx removes
 * the row with an honest "Paused upload expired" toast instead of resetting
 * it to a "Queued" card that can never actually be retried (its IndexedDB
 * resume entry is already gone).
 *
 * The FIRST sweep is real (same wait as the spec above). The SECOND sweep is
 * simulated with a route mock on tab 2's own chunk PUT — waiting out a real
 * second lease would double this spec's runtime for no extra coverage of the
 * (already-proven) sweep mechanism itself; what is under test here is the
 * CLIENT's handling of two swept sessions inside one resume click.
 */
test('a paused upload whose RE-INITED session is also swept surfaces a typed error, not a stuck "Queued" row', async ({ context }) => {
  test.setTimeout(LEASE_WAIT_CAP_MS + 120_000)

  const fileName = `bb-1589-double-sweep-${Date.now()}.txt`
  const fileBuffer = Buffer.from(`task 1589 double-sweep resume ${'x'.repeat(2048)}\n`)

  const seen: Array<{ method: string; url: string; status?: number }> = []
  context.on('requestfinished', async (req: Request) => {
    const res = await req.response().catch(() => null)
    seen.push({ method: req.method(), url: req.url(), status: res?.status() })
  })

  // ── Tab 1: start the upload, stall its chunk PUT, close the tab ─────────
  const tab1 = await context.newPage()
  await openDrive(tab1)
  const cookie = await sessionCookie(tab1)
  await context.request.put(`${API_URL}/api/v1/preferences/welcome_tour`, {
    data: { seen: true, completed: [] },
    headers: { Cookie: cookie },
  })

  await tab1.route('**/api/v1/uploads/*/chunks/*', () => { /* never fulfil */ })

  const initResp = tab1.waitForResponse(
    (r) => r.url().includes('/api/v1/uploads/init') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  const chunkReq = tab1.waitForRequest((r) => /\/api\/v1\/uploads\/[^/]+\/chunks\/0$/.test(r.url()), { timeout: 30_000 })
  await tab1.locator('input[type="file"]').first().setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: fileBuffer })
  const init = await (await initResp).json() as { file_id: string; upload_session_id: string; lease_seconds?: number }
  await chunkReq
  const fileId = init.file_id
  const oldSession = init.upload_session_id
  expect(fileId).toBeTruthy()
  expect(oldSession).toBeTruthy()

  const lease = init.lease_seconds
  test.skip(lease === undefined, 'API has no upload lease (server PR #120 not in E2E_API_BIN)')
  test.skip((lease ?? 0) > 120, `API lease is ${lease}s; run with UPLOAD_LEASE_SECS=60`)

  await expect.poll(
    () => tab1.evaluate(() => new Promise<number>((resolve) => {
      const r = indexedDB.open('beebeeb_uploads')
      r.onsuccess = () => {
        const tx = r.result.transaction('active_uploads', 'readonly')
        const c = tx.objectStore('active_uploads').count()
        c.onsuccess = () => { resolve(c.result); r.result.close() }
      }
      r.onerror = () => resolve(-1)
    })),
    { timeout: 10_000 },
  ).toBe(1)
  await tab1.close()

  // ── Wait for the REAL first sweep ────────────────────────────────────────
  await expect.poll(
    async () => (await context.request.get(`${API_URL}/api/v1/files/${fileId}`, { headers: { Cookie: cookie } })).status(),
    { timeout: LEASE_WAIT_CAP_MS, intervals: [5_000] },
  ).toBe(404)

  // ── Tab 2: resume. Old session's chunk PUT hits the real (swept) server;
  // the NEW session's chunk PUT (after re-init) is mocked to answer 404 too —
  // simulating the re-inited session being swept before this chunk landed.
  const tab2 = await context.newPage()
  await openDrive(tab2)
  await expect(tab2.getByText('1 upload paused')).toBeVisible({ timeout: 15_000 })

  await tab2.route('**/api/v1/uploads/*/chunks/*', async (route) => {
    const url = route.request().url()
    if (url.includes(oldSession)) {
      await route.continue() // real server, real (already swept) 404
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not_found', message: 'upload session not found' }),
      })
    }
  })

  const chooser = tab2.waitForEvent('filechooser')
  await tab2.getByRole('button', { name: 'Select file to resume' }).click()
  await (await chooser).setFiles({ name: fileName, mimeType: 'text/plain', buffer: fileBuffer })

  // The honest typed-error path, not the generic "Resume failed" retry path.
  await expect(tab2.getByText('Paused upload expired')).toBeVisible({ timeout: 30_000 })
  await expect(tab2.getByText(/expired on the server and could not be restarted/)).toBeVisible()
  await expect(tab2.getByText('Resume failed')).toHaveCount(0)
  await expect(tab2.getByText('Upload resumed')).toHaveCount(0)

  // The card is REMOVED, never left stuck at "Queued" with no way to retry
  // (the resume entry backing it is already gone). Scoped to the upload-card
  // list, not page-wide — the toast's OWN description also contains the file
  // name ("<name>: This upload expired...") and is still on screen.
  await expect(tab2.locator('[data-testid="upload-card"]').getByText(fileName)).toHaveCount(0)

  // Bounded to ONE re-init — no third init, no retry loop.
  const inits = seen.filter((r) => r.method === 'POST' && r.url.includes('/api/v1/uploads/init'))
  expect(inits.length).toBe(2) // tab 1's original + exactly ONE re-init
  const chunkPuts = seen.filter((r) => r.method === 'PUT' && /\/api\/v1\/uploads\/[^/]+\/chunks\//.test(r.url))
  expect(chunkPuts.length).toBe(2) // one PUT per session, no retry on 404
  console.log(`[1589 double-sweep] inits=${inits.length} chunkPUTs=${chunkPuts.length} statuses=${JSON.stringify(chunkPuts.map((r) => r.status))}`)

  // The dead entry is gone: a reload shows no banner and no stray card.
  await openDrive(tab2)
  await expect(tab2.getByText(/upload(s)? paused/)).toHaveCount(0)
  await expect(tab2.locator('[data-testid="upload-card"]').getByText(fileName)).toHaveCount(0)
})
