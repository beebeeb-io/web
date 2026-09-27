/**
 * Task 1585 item 4: the office editor's REAL ready signal for e2e.
 *
 * `office-editor.tsx` sets `data-engine-settled="true"` on its root once the
 * engine has booted (the host waits for `Module.uno_main`, see
 * office-engine-host.tsx's `engineReadyBridge`), the document is open, and
 * every engine subscription (modified, ribbon state, selection) is
 * registered. Specs used to wait on the outline pane as a proxy with a fixed
 * 120 s budget. That pane appears earlier, mid-way through ~14 sequential
 * subscription round trips, and 120 s was shorter than a boot at load
 * average 88 to 125.
 *
 * The budget matches the app's own boot budget (DEFAULT_BOOT_TIMEOUT_MS,
 * 180 s): the spec waits exactly as long as the product would. If the
 * editor lands in its error state instead, this fails straight away and
 * reports the error kind and text, instead of timing out on a missing
 * element.
 */
import { expect, type Page } from '@playwright/test'

export const OFFICE_BOOT_BUDGET_MS = 180_000

export async function waitOfficeSettled(tab: Page, timeout = OFFICE_BOOT_BUDGET_MS): Promise<void> {
  const settled = tab.locator('[data-testid="office-editor"][data-engine-settled="true"]')
  const failed = tab.getByTestId('office-open-error')
  await expect(settled.or(failed)).toBeVisible({ timeout })
  if (await failed.isVisible()) {
    const kind = await failed.getAttribute('data-kind')
    throw new Error(`office editor failed to open (${kind}): ${(await failed.textContent())?.trim()}`)
  }
}

const bannerHandled = new WeakSet<Page>()

/**
 * The dev auto-login banner (dev-auth-gate.tsx, `fixed … z-[9999]`) covers
 * the office header, Save included. It appears only once devAutoAuth has
 * finished (an Argon2id derive), so a fixed 5 s "dismiss it if it shows" wait
 * misses it whenever that derive is slow. It was seen in the 1585 gate:
 * `office-save` click → "<div … z-[9999] …> intercepts pointer events" for
 * the full test timeout. A locator handler dismisses it WHENEVER it appears
 * before any later action, for the life of the page.
 */
export async function autoDismissDevBanner(page: Page): Promise<void> {
  if (bannerHandled.has(page)) return
  bannerHandled.add(page)
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Dismiss dev banner' }),
    async (dismiss) => {
      await dismiss.click()
    },
  )
}
