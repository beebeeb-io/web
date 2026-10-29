/**
 * 1815 — the document-driven signup phrase step offers Copy / Download .txt /
 * Recovery Kit PDF (regression: they were missing on prod after the 1745 flag flip).
 * Real stack, no mocks. Needs VITE_FEATURE_ONBOARDING_DOCUMENT=true,
 * BB_SIGNUP_EMAIL_CODE=1, SMTP -> Mailpit (SMTP_HOST=localhost SMTP_PORT=1025
 * SMTP_TLS_MODE=none; E2E_MAILPIT_URL). Runs at desktop and iPhone width.
 */
import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { uniqueEmail } from './helpers/signup'

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'
const SHOTS = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'
const PASSWORD = 'Correct-Horse-Battery-9'

test.use({ storageState: { cookies: [], origins: [] } })
test.setTimeout(240_000)

async function codeFromMailpit(email: string): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
      const data = (await res.json()) as { messages?: Array<{ ID: string }> }
      for (const m of data.messages ?? []) {
        const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text?: string }
        const hit = (msg.Text ?? '').match(/\b(\d{8})\b/)
        if (hit) return hit[1]
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no code mail for ${email}`)
}

async function toPhraseStep(page: Page, email: string) {
  const screen = page.getByTestId('onboarding-screen')
  await page.addInitScript(() => localStorage.setItem('bb_cookie_consent', 'all'))
  await page.goto('/signup?nodev=1')
  await expect(screen).toHaveAttribute('data-screen', 'step:enter_email', { timeout: 30_000 })
  await page.getByTestId('onboarding-email').fill(email)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(screen).toHaveAttribute('data-screen', 'step:verify_email_code')
  await page.getByTestId('onboarding-code').fill(await codeFromMailpit(email))
  await page.getByRole('button', { name: /^verify$/i }).click()
  await expect(screen).toHaveAttribute('data-screen', 'step:accept_terms')
  await page.getByRole('checkbox').nth(0).click()
  await page.getByRole('checkbox').nth(1).click()
  await page.getByTestId('accept-terms-continue').click()
  await expect(screen).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
  await page.getByTestId('onboarding-password').fill(PASSWORD)
  await page.getByTestId('onboarding-password-confirm').fill(PASSWORD)
  await page.getByTestId('set-password-continue').click()
  await expect(page.getByTestId('phrase-words')).toBeVisible({ timeout: 30_000 })
}

for (const vp of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'iphone', width: 390, height: 844 },
]) {
  test(`phrase step shows the export options (${vp.name})`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.setViewportSize({ width: vp.width, height: vp.height })
    const email = uniqueEmail('v1815')
    await toPhraseStep(page, email)

    const words: string[] = []
    for (let i = 1; i <= 12; i++) words.push((await page.getByTestId(`phrase-word-${i}`).innerText()).trim())

    await expect(page.getByTestId('phrase-copy')).toBeVisible()
    await expect(page.getByTestId('phrase-download-txt')).toBeVisible()
    await expect(page.getByTestId('phrase-recovery-kit')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/phrase-step-${vp.name}.png`, fullPage: true })

    // No horizontal page scroll at phone width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    // Download .txt: 12 numbered lines matching the shown words.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('phrase-download-txt').click()])
    expect(download.suggestedFilename()).toBe('beebeeb-recovery-phrase.txt')
    const lines = readFileSync((await download.path())!, 'utf8').split('\n')
    expect(lines).toHaveLength(12)
    lines.forEach((l, i) => expect(l).toBe(`${String(i + 1).padStart(2, '0')}  ${words[i]}`))

    // Copy writes the phrase.
    await page.getByTestId('phrase-copy').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(words.join(' '))

    // Recovery Kit PDF opens the print-ready page with the words and the email.
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('phrase-recovery-kit').click()])
    await popup.waitForLoadState('domcontentloaded')
    const html = await popup.content()
    expect(html).toContain(words[0])
    expect(html).toContain(email)
  })
}
