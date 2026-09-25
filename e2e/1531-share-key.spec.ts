import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { uploadTextFile, createShareLink } from './helpers/drive'
import { anonymousContext } from './helpers/auth'

/**
 * Task 1531 — share link: "Invalid key format" on a complete link
 * (base64url key rejected by the manual form; key form shown on the full
 * link in the field).
 *
 * ROOT CAUSE (see the task's grounded facts + this PR's description for the
 * full evidence): share-view.tsx's manual key-entry form (handleUnlock)
 * called fromBase64() — raw atob() — directly on whatever the user pasted.
 * Every share key is minted as base64url (toBase64url() in
 * share-dialog.tsx / share-link.ts), and a 43-char key has roughly a 75%
 * chance of containing '-' or '_' (P(none) = (62/64)^43 ≈ 25%). atob()
 * throws on those characters, so most manual pastes of a perfectly valid
 * key produced "Invalid key format." — exactly the string in the task's bug
 * report, and the ONLY source of that string in the codebase. The automatic
 * `#key=…` fragment path (getKeyFromFragment) already normalized
 * base64url before decoding and is reproducibly robust across every real
 * navigation pattern this suite could construct (anonymous fresh context,
 * same-tab hard navigation, new-tab-in-an-authenticated-context) — see the
 * PR description for that evidence. src/lib/share-key.ts's parseShareKey()
 * is now the ONE parser both the fragment path and the manual form share.
 *
 * `createShareLink()` always mints a base64url key (task requires we force
 * at least one '-'/'_' into the tested key, since a fresh key only has a
 * ~75% chance of containing either) — retryUntilDashOrUnderscore() below
 * re-creates the share until the key qualifies, bounded to avoid a flaky
 * infinite loop.
 */

/** Re-create a share (new file each time) until its key contains '-' or '_'.
 *  Returns the EXACT content string of the file whose share succeeded, so
 *  callers can assert the downloaded bytes against it directly. */
async function shareLinkWithDashOrUnderscore(
  page: Page,
  filenamePrefix: string,
  contentPrefix: string,
  maxAttempts = 40,
): Promise<{ url: string; token: string; key: string; content: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const filename = `${filenamePrefix}-${attempt}-${Date.now()}.txt`
    const content = `${contentPrefix} :: attempt ${attempt}`
    // eslint-disable-next-line no-await-in-loop
    await uploadTextFile(page, filename, content)
    // eslint-disable-next-line no-await-in-loop
    const url = await createShareLink(page, filename)
    const m = url.match(/\/s\/([^#]+)#key=(.+)$/)
    if (!m) throw new Error(`share dialog did not surface a /s/<token>#key=… URL: ${url}`)
    const token = m[1]
    const key = decodeURIComponent(m[2])
    if (/[-_]/.test(key)) return { url, token, key, content }
  }
  throw new Error(`no share key contained '-'/'_' within ${maxAttempts} attempts`)
}

test.describe('1531 — full link opens with no key form, downloads content', () => {
  test('a full link whose key contains "-"/"_" decrypts + downloads, never shows the key form', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

    const { url: shareUrl, key, content } = await shareLinkWithDashOrUnderscore(
      page,
      '1531-full',
      `1531 full-link happy path :: ${Date.now()}`,
    )
    expect(key, 'forced key contains - or _').toMatch(/[-_]/)

    const ctx = await anonymousContext(browser)
    const recipient = await ctx.newPage()
    await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
    try {
      await recipient.goto(shareUrl)

      // Never shows the manual key-entry form or any key-resolution error.
      await expect(recipient.getByPlaceholder('Paste decryption key')).toHaveCount(0)
      await expect(recipient.getByText('This link is incomplete')).toHaveCount(0)
      await expect(recipient.getByText("This key doesn't match this file")).toHaveCount(0)

      const downloadBtn = recipient.getByRole('button', { name: /download and decrypt/i })
      await expect(downloadBtn).toBeVisible({ timeout: 15_000 })

      const [download] = await Promise.all([
        recipient.waitForEvent('download', { timeout: 30_000 }),
        downloadBtn.click(),
      ])
      const path = await download.path()
      expect(path, 'download path').toBeTruthy()
      expect(fs.readFileSync(path!, 'utf8')).toBe(content)
      await recipient.screenshot({ path: 'scratch-evidence/1531-e2e-full-link.png' })
    } finally {
      await ctx.close()
    }
  })
})

test.describe('1531 — manual key-entry form accepts base64url and a whole pasted link', () => {
  test('manual form: pasting a bare base64url key ("-"/"_") unlocks and downloads', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

    const { token, key, content } = await shareLinkWithDashOrUnderscore(
      page,
      '1531-manual-bare',
      `1531 manual bare key :: ${Date.now()}`,
    )
    expect(key).toMatch(/[-_]/)

    const bareLink = `${new URL(page.url()).origin}/s/${token}`
    const ctx = await anonymousContext(browser)
    const recipient = await ctx.newPage()
    await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
    try {
      await recipient.goto(bareLink)
      await expect(recipient.getByPlaceholder('Paste decryption key')).toBeVisible({ timeout: 15_000 })

      await recipient.getByPlaceholder('Paste decryption key').fill(key)
      await recipient.getByRole('button', { name: /unlock file/i }).click()

      // Pre-1531: this produced "Invalid key format." for ~75% of keys.
      await expect(recipient.getByText('Invalid key format')).toHaveCount(0)
      const downloadBtn = recipient.getByRole('button', { name: /download and decrypt/i })
      await expect(downloadBtn).toBeVisible({ timeout: 15_000 })

      const [download] = await Promise.all([
        recipient.waitForEvent('download', { timeout: 30_000 }),
        downloadBtn.click(),
      ])
      const path = await download.path()
      expect(fs.readFileSync(path!, 'utf8')).toBe(content)
    } finally {
      await ctx.close()
    }
  })

  test('manual form: pasting the WHOLE share link (not just the key) also unlocks', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

    const { url: shareUrl, token, content } = await shareLinkWithDashOrUnderscore(
      page,
      '1531-manual-full',
      `1531 manual whole link :: ${Date.now()}`,
    )

    const bareLink = `${new URL(shareUrl).origin}/s/${token}`
    const ctx = await anonymousContext(browser)
    const recipient = await ctx.newPage()
    await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
    try {
      await recipient.goto(bareLink)
      await expect(recipient.getByPlaceholder('Paste decryption key')).toBeVisible({ timeout: 15_000 })

      // Paste the WHOLE link (origin + /s/<token>#key=<key>), not just the key.
      await recipient.getByPlaceholder('Paste decryption key').fill(shareUrl)
      await recipient.getByRole('button', { name: /unlock file/i }).click()

      await expect(recipient.getByText('Invalid key format')).toHaveCount(0)
      const downloadBtn = recipient.getByRole('button', { name: /download and decrypt/i })
      await expect(downloadBtn).toBeVisible({ timeout: 15_000 })

      const [download] = await Promise.all([
        recipient.waitForEvent('download', { timeout: 30_000 }),
        downloadBtn.click(),
      ])
      const path = await download.path()
      expect(fs.readFileSync(path!, 'utf8')).toBe(content)
    } finally {
      await ctx.close()
    }
  })
})

