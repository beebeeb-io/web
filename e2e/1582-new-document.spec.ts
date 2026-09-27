/**
 * Task 1582 — Drive "+ New": create a document, spreadsheet, presentation,
 * text or Markdown file in the current folder, encrypted on this device, and
 * open it straight in the right editor.
 *
 * Rungs (task file ## Verification):
 *   - Build flag off (a build without VITE_FEATURE_OFFICE_EDITOR): the menu
 *     shows only Folder / Text file / Markdown; keyboard opens and closes it;
 *     light + dark screenshots.
 *   - Build flag on: Document / Spreadsheet / Presentation + More formats
 *     (OpenDocument) with no opt-in anywhere (no Labs key, no query — the
 *     Labs opt-in was dropped, task 1567 / web #118); light + dark.
 *
 * Like e2e/1567-office-build-flag.spec.ts, each flag-specific test skips in
 * the other build flavour, so run this spec once per build:
 *
 *   VITE_FEATURE_OFFICE_EDITOR=true … ./e2e/scripts/web-e2e.sh e2e/1582-new-document.spec.ts
 *   ./e2e/scripts/web-e2e.sh e2e/1582-new-document.spec.ts   (flag off)
 *   - New → Markdown → name → the text editor opens by itself → type → ⌘S →
 *     reload → reopen shows the text; the next default name is unique.
 *   - New → Document → name → the office tab opens → type → save → a fresh
 *     tab reopens the file and its word/document.xml has the text. The
 *     creation upload's chunk body is ciphertext (not a zip, no OOXML part
 *     names).
 *   - New → Spreadsheet → type a cell → save → reopen → the cell is in the
 *     saved sheet1.xml.
 *   - New → Presentation → open → add a slide → save → reopen has 2 slides.
 *
 * Needs the real engine assets (scripts/office-dev-assets.sh) and
 * VITE_FEATURE_OFFICE_EDITOR=true; the office tests skip without them, and
 * in a flag-on run the gate treats any skip other than the flag-off test as
 * a failure.
 *
 *   VITE_FEATURE_OFFICE_EDITOR=true VITE_STATUS_URL=http://localhost:38731 \
 *   E2E_API_PORT=38731 E2E_VITE_PORT=38732 E2E_DB_NAME=beebeeb_web_e2e_1582 \
 *     ./e2e/scripts/web-e2e.sh e2e/1582-new-document.spec.ts
 */
import { test, expect, type Page, type BrowserContext, type Request } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { unzipSync } from 'fflate'
import { previewOverlay, escapeRe, openPreview } from './helpers/thumb-fixtures'

const OFFICE_ASSETS_PRESENT = fs.existsSync('public/office/manifest.json')
const OFFICE_FLAG_ON = process.env.VITE_FEATURE_OFFICE_EDITOR === 'true'
const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? path.join('test-results', '1582-evidence')

async function dismissDevBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Dismiss dev banner' })
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 5_000 })
    await dismiss.click()
  } catch {
    // Never appeared this session.
  }
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) })
}

async function gotoDrive(page: Page, opts: { theme?: 'light' | 'dark' } = {}) {
  // Set once, then reload: an init script would re-apply on every later
  // reload and undo the theme switches below. Only the theme — the office
  // types depend on the build flag alone, never on anything in storage.
  await page.goto('/')
  await page.evaluate((theme) => localStorage.setItem('beebeeb-theme', theme), opts.theme ?? 'light')
  await page.reload()
  await dismissDevBanner(page)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
}

function menuItemIds(page: Page) {
  return page
    .getByTestId('new-menu-list')
    .getByRole('menuitem')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
}

/** Opens + New → `type`, accepts or replaces the default name, submits. */
async function createViaMenu(page: Page, type: string, name?: string): Promise<string> {
  await page.getByTestId('new-menu-trigger').click()
  await page.getByTestId(`new-menu-${type}`).click()
  const dialog = page.getByTestId('new-document-dialog')
  await expect(dialog).toBeVisible()
  const input = dialog.getByTestId('new-document-name')
  if (name) await input.fill(name)
  const finalName = await input.inputValue()
  await dialog.getByTestId('new-document-create').click()
  return finalName
}

