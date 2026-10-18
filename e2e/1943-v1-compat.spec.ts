/**
 * Task 1943 — after web moves its read path onto core 1908 (pin-aware content
 * reader, core name readers, notes through core, replace pin), everything the
 * CURRENT production web wrote still opens, byte for byte, and what the new
 * web writes still opens in the current production web.
 *
 * Two web origins, ONE account, ONE API:
 *   BASE   = origin/main web (the current production code, core fc05177 WASM)
 *   BRANCH = this branch (core dd7bd76 WASM)
 *
 *   1. BASE: sign up, upload a 3-chunk binary and a small text file (v1 frames,
 *      raw-key names), write a note on the binary (raw-key note).
 *   2. BRANCH (new device: log in + recovery phrase): the binary downloads
 *      byte-identical through the STREAMING path (service worker) and, in a
 *      second context with service workers blocked, through the BUFFERED path;
 *      the text file previews; the note written by BASE opens; a share link
 *      BASE created opens on the BRANCH origin for an anonymous recipient and
 *      downloads byte-identical (share-view: pin from the shared name).
 *   3. BRANCH: edit the note (core encrypt_note_for, pin 0 = raw key in the
 *      read-only phase), and replace the binary with new content (same name =
 *      a new version: the replace reads the pin, pin 0, and writes v1).
 *      The current version and the old version both download byte-identical.
 *   4. BASE again: the note the branch wrote opens, and the version the branch
 *      wrote downloads byte-identical (the branch still writes what the
 *      current web reads).
 *
 * Environment (task 1943 run, 2026-10-18): API = server main 43aeec40 built
 * against core CORE_REV cbd941bc (paired tree ~/code/bb-worktrees/web-1943-srv,
 * debug build, scratch Postgres DB, local blob store, BB_RATE_LIMIT_DISABLED=1,
 * CORS_ORIGINS = both web origins); each web served by `bunx vite --mode test`
 * with VITE_API_URL pointing at that API. Set E2E_1943_BASE_URL,
 * E2E_1943_BRANCH_URL and E2E_1943_API_URL; without them the spec skips.
 * Screenshots land in E2E_EVIDENCE_DIR (default test-results/1943).
 */
import { test, expect, type Browser, type BrowserContext, type Download, type Page } from '@playwright/test'
import { createHash, randomBytes } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { signupAndUnlock } from './helpers/signup'
import { openRowMenu } from './helpers/drive'

const BASE_URL = process.env.E2E_1943_BASE_URL
const BRANCH_URL = process.env.E2E_1943_BRANCH_URL
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1943'

const PASSWORD = 'Compat-1943-correct-horse-7'
const BIN = 'compat-1943.bin'
const TXT = 'compat-1943.txt'
const TXT_BODY = 'Written by the current production web, read by the 1943 branch.'
const NOTE_FROM_BASE = 'note written by the current web (raw key)'
const NOTE_FROM_BRANCH = 'note written by the 1943 branch (core encrypt_note_for)'

// 9 MiB + 12345 bytes: three 4 MiB chunks on the web ladder, last one partial.
const ORIGINAL = randomBytes(9 * 1024 * 1024 + 12_345)
// The replacing version: two chunks.
const REPLACEMENT = randomBytes(5 * 1024 * 1024 + 777)

const sha256 = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex')

test.skip(!BASE_URL || !BRANCH_URL, 'needs the paired 1943 stack: set E2E_1943_BASE_URL and E2E_1943_BRANCH_URL (see header)')

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: false })
}

async function newOrigin(browser: Browser, baseURL: string, opts: { blockServiceWorkers?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    acceptDownloads: true,
    serviceWorkers: opts.blockServiceWorkers ? 'block' : 'allow',
  })
  // First-run overlays are per origin (localStorage): mark them done before any
  // page loads, so the coachmark tour cannot pop up in the middle of a menu
  // click (it did: its handler's "Skip tour" click closed the row menu).
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bb_cookie_consent', 'all')
      localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
      localStorage.setItem('beebeeb.onboarding.done', 'true')
    } catch {
      /* storage unavailable: the locator handler below still covers the tour */
    }
  })
  const page = await ctx.newPage()
  // Fallback: skip the coachmark tour whenever it shows anyway.
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Upload your first file' }), async (tour) => {
    await tour.getByRole('button', { name: 'Skip tour' }).click()
  })
  return { ctx, page }
}

