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
 * The budget is the app's own boot budget (DEFAULT_BOOT_TIMEOUT_MS, 180 s),
 * which covers the engine boot only, from iframe load until `Module.uno_main`
 * exists, PLUS a post-boot margin. After the boot, the settled signal still
 * waits for `open()`, the workspace colour, ~14 sequential onState round trips
 * and the selection subscription (Codex P2 on PR #123). So the spec waits at
 * least as long as the product would, and a boot that ends near the
 * product's limit still gets time to settle.
 *
 * If the editor lands in either error state instead, this fails at once and
 * reports the kind and the text, rather than timing out on a missing element:
 * - `office-open-error`: the engine could not open the document
 * - `office-editor-page-error`: download, decryption, metadata or the
 *   magic-byte check failed before the editor mounted (Codex P2 on PR #123)
 */
import { expect, type Page } from '@playwright/test'

/** The product's engine-boot budget (office-engine-host.tsx DEFAULT_BOOT_TIMEOUT_MS). */
export const OFFICE_BOOT_BUDGET_MS = 180_000
/** open() + subscriptions after the boot; generous for a machine at load 100+. */
export const OFFICE_POST_BOOT_MARGIN_MS = 90_000
/** Everything waitOfficeSettled may wait for one editor tab. */
export const OFFICE_SETTLE_BUDGET_MS = OFFICE_BOOT_BUDGET_MS + OFFICE_POST_BOOT_MARGIN_MS

export async function waitOfficeSettled(tab: Page, timeout = OFFICE_SETTLE_BUDGET_MS): Promise<void> {
  const settled = tab.locator('[data-testid="office-editor"][data-engine-settled="true"]')
  const openFailed = tab.getByTestId('office-open-error')
  const pageFailed = tab.getByTestId('office-editor-page-error')
  await expect(settled.or(openFailed).or(pageFailed)).toBeVisible({ timeout })
  for (const failed of [openFailed, pageFailed]) {
    if (await failed.isVisible()) {
      // One evaluate on the element that is already visible: no locator here
      // may wait. An earlier version asked for a `[data-kind]` child that
      // does not exist for an error without a kind, and that call waited
      // out the whole test timeout.
      const { kind, text } = await failed.evaluate((el) => ({
        kind: el.getAttribute('data-kind') ?? el.querySelector('[data-kind]')?.getAttribute('data-kind') ?? null,
        text: (el.textContent ?? '').trim(),
      }))
      throw new Error(`office editor failed to open (${kind ?? 'no kind'}): ${text}`)
    }
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