/** Captures every chunk PUT body sent while `fn` runs. */
async function captureChunkPuts(page: Page, fn: () => Promise<void>): Promise<Buffer[]> {
  const bodies: Buffer[] = []
  const onReq = (r: Request) => {
    if (r.method() === 'PUT' && /\/chunks\/\d+$/.test(new URL(r.url()).pathname)) {
      const b = r.postDataBuffer()
      if (b) bodies.push(b)
    }
  }
  page.on('request', onReq)
  try {
    await fn()
  } finally {
    page.off('request', onReq)
  }
  return bodies
}

function expectCiphertext(bodies: Buffer[]) {
  expect(bodies.length, 'no chunk PUT observed for the new file').toBeGreaterThan(0)
  for (const b of bodies) {
    // A plaintext OOXML/ODF blank is a zip: starts with PK\x03\x04 and names
    // its parts in clear. Ciphertext must do neither.
    expect(b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(false)
    expect(b.includes(Buffer.from('[Content_Types].xml'))).toBe(false)
    expect(b.includes(Buffer.from('docProps/'))).toBe(false)
  }
}

/** Waits for the create → office tab, returns it once the editor route is up. */
async function officeTabFrom(context: BrowserContext, trigger: () => Promise<unknown>): Promise<Page> {
  const popup = context.waitForEvent('page')
  await trigger()
  const tab = await popup
  await tab.waitForURL(/\/office\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  await dismissDevBanner(tab)
  await tab.getByTestId('office-editor').waitFor({ state: 'visible', timeout: 30_000 })
  return tab
}

function engineFrameHandle(tab: Page) {
  const f = tab.frames().find((fr) => fr.url().includes('bb-office-host.html'))
  expect(f, 'engine iframe missing').toBeTruthy()
  return f!
}

async function engineSave(tab: Page): Promise<Uint8Array> {
  const arr: number[] = await engineFrameHandle(tab).evaluate(async () => {
    const bytes = await (window as unknown as { bbOffice: { save(): Promise<Uint8Array> } }).bbOffice.save()
    return Array.from(bytes)
  })
  return new Uint8Array(arr)
}

async function saveAndExpectVersion2(tab: Page) {
  const saveButton = tab.getByTestId('office-save')
  await expect(saveButton).toBeEnabled({ timeout: 15_000 })
  await saveButton.click()
  await expect(tab.getByTestId('office-status-saved')).toHaveText(/saved as version 2/, { timeout: 45_000 })
}

async function reopen(context: BrowserContext, tab: Page): Promise<Page> {
  const url = tab.url()
  await tab.close()
  const again = await context.newPage()
  await again.goto(url)
  await dismissDevBanner(again)
  await again.getByTestId('office-editor').waitFor({ state: 'visible', timeout: 30_000 })
  return again
}

const td = new TextDecoder()

test.describe('Task 1582 — + New menu', () => {
  test('build flag off: only Folder, Text file and Markdown; keyboard open/close; light + dark', async ({ page }) => {
    test.skip(OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR=true — the build-flag-on test below covers this build')
    await gotoDrive(page)
    const trigger = page.getByTestId('new-menu-trigger')
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // Keyboard: focus the trigger, ArrowDown opens with the first item focused.
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('new-menu-folder')).toBeFocused()
    expect(await menuItemIds(page)).toEqual(['new-menu-folder', 'new-menu-txt', 'new-menu-md'])
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('new-menu-txt')).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByTestId('new-menu-md')).toBeFocused()
    await page.keyboard.press('ArrowDown') // wraps
    await expect(page.getByTestId('new-menu-folder')).toBeFocused()
    await shot(page, 'menu-flag-off-light')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('new-menu-list')).toHaveCount(0)
    await expect(trigger).toBeFocused()

    // Enter on a focused item opens its prompt (real buttons).
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'New text file' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('new-document-dialog')).toHaveCount(0)

    // Folder item still reaches the existing New folder dialog.
    await trigger.click()
    await page.getByTestId('new-menu-folder').click()
    await expect(page.getByRole('dialog', { name: 'New folder' })).toBeVisible()
    await page.getByRole('dialog', { name: 'New folder' }).getByRole('button', { name: 'Cancel' }).click()

    // Dark.
    await page.evaluate(() => localStorage.setItem('beebeeb-theme', 'dark'))
    await page.reload()
    await dismissDevBanner(page)
    await page.getByTestId('new-menu-trigger').click()
    await expect(page.getByTestId('new-menu-list')).toBeVisible()
    await shot(page, 'menu-flag-off-dark')
  })

  test('build flag on: Document, Spreadsheet, Presentation + More formats, no opt-in; light + dark', async ({ page }) => {
    test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true — the build-flag-off test above covers this build')
    await gotoDrive(page)
    // No opt-in anywhere: the build flag alone puts the office types here.
    expect(await page.evaluate(() => localStorage.getItem('bb-office-labs'))).toBeNull()
    expect(new URL(page.url()).search).toBe('')
    await page.getByTestId('new-menu-trigger').click()
    expect(await menuItemIds(page)).toEqual([
      'new-menu-folder',
      'new-menu-docx',
      'new-menu-xlsx',
      'new-menu-pptx',
      'new-menu-more-formats',
      'new-menu-txt',
      'new-menu-md',
    ])
    await expect(page.getByTestId('new-menu-more-formats')).toHaveAttribute('aria-expanded', 'false')
    await shot(page, 'menu-flag-on-light')
    await page.getByTestId('new-menu-more-formats').click()
    await expect(page.getByTestId('new-menu-more-formats')).toHaveAttribute('aria-expanded', 'true')
    expect(await menuItemIds(page)).toEqual([
      'new-menu-folder',
      'new-menu-docx',
      'new-menu-xlsx',
      'new-menu-pptx',
      'new-menu-more-formats',
      'new-menu-odt',
      'new-menu-ods',
      'new-menu-odp',
      'new-menu-txt',
      'new-menu-md',
    ])
    await shot(page, 'menu-flag-on-more-formats-light')

    await page.evaluate(() => localStorage.setItem('beebeeb-theme', 'dark'))
    await page.reload()
    await dismissDevBanner(page)
    await page.getByTestId('new-menu-trigger').click()
    await page.getByTestId('new-menu-more-formats').click()
    await shot(page, 'menu-flag-on-dark')
    // The name prompt, dark.
    await page.getByTestId('new-menu-xlsx').click()
    await expect(page.getByTestId('new-document-name')).toHaveValue(/^Untitled spreadsheet( \d+)?\.xlsx$/)
    await shot(page, 'name-prompt-dark')
  })

  test('command palette: "New Markdown file" from another page lands in Drive with the prompt open', async ({ page }) => {
    await gotoDrive(page)
    await page.goto('/recent')
    await dismissDevBanner(page)
    await page.evaluate(() => window.dispatchEvent(new Event('beebeeb:open-command-palette')))
    const input = page.getByPlaceholder('Type to search or run a command...')
    await input.fill('New Markdown file')
    await input.press('Enter')
    await expect(page).toHaveURL(/\/(\?.*)?$/)
    await expect(page.getByRole('dialog', { name: 'New Markdown file' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('new-document-name')).toHaveValue(/^Untitled( \d+)?\.md$/)
    await expect(page.getByTestId('new-document-create')).toBeEnabled({ timeout: 15_000 })
  })

  test('New → Markdown opens the text editor; ⌘S saves; reload shows the text; next default name is unique', async ({ page }) => {
    test.setTimeout(120_000)
    await gotoDrive(page)
    const marker = `NEW-MD-1582-${process.pid}`

    await page.getByTestId('new-menu-trigger').click()
    await page.getByTestId('new-menu-md').click()
    const input = page.getByTestId('new-document-name')
    const defaultName = await input.inputValue()
    expect(defaultName).toMatch(/^Untitled( \d+)?\.md$/)
    // Extension is appended when left off.
    const base = `Notes ${process.pid}`
    await input.fill(base)
    await page.getByTestId('new-document-create').click()
    const name = `${base}.md`

    const overlay = previewOverlay(page)
    const editor = overlay.getByTestId('file-editor')
    await editor.waitFor({ state: 'visible', timeout: 20_000 })
    await editor.locator('.cm-content').click()
    await page.keyboard.type(`# ${marker}\n\nWritten in a brand-new file.`)
    await expect(editor.getByTestId('editor-status-saved')).toContainText('unsaved changes')
    await page.keyboard.press('ControlOrMeta+S')
    await expect(editor.getByTestId('editor-status-saved')).toContainText('saved as version 2', { timeout: 20_000 })
    await shot(page, 'markdown-saved')

    await page.reload()
    await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 15_000 })
    await dismissDevBanner(page)
    await page.getByRole('row', { name: new RegExp(escapeRe(name)) }).first().waitFor({ timeout: 15_000 })
    await openPreview(page, name)
    await expect(previewOverlay(page).getByRole('heading', { name: marker, level: 1 })).toBeVisible({ timeout: 15_000 })
    await previewOverlay(page).getByTestId('preview-close-button').click()

    // Uniqueness: a file named exactly the default now exists → the prompt
    // proposes the next free name.
    await page.getByTestId('new-menu-trigger').click()
    await page.getByTestId('new-menu-md').click()
    await page.getByTestId('new-document-create').click() // takes the default
    await previewOverlay(page).getByTestId('file-editor').waitFor({ state: 'visible', timeout: 20_000 })
    await previewOverlay(page).getByTestId('preview-close-button').click()
    await page.getByRole('row', { name: new RegExp(escapeRe(defaultName)) }).first().waitFor({ timeout: 15_000 })
    await page.getByTestId('new-menu-trigger').click()
    await page.getByTestId('new-menu-md').click()
    const next = await page.getByTestId('new-document-name').inputValue()
    expect(next).not.toBe(defaultName)
    expect(next).toMatch(/^Untitled \d+\.md$/)
    // And typing a taken name is refused, not silently renamed.
    await page.getByTestId('new-document-name').fill(defaultName)
    await page.getByTestId('new-document-create').click()
    await expect(page.getByTestId('new-document-error')).toContainText('already exists')
  })
})