/**
 * Sign in on a NEW device (a fresh origin = no local vault): password, then the
 * recovery phrase restores the vault. (helpers/auth.ts loginAndProvision looks
 * the password up by label, which the current sign-in page no longer
 * associates with its input, so this drives it by placeholder.)
 */
async function signInOnNewDevice(page: Page, email: string, recoveryPhrase: string): Promise<void> {
  await page.goto('/login')
  await page.waitForSelector('body[data-crypto-ready="true"]', { timeout: 60_000 })
  await page.getByLabel(/email/i).fill(email)
  await page.getByPlaceholder('Your password').first().fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const provision = page.getByLabel('Recovery word 1', { exact: true })
  const winner = await Promise.race([
    page.waitForURL(/\/(?:$|\?|#)/, { timeout: 60_000 }).then(() => 'drive' as const).catch(() => null),
    provision.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'provision' as const).catch(() => null),
  ])
  if (winner === 'provision') {
    await provision.fill(recoveryPhrase)
    await page.getByRole('button', { name: /restore vault/i }).click()
    await page.waitForURL(/\/(?:$|\?|#)/, { timeout: 60_000 })
  } else if (winner !== 'drive') {
    throw new Error('sign-in reached neither the drive nor the recovery-phrase step')
  }
}

async function dismissFirstRunOverlays(page: Page): Promise<void> {
  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()
  const skip = page.getByRole('button', { name: /^Skip for now$/ })
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) await skip.click()
}

async function upload(page: Page, name: string, mimeType: string, body: Buffer): Promise<void> {
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name, mimeType, buffer: body })
}

function row(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name })
}

async function bytesOf(download: Download): Promise<Buffer> {
  const p = await download.path()
  expect(p, 'download produced no file').toBeTruthy()
  return fs.readFileSync(p!)
}

/** Download the current version through the row menu; returns the bytes and whether the SW streaming path served it. */
async function downloadCurrent(page: Page, name: string): Promise<{ bytes: Buffer; streamed: boolean }> {
  let streamed = false
  const onRequest = (r: { url(): string }) => {
    if (r.url().includes('/sw-download/')) streamed = true
  }
  page.on('request', onRequest)
  try {
    await openRowMenu(page, name)
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('menuitem', { name: /^Download/ }).click(),
    ])
    expect(dl.suggestedFilename()).toBe(name)
    return { bytes: await bytesOf(dl), streamed }
  } finally {
    page.off('request', onRequest)
  }
}

/**
 * Make a share link and read it from the "Send securely" dialog. (helpers/drive.ts
 * createShareLink still clicks a "Full link" tab the dialog no longer has.)
 */