test.describe('1531 — a truly truncated key still shows the truncated-key copy', () => {
  test('manual form: a truncated key is rejected with the honest "check the full key" copy, not a silent wrong-length decrypt', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

    const filename = `1531-truncated-${Date.now()}.txt`
    await uploadTextFile(page, filename, '1531 truncated key case')
    const shareUrl = await createShareLink(page, filename)
    const m = shareUrl.match(/\/s\/([^#]+)#key=(.+)$/)!
    const token = m[1]
    const fullKey = decodeURIComponent(m[2])
    const truncatedKey = fullKey.slice(0, 20) // well short of 32 raw bytes

    const bareLink = `${new URL(shareUrl).origin}/s/${token}`
    const ctx = await anonymousContext(browser)
    const recipient = await ctx.newPage()
    await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
    try {
      await recipient.goto(bareLink)
      await expect(recipient.getByPlaceholder('Paste decryption key')).toBeVisible({ timeout: 15_000 })

      await recipient.getByPlaceholder('Paste decryption key').fill(truncatedKey)
      await recipient.getByRole('button', { name: /unlock file/i }).click()

      await expect(recipient.getByText('Invalid key format. Check that you pasted the full key.')).toBeVisible({
        timeout: 10_000,
      })
      await expect(recipient.getByRole('button', { name: /download and decrypt/i })).toHaveCount(0)
      await recipient.screenshot({ path: 'scratch-evidence/1531-e2e-truncated.png' })
    } finally {
      await ctx.close()
    }
  })

  test('automatic fragment: a truncated #key= still shows "This link is incomplete" (unchanged, task 0709 regression guard)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

    const filename = `1531-truncated-frag-${Date.now()}.txt`
    await uploadTextFile(page, filename, '1531 truncated fragment case')
    const shareUrl = await createShareLink(page, filename)
    const m = shareUrl.match(/\/s\/([^#]+)#key=(.+)$/)!
    const token = m[1]
    const fullKey = decodeURIComponent(m[2])
    const truncatedKey = fullKey.slice(0, 20)

    const truncatedLink = `${new URL(shareUrl).origin}/s/${token}#key=${encodeURIComponent(truncatedKey)}`
    const ctx = await anonymousContext(browser)
    const recipient = await ctx.newPage()
    await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
    try {
      await recipient.goto(truncatedLink)
      await expect(recipient.getByText('This link is incomplete')).toBeVisible({ timeout: 15_000 })
      await expect(recipient.getByRole('button', { name: /download and decrypt/i })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