test.describe('Task 1582 — + New → Office (real engine)', () => {
  test.skip(!OFFICE_ASSETS_PRESENT, 'public/office/manifest.json missing — run scripts/office-dev-assets.sh first')
  test.skip(!OFFICE_FLAG_ON, 'VITE_FEATURE_OFFICE_EDITOR!=true')
  test.setTimeout(240_000)

  test('New → Document: encrypted upload, Writer opens, type, save, reopen shows the text', async ({ page, context }) => {
    await gotoDrive(page)
    const name = `Plan ${process.pid}`
    let tab!: Page
    const bodies = await captureChunkPuts(page, async () => {
      tab = await officeTabFrom(context, () => createViaMenu(page, 'docx', name))
    })
    expectCiphertext(bodies)
    await expect(page.getByRole('row', { name: new RegExp(escapeRe(`${name}.docx`)) }).first()).toBeVisible({ timeout: 15_000 })

    await tab.getByTestId('office-outline-pane').waitFor({ state: 'visible', timeout: 150_000 })
    const canvas = tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas')
    await canvas.waitFor({ state: 'visible', timeout: 30_000 })
    await shot(tab, 'writer-new-blank')
    await canvas.click()
    // Awaited engine round trip before typing — see 1567-office-editor.spec.ts
    // for why a bare keypress races the engine and drops leading characters.
    await engineFrameHandle(tab).evaluate(async () => {
      await (window as unknown as { bbOffice: { dispatch(cmd: string): Promise<unknown> } }).bbOffice.dispatch('.uno:SelectAll')
    })
    const typed = `Hello from a new document ${process.pid}`
    await tab.keyboard.type(typed, { delay: 30 })
    await tab.waitForTimeout(400)
    await expect(tab.getByTestId('office-unsaved-dot')).toBeVisible()
    await saveAndExpectVersion2(tab)

    const again = await reopen(context, tab)
    await again.getByTestId('office-outline-pane').waitFor({ state: 'visible', timeout: 150_000 })
    await again.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
    const files = unzipSync(await engineSave(again))
    expect(td.decode(files['word/document.xml'])).toContain(typed)
    await again.close()
  })

  test('New → Spreadsheet: Calc opens, a cell value survives save + reopen', async ({ page, context }) => {
    await gotoDrive(page)
    const name = `Budget ${process.pid}`
    const tab = await officeTabFrom(context, () => createViaMenu(page, 'xlsx', name))
    await tab.getByTestId('calc-formula-bar').waitFor({ state: 'visible', timeout: 150_000 })
    await tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
    await shot(tab, 'calc-new-blank')

    const box = tab.getByTestId('calc-ref-box')
    await box.fill('B2')
    await box.press('Enter')
    await expect(tab.getByTestId('calc-formula-bar-status')).toHaveText('Went to B2', { timeout: 10_000 })
    await tab.keyboard.type('1582', { delay: 30 })
    await tab.keyboard.press('Enter')
    await tab.waitForTimeout(300)
    await expect(tab.getByTestId('office-unsaved-dot')).toBeVisible()
    await saveAndExpectVersion2(tab)

    const again = await reopen(context, tab)
    await again.getByTestId('calc-formula-bar').waitFor({ state: 'visible', timeout: 150_000 })
    await again.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
    const files = unzipSync(await engineSave(again))
    const sheet = td.decode(files['xl/worksheets/sheet1.xml'])
    expect(sheet).toMatch(/<c r="B2"[^>]*>\s*<v>1582<\/v>/)
    await again.close()
  })

  test('New → Presentation: Impress opens, add a slide, save, reopen has 2 slides', async ({ page, context }) => {
    await gotoDrive(page)
    const name = `Pitch ${process.pid}`
    const tab = await officeTabFrom(context, () => createViaMenu(page, 'pptx', name))
    await tab.getByTestId('impress-filmstrip').waitFor({ state: 'visible', timeout: 150_000 })
    await tab.frameLocator('[data-testid="office-engine-frame"]').locator('#qtcanvas').waitFor({ state: 'visible', timeout: 30_000 })
    const statusBar = tab.getByTestId('office-status-bar')
    await expect(statusBar).toContainText('Slide 1 of 1', { timeout: 15_000 })
    // Fit-to-window zoom (use-impress-fit-zoom.ts) lands after open.
    await expect(tab.getByTestId('office-zoom-slider')).not.toHaveValue('100', { timeout: 15_000 })
    await tab.waitForTimeout(1_000)
    await shot(tab, 'impress-new-blank')
    await tab.getByTestId('impress-ribbon-new-slide').click()
    await expect(statusBar).toContainText('Slide 2 of 2', { timeout: 15_000 })
    await saveAndExpectVersion2(tab)

    const again = await reopen(context, tab)
    await again.getByTestId('impress-filmstrip').waitFor({ state: 'visible', timeout: 150_000 })
    await expect(again.getByTestId('office-status-bar')).toContainText('of 2', { timeout: 20_000 })
    const files = unzipSync(await engineSave(again))
    const slides = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    expect(slides.length).toBe(2)
    await again.close()
  })
})
