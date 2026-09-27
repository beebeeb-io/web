/**
 * Task 1577: starring a file from its drive row sent `PATCH /files/<id>/star`
 * → 200 `{ is_starred: true }`, but the row's button kept reading "Star".
 *
 * This spec drives the real row star button through the browser and asserts
 * the row reflects the server's answer, that the Starred view lists the file,
 * and that unstarring reverts both.
 *
 * Real stack (run via e2e/scripts/web-e2e.sh).
 */
import { test, expect, type Page } from '@playwright/test'
import { signupAndUnlock } from './helpers/signup'
import { uploadTextFile } from './helpers/drive'

test.use({ storageState: { cookies: [], origins: [] } })

async function dismissFirstRunOverlays(page: Page): Promise<void> {
  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()
  const skip = page.getByRole('button', { name: /^(Skip for now|Close)$/ })
  const appeared = await skip.first().isVisible({ timeout: 5_000 }).catch(() => false)
  if (appeared) await skip.first().click()
}

function rowFor(page: Page, filename: string) {
  return page
    .getByText(filename, { exact: false })
    .first()
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')
}

/** Click the row's star toggle and wait for the server round trip. */
async function clickRowStar(page: Page, filename: string, current: 'Star' | 'Unstar') {
  const row = rowFor(page, filename)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await row.hover({ timeout: 8_000 })
      const [resp] = await Promise.all([
        page.waitForResponse((r) => /\/api\/v1\/files\/[^/]+\/star$/.test(r.url()) && r.request().method() === 'PATCH'),
        row.getByRole('button', { name: current, exact: true }).click({ timeout: 8_000 }),
      ])
      expect(resp.status()).toBe(200)
      return (await resp.json()) as { id: string; is_starred: boolean }
    } catch (err) {
      await dismissFirstRunOverlays(page)
      if (attempt === 3) throw err
    }
  }
  throw new Error('unreachable')
}

/**
 * The bug is an ordering race: the star route answers the PATCH AND publishes
 * a `file.starred` frame on the user's event bus, which `/sync/stream` (SSE)
 * forwards. When that frame is processed AFTER the PATCH response — the normal
 * case in prod, where it can hop app01→Redis→app02 — the pre-fix client
 * reverted the row. On one local box the two usually land within the same
 * millisecond, so the race only lost ~1 in 3 runs. Holding `file.starred` SSE
 * frames back in the page makes the losing order deterministic; every other
 * frame is delivered untouched.
 */
const SSE_DELAY_MS = 1_500

async function delayStarredSseFrames(page: Page): Promise<void> {
  await page.addInitScript((delayMs: number) => {
    const Native = window.EventSource
    class DelayedStarES extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
      }
      set onmessage(handler: ((ev: MessageEvent) => unknown) | null) {
        super.onmessage = handler
          ? (ev: MessageEvent) => {
              if (typeof ev.data === 'string' && ev.data.includes('"type":"file.starred"')) {
                setTimeout(() => handler.call(this, ev), delayMs)
              } else {
                handler.call(this, ev)
              }
            }
          : null
      }
      get onmessage() {
        return super.onmessage
      }
    }
    window.EventSource = DelayedStarES as unknown as typeof EventSource
  }, SSE_DELAY_MS)
}

test('1577: row star toggle reflects server state; Starred view follows', async ({ page }) => {
  test.setTimeout(120_000)
  await delayStarredSseFrames(page)
  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { password: 'StarRowState1577!' })
  await dismissFirstRunOverlays(page)

  const filename = 'star-me-1577.txt'
  await uploadTextFile(page, filename, 'star row state')

  // Star → server says starred, row button flips to "Unstar".
  const starred = await clickRowStar(page, filename, 'Star')
  expect(starred.is_starred).toBe(true)
  const row = rowFor(page, filename)
  await expect(row.getByRole('button', { name: 'Unstar', exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(row.getByRole('button', { name: 'Unstar', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // It must STAY starred once the delayed `file.starred` /sync/stream frame
  // lands (see SSE_DELAY_MS). Before the fix that frame bumped the sync tree
  // version without the tree learning the star, the drive re-derived every row
  // from the tree, and the row flipped back to "Star".
  await page.waitForTimeout(SSE_DELAY_MS + 1_500)
  await expect(rowFor(page, filename).getByRole('button', { name: 'Unstar', exact: true })).toBeVisible()

  // Starred view lists it.
  await page.goto('/starred')
  await expect(page.getByText(filename, { exact: false }).first()).toBeVisible({ timeout: 20_000 })

  // Back to the drive: still starred after a navigation round trip.
  await page.goto('/')
  await expect(rowFor(page, filename).getByRole('button', { name: 'Unstar', exact: true })).toBeVisible({ timeout: 20_000 })

  // Unstar → reverts.
  const unstarred = await clickRowStar(page, filename, 'Unstar')
  expect(unstarred.is_starred).toBe(false)
  await expect(rowFor(page, filename).getByRole('button', { name: 'Star', exact: true })).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 })
  await page.waitForTimeout(SSE_DELAY_MS + 1_500)
  await expect(rowFor(page, filename).getByRole('button', { name: 'Star', exact: true })).toHaveAttribute('aria-pressed', 'false')

  await page.goto('/starred')
  await expect(page.getByText(filename, { exact: false })).toHaveCount(0, { timeout: 20_000 })
})