async function makeShareLink(page: Page, name: string): Promise<string> {
  await openRowMenu(page, name)
  await page.getByRole('menuitem', { name: /^Share/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Send securely' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  const generate = dialog.getByRole('button', { name: /generate encrypted link/i })
  if (await generate.isVisible().catch(() => false)) await generate.click()
  const field = dialog.getByRole('textbox')
  await expect(field).toHaveValue(/\/s\/[^#]+#key=/, { timeout: 30_000 })
  const url = await field.inputValue()
  await page.keyboard.press('Escape')
  return url
}

async function openDetails(page: Page, name: string) {
  // A single click on a non-previewable row opens the details panel.
  await row(page, name).first().getByText(name).first().click()
  const note = page.getByPlaceholder('Add a note...')
  await expect(note).toBeVisible({ timeout: 15_000 })
  return note
}

async function saveNote(page: Page, text: string): Promise<void> {
  const note = page.getByPlaceholder('Add a note...')
  await note.fill(text)
  const patched = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && /\/api\/v1\/files\/[^/]+$/.test(new URL(r.url()).pathname),
    { timeout: 30_000 },
  )
  await note.blur()
  const res = await patched
  expect(res.status(), 'note PATCH').toBeLessThan(300)
}

test('1943: what the current web wrote opens byte-identical in the branch, and the reverse', async ({ browser }) => {
  // ── 1. BASE (current production web): account, files, note ───────────────
  const base = await newOrigin(browser, BASE_URL!)
  await base.page.goto('/?nodev=1')
  const account = await signupAndUnlock(base.page, { password: PASSWORD })
  await dismissFirstRunOverlays(base.page)

  await upload(base.page, BIN, 'application/octet-stream', ORIGINAL)
  await expect(row(base.page, BIN)).toHaveCount(1, { timeout: 120_000 })
  await expect(row(base.page, BIN).first()).toContainText('9 MB', { timeout: 120_000 })
  await upload(base.page, TXT, 'text/plain', Buffer.from(TXT_BODY))
  await expect(row(base.page, TXT)).toHaveCount(1, { timeout: 60_000 })
  // (no networkidle: the drive keeps a live sync connection open)
  await expect(row(base.page, TXT).first()).toContainText(`${Buffer.byteLength(TXT_BODY)} B`, { timeout: 60_000 })

  const baseOwn = await downloadCurrent(base.page, BIN)
  expect(sha256(baseOwn.bytes), 'BASE reads its own upload').toBe(sha256(ORIGINAL))

  await openDetails(base.page, BIN)
  await saveNote(base.page, NOTE_FROM_BASE)
  await base.page.getByPlaceholder('Add a note...').scrollIntoViewIfNeeded()
  await shot(base.page, '01-base-uploaded-and-noted')
  await base.page.keyboard.press('Escape')

  // A share link for the binary, made by the current web (owner-wrapped key).
  const shareUrl = await makeShareLink(base.page, BIN)
  expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]+#key=/)

  // ── 2. BRANCH: a new device of the same account ───────────────────────────
  const branch = await newOrigin(browser, BRANCH_URL!)
  await branch.page.goto('/?nodev=1')
  await signInOnNewDevice(branch.page, account.email, account.recoveryPhrase)
  await dismissFirstRunOverlays(branch.page)
  await expect(row(branch.page, BIN)).toHaveCount(1, { timeout: 60_000 })
  // The listing decrypted the names through core's name reader.
  await expect(row(branch.page, TXT)).toHaveCount(1)

  // Streaming path (service worker): reload once so the SW controls the page.
  await branch.page.reload()
  await expect(row(branch.page, BIN)).toHaveCount(1, { timeout: 60_000 })
  const streamedDl = await downloadCurrent(branch.page, BIN)
  expect(streamedDl.streamed, 'the branch download used the streaming (service worker) path').toBe(true)
  expect(sha256(streamedDl.bytes), 'BRANCH streamed download of the BASE upload').toBe(sha256(ORIGINAL))

  // The note BASE sealed under the raw key opens through core's note reader.
  const branchNote = await openDetails(branch.page, BIN)
  await expect(branchNote).toHaveValue(NOTE_FROM_BASE, { timeout: 15_000 })
  await branchNote.scrollIntoViewIfNeeded()
  await shot(branch.page, '02-branch-reads-base-note')

  // The note, re-sealed by the branch (pin 0: raw key until the gated switch).
  await saveNote(branch.page, NOTE_FROM_BRANCH)
  await branch.page.keyboard.press('Escape')
  await branch.page.reload()
  await expect(row(branch.page, BIN)).toHaveCount(1, { timeout: 60_000 })
  await expect(await openDetails(branch.page, BIN)).toHaveValue(NOTE_FROM_BRANCH, { timeout: 15_000 })
  await branch.page.keyboard.press('Escape')

  // The text file previews (decryptToBlob).
  await row(branch.page, TXT).first().getByText(TXT).first().click()
  await expect(branch.page.getByText(TXT_BODY).first()).toBeVisible({ timeout: 30_000 })
  await shot(branch.page, '03-branch-previews-base-text')
  await branch.page.keyboard.press('Escape')

  // Buffered path: the same file, service workers blocked.
  const buffered = await newOrigin(browser, BRANCH_URL!, { blockServiceWorkers: true })
  await buffered.page.goto('/?nodev=1')
  await signInOnNewDevice(buffered.page, account.email, account.recoveryPhrase)
  await dismissFirstRunOverlays(buffered.page)
  await expect(row(buffered.page, BIN)).toHaveCount(1, { timeout: 60_000 })
  const bufferedDl = await downloadCurrent(buffered.page, BIN)
  expect(bufferedDl.streamed, 'service workers blocked: the buffered path served it').toBe(false)
  expect(sha256(bufferedDl.bytes), 'BRANCH buffered download of the BASE upload').toBe(sha256(ORIGINAL))
  await buffered.ctx.close()

  // The share link, opened on the BRANCH origin by an anonymous recipient.
  const recipientCtx = await browser.newContext({ storageState: { cookies: [], origins: [] }, acceptDownloads: true })
  const recipient = await recipientCtx.newPage()
  await recipient.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  const link = new URL(shareUrl)
  await recipient.goto(`${BRANCH_URL}${link.pathname}${link.search}${link.hash}`)
  expect(new URL(recipient.url()).origin).toBe(new URL(BRANCH_URL!).origin)
  await expect(recipient.getByText(BIN, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  const shareDownload = recipient.getByRole('button', { name: /download and decrypt/i })
  await expect(shareDownload).toBeVisible({ timeout: 15_000 })
  const [sharedDl] = await Promise.all([
    recipient.waitForEvent('download', { timeout: 60_000 }),
    shareDownload.click(),
  ])
  expect(sha256(await bytesOf(sharedDl)), 'share link opened on the BRANCH: byte-identical').toBe(sha256(ORIGINAL))
  await shot(recipient, '03b-branch-share-link-recipient')
  await recipientCtx.close()

  // ── 3. BRANCH replaces the file (same name = a new version) ───────────────
  await upload(branch.page, BIN, 'application/octet-stream', REPLACEMENT)
  await expect(row(branch.page, BIN).first()).toContainText('5 MB', { timeout: 120_000 })
  // Same name = a new version of the same file, never a second row.
  await expect(row(branch.page, BIN)).toHaveCount(1)

  const replacedDl = await downloadCurrent(branch.page, BIN)
  expect(sha256(replacedDl.bytes), 'BRANCH reads the version it wrote').toBe(sha256(REPLACEMENT))

  await openRowMenu(branch.page, BIN)
  await branch.page.getByRole('menuitem', { name: /^See versions/ }).click()
  const panel = branch.page.getByRole('dialog', { name: 'Version history' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('option')).toHaveCount(2, { timeout: 15_000 })
  const v1 = panel.getByRole('option', { name: /^Version 1,/ })
  await v1.click()
  const [oldDl] = await Promise.all([
    branch.page.waitForEvent('download', { timeout: 60_000 }),
    v1.getByRole('button', { name: 'Download' }).click(),
  ])
  expect(sha256(await bytesOf(oldDl)), 'BRANCH reads the old version BASE wrote (decryptVersionToBlob)').toBe(sha256(ORIGINAL))
  await shot(branch.page, '04-branch-version-history')
  await branch.page.keyboard.press('Escape')

  // ── 4. BASE again: it reads what the branch wrote ─────────────────────────
  await base.page.reload()
  await expect(row(base.page, BIN)).toHaveCount(1, { timeout: 60_000 })
  const baseReadsBranch = await downloadCurrent(base.page, BIN)
  expect(sha256(baseReadsBranch.bytes), 'BASE reads the version the BRANCH wrote').toBe(sha256(REPLACEMENT))
  const baseNote = await openDetails(base.page, BIN)
  await expect(baseNote).toHaveValue(NOTE_FROM_BRANCH, { timeout: 15_000 })
  await baseNote.scrollIntoViewIfNeeded()
  await shot(base.page, '05-base-reads-branch-note-and-version')

  await branch.ctx.close()
  await base.ctx.close()
})
