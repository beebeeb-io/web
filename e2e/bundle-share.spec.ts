import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { uploadTextFile } from './helpers/drive'
import { anonymousContext } from './helpers/auth'

/**
 * Task 0417 Step 3 — web reference client for BUNDLE SHARES.
 *
 * Drives the FULL bundle round-trip against the isolated e2e backend (:3003),
 * which runs the feat/0417 server build with the bundle endpoints:
 *   - multi-select ≥2 files → "Share with Beebeeb" → ONE bundle link
 *   - open /s/:token#key=K_c in a fresh anonymous context
 *   - assert the ORDERED item names render (decrypted from each item's
 *     name_encrypted via the FileKey unwrapped from K_c)
 *   - download one item (decrypts client-side, bytes match the original)
 *   - revoke the bundle from the owner side → reopen → "revoked"
 *
 * Owner = the harness's auto-logged-in dev account (the `authenticated`
 * project's saved storage state); recipient = a truly anonymous context.
 *
 * Zero-knowledge invariant exercised end-to-end: K_c lives ONLY in the URL
 * fragment (never sent to the server); the server stores only opaque wrapped
 * blobs and never sees a FileKey, K_c, or a plaintext name.
 */

/** Select a file row's checkbox by its (decrypted) filename. The checkbox is
 *  opacity-0 until hover/selection, so click with force — the click still
 *  bubbles to the cell's selection handler. */
async function selectRow(page: Page, filename: string): Promise<void> {
  const row = page
    .getByText(filename, { exact: false })
    .first()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')
  await row.hover()
  await row.getByRole('checkbox').first().click({ force: true })
}

/**
 * Create a bundle share over `filenames` (already uploaded) and return the
 * full `/s/<token>#key=…` URL. Selects each row, clicks the bulk-bar "Share",
 * generates the link, and reads it from the "Full link" tab.
 */
async function createBundleShareLink(page: Page, filenames: string[]): Promise<string> {
  for (const name of filenames) await selectRow(page, name)

  // The bulk action bar appears once ≥1 row is selected.
  await expect(page.getByText(`${filenames.length} selected`)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /^Share$/ }).click()

  // Bundle dialog → generate the encrypted link → read the Full-link value.
  await page.getByRole('button', { name: /generate encrypted link/i }).click()
  await page.getByRole('button', { name: 'Full link', exact: true }).click()
  const url = await page
    .locator('input[readonly]')
    .evaluateAll((els) => (els as HTMLInputElement[]).find((e) => /\/s\/[^#]+#key=/.test(e.value))?.value ?? null)
  if (!url) throw new Error('bundle dialog did not surface a /s/<token>#key=… URL')
  await page.keyboard.press('Escape')
  return url
}

test('bundle share: recipient sees ordered items, downloads one, revoke kills the link', async ({ page, browser }) => {
  test.setTimeout(180_000)

  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // Upload 3 files with DISTINCT contents so the ordered manifest + per-item
  // download are both verifiable. Names are unique-per-run.
  const stamp = Date.now()
  const files = [
    { name: `bundle-a-${stamp}.txt`, content: `bundle ALPHA :: ${stamp}` },
    { name: `bundle-b-${stamp}.txt`, content: `bundle BRAVO :: ${stamp}` },
    { name: `bundle-c-${stamp}.txt`, content: `bundle CHARLIE :: ${stamp}` },
  ]
  for (const f of files) await uploadTextFile(page, f.name, f.content)

  const shareUrl = await createBundleShareLink(page, files.map((f) => f.name))
  expect(shareUrl, 'bundle share URL has /s/<token>#key=').toMatch(/\/s\/[A-Za-z0-9_-]+#key=/)
  const token = shareUrl.match(/\/s\/([A-Za-z0-9_-]+)#/)![1]

  // ── Recipient: a TRULY anonymous context (no inherited authed cookie) ──────
  const ctx = await anonymousContext(browser)
  const recipient = await ctx.newPage()
  await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))

  try {
    await recipient.goto(shareUrl)

    // The bundle recipient view renders "Shared files" + the item count.
    await expect(recipient.getByText('Shared files')).toBeVisible({ timeout: 30_000 })
    await expect(recipient.getByText(`${files.length} files`)).toBeVisible({ timeout: 10_000 })

    // All three decrypted names render (proves each item's FileKey unwrapped
    // from K_c and decrypted that item's name_encrypted).
    for (const f of files) {
      await expect(recipient.getByText(f.name, { exact: false })).toBeVisible({ timeout: 30_000 })
    }

    // The order is positions 0..N-1 = upload order (a < b < c). Assert the
    // first rendered item name is the first file we uploaded.
    const renderedNames = await recipient
      .getByText(/bundle-[abc]-/, { exact: false })
      .allInnerTexts()
    expect(renderedNames[0]).toContain(files[0].name)

    // Download the FIRST item — decrypts client-side, bytes must match.
    const firstRow = recipient
      .getByText(files[0].name, { exact: false })
      .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
    const [download] = await Promise.all([
      recipient.waitForEvent('download', { timeout: 30_000 }),
      firstRow.getByRole('button', { name: /download/i }).click(),
    ])
    const path = await download.path()
    expect(path, 'download path').toBeTruthy()
    expect(fs.readFileSync(path!, 'utf8')).toBe(files[0].content)
  } finally {
    await ctx.close()
  }

  // ── Owner revokes the WHOLE bundle, then the link must read as revoked ──────
  // Owner-side API calls (the same /shares/mine + DELETE /shares/:id the /shared
  // UI uses). The bb_session is an httpOnly cookie; pass it explicitly as a
  // Cookie header on the node-side request context (cross-origin :3003 doesn't
  // always auto-attach it). Node-side requests bypass the page meta CSP.
  const apiBase = process.env.E2E_API_URL!
  const sessionCookie = (await page.context().cookies()).find((c) => c.name === 'bb_session')
  expect(sessionCookie, 'owner bb_session cookie present').toBeTruthy()
  const authHeaders = { Cookie: `bb_session=${sessionCookie!.value}` }

  const mineRes = await page.request.get(`${apiBase}/api/v1/shares/mine`, { headers: authHeaders })
  expect(mineRes.ok(), 'GET /shares/mine').toBeTruthy()
  const mineBody = await mineRes.json() as { shares: Array<{ id: string; share_type?: string; item_count?: number }> }
  const bundleRow = mineBody.shares.find((s) => s.share_type === 'bundle')
  expect(bundleRow, 'a bundle share appears in /mine').toBeTruthy()
  expect(bundleRow!.item_count, 'bundle item_count = number of files').toBe(files.length)

  const del = await page.request.delete(`${apiBase}/api/v1/shares/${bundleRow!.id}`, { headers: authHeaders })
  expect(del.status(), 'DELETE /shares/:id (revoke bundle) → 200').toBe(200)

  // Reopen the link in a fresh anonymous context → "revoked".
  const ctx2 = await anonymousContext(browser)
  const recipient2 = await ctx2.newPage()
  await recipient2.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  try {
    await recipient2.goto(shareUrl)
    await expect(recipient2.getByText(/revoked/i)).toBeVisible({ timeout: 30_000 })
  } finally {
    await ctx2.close()
  }

  // Sanity: the manifest endpoint now 403s (cryptographically revoked — the
  // whole-bundle crypto-erase NULLed the parent + every item key).
  const manifestRes = await page.request.get(`${apiBase}/api/v1/shares/${token}`)
  expect(manifestRes.status(), 'revoked bundle manifest → 403').toBe(403)
})
