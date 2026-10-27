import { test, expect, type Locator, type Page } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { uploadTextFile, openRowMenu } from './helpers/drive'
import { signupAndUnlock, uniqueEmail } from './helpers/signup'
import { anonymousContext } from './helpers/auth'

/**
 * Task 2238 — "Share link" on a FOLDER.
 *
 * Before this task the dialog minted a `share_type: 'file'` share over the
 * folder's own row, and the public page then failed with the server's
 * `400 cannot download a folder`. Until shared folders ship (spec
 * 2026-10-27 §9) a folder link is a SNAPSHOT BUNDLE of every non-trashed file
 * in the subtree, as it is right now. A bundle is flat, so the public page
 * lists each item under its own plain file name (a duplicate name in two
 * subfolders is allowed — the item id tells them apart).
 *
 * This spec proves the whole path end to end against the isolated harness API:
 *   - the dialog states the snapshot copy and mints a bundle, with the link in
 *     today's `#key=`-only format,
 *   - the public page lists every file in the subtree, including the one in
 *     the subfolder,
 *   - one item downloads and decrypts to the SAME sha256 as the uploaded bytes,
 *   - an empty folder says "Nothing to share yet" and refuses to mint,
 *   - a link created the OLD way (a `file` share on a folder id) shows the
 *     "made before folder links existed" message instead of the raw refusal.
 */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function dismissIfShown(locator: Locator, timeoutMs = 6_000): Promise<void> {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs })
    await locator.click()
  } catch {
    // Never appeared within the budget — nothing to dismiss.
  }
}

async function dismissFirstRunOverlays(page: Page): Promise<void> {
  await dismissIfShown(page.getByRole('button', { name: 'Essential only' }))
  await dismissIfShown(page.getByRole('button', { name: /^Skip for now$/ }))
  await dismissIfShown(
    page.getByRole('dialog', { name: /Upload your first file/i }).getByRole('button', { name: /Skip tour/i }),
  )
  await dismissIfShown(page.getByRole('button', { name: 'Dismiss verification banner' }))
}

/** Create a folder via the toolbar's "+ New" → Folder dialog and wait for its row. */
async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByTestId('new-menu-trigger').click()
  await page.getByTestId('new-menu-folder').click()
  const dialog = page.getByRole('dialog', { name: 'New folder' })
  await dialog.getByPlaceholder('e.g. Contracts').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await page
    .getByRole('row', { name: new RegExp(`${escapeRe(name)}, folder`) })
    .first()
    .waitFor({ timeout: 15_000 })
}

async function enterFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('row', { name: new RegExp(`${escapeRe(name)}, folder`) }).first().dblclick()
  await expect(page).toHaveURL(/[?&]folder=/, { timeout: 10_000 })
  // The URL flips as soon as the navigation starts, but the file list re-fetches
  // AFTER it. Uploading in that window binds the upload to the folder we just
  // left (run 1 of this spec: the 2024 upload landed nowhere, and the dialog
  // honestly reported "1 files"). Give the list one refresh beat — verified in
  // e2e/2238-debug-fixture.spec.ts, where the same wait makes the nested upload
  // land and the dialog read "Shares the 2 files…".
  await page.waitForTimeout(1_500)
}

/** Upload and prove the row is the LIST's own, not a transient upload chip. */
async function uploadAndConfirmRow(page: Page, filename: string, body: string): Promise<void> {
  await uploadTextFile(page, filename, body)
  await expect(
    page.getByRole('row', { name: new RegExp(escapeRe(filename)) }),
    'the uploaded file must be a persisted row in the folder we are looking at',
  ).toHaveCount(1, { timeout: 30_000 })
}

/**
 * Click Generate and return the full link. If the dialog never reaches the
 * result, print what the dialog actually says — a silent 30 s wait hides the
 * server/client error the owner would be looking at.
 */
async function generateFullLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: /generate encrypted link/i }).click()
  // The result card IS the link (task 1690): a read-only input holding the whole
  // /s/<token>#key=… string. There is no separate "Full link" tab any more, so
  // wait for the input itself.
  const linkInput = page.locator('input[readonly]')
  try {
    await expect
      .poll(
        async () =>
          (await linkInput.evaluateAll((els) =>
            (els as HTMLInputElement[]).find((e) => /\/s\/[^#]+#key=/.test(e.value))?.value ?? null,
          )) as string | null,
        { timeout: 30_000 },
      )
      .not.toBeNull()
  } catch {
    const dialog = page.getByRole('dialog').first()
    const text = await dialog.innerText().catch(() => '<no dialog>')
    console.log(`[2238 dialog] ${JSON.stringify(text)}`)
    throw new Error('the share dialog never produced a /s/<token>#key=… link')
  }
  const url = await linkInput.evaluateAll((els) =>
    (els as HTMLInputElement[]).find((e) => /\/s\/[^#]+#key=/.test(e.value))?.value ?? null,
  )
  expect(url, 'a folder link must be a normal /s/<token>#key=… link').toBeTruthy()
  return url!
}

/** One item's row on the public bundle page (name + size + Download). */
function bundleRow(page: Page, displayName: string): Locator {
  return page
    .getByText(displayName, { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"border-line rounded-lg bg-paper-2")][1]')
}

test.describe('2238 — folder share link is a snapshot bundle', () => {
  test.describe.configure({ retries: 0 })

  test('folder + subfolder → link lists every file and one decrypts to the same sha256', async ({ page, browser }) => {
    test.setTimeout(180_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2238-folder'),
      password: '2238FolderBundle-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const stamp = Date.now()
    const folderName = `Holiday ${stamp}`
    const subfolder = '2024'
    const beach = `beach-${stamp}.txt`
    const sunset = `sunset-${stamp}.txt`
    const beachBody = `beach snapshot payload ${stamp}`
    const sunsetBody = `sunset snapshot payload ${stamp}`

    // ── Owner: Holiday/{beach.txt, 2024/sunset.txt} ──────────────────────────
    await createFolder(page, folderName)
    await enterFolder(page, folderName)
    await uploadAndConfirmRow(page, beach, beachBody)
    await createFolder(page, subfolder)
    await enterFolder(page, subfolder)
    await uploadAndConfirmRow(page, sunset, sunsetBody)

    // Back to the drive root to share the folder itself.
    await page.goto('/?nodev=1')
    await page
      .getByRole('row', { name: new RegExp(`${escapeRe(folderName)}, folder`) })
      .first()
      .waitFor({ timeout: 20_000 })

    // ── The dialog says what the link actually is ────────────────────────────
    await openRowMenu(page, folderName)
    await page.getByRole('menuitem', { name: /^Share/ }).click()

    const note = page.getByTestId('folder-snapshot-note')
    await expect(note).toBeVisible({ timeout: 20_000 })
    await expect(note).toContainText(
      'Shares the 2 files in this folder and its subfolders as they are now. Files added later won\'t appear.',
      { timeout: 20_000 },
    )

    const url = await generateFullLink(page)
    expect(url, 'no path sidecar: the link format is unchanged').not.toContain('#p=')
    await page.keyboard.press('Escape')

    const shareToken = new URL(url!).pathname.split('/').pop()
    expect(shareToken, 'link should be /s/<token>#key=…').toBeTruthy()

    // The bundle contract, verified against the API's own metadata: a bundle
    // over 2 items — NOT a `file` share on the folder id (task 2238's core).
    const meta = await (await page.request.get(`${API_URL}/api/v1/shares/${shareToken}`)).json()
    expect(meta.share_type).toBe('bundle')
    expect(meta.item_count).toBe(2)
    expect(meta.items).toHaveLength(2)

    // ── Recipient: the public page, no account ───────────────────────────────
    const anonCtx = await anonymousContext(browser)
    const anon = await anonCtx.newPage()
    await anon.goto(url!)

    // Bundles are flat: the subfolder's file is listed by its own name, and the
    // owner's root-level file by its own — no path prefixes.
    const nestedName = sunset
    await expect(anon.getByText(nestedName, { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(anon.getByText(beach, { exact: true })).toBeVisible({ timeout: 20_000 })

    // ── One file downloads and decrypts to the same bytes ────────────────────
    const downloadPromise = anon.waitForEvent('download', { timeout: 90_000 })
    await bundleRow(anon, nestedName).getByRole('button', { name: /^Download$/ }).click()
    const download = await downloadPromise
    const filePath = await download.path()
    expect(filePath, 'the browser download must have a local file').toBeTruthy()
    const got = createHash('sha256').update(readFileSync(filePath!)).digest('hex')
    const want = createHash('sha256').update(Buffer.from(sunsetBody)).digest('hex')
    expect(got, 'the decrypted download must be byte-identical to what the owner uploaded').toBe(want)

    expect(download.suggestedFilename()).toBe(sunset)

    await anon.screenshot({ path: 'test-results/2238-folder-link-public-page.png', fullPage: true })
    await anonCtx.close()
  })

  test('an empty folder says "Nothing to share yet" and mints nothing', async ({ page }) => {
    test.setTimeout(120_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2238-empty'),
      password: '2238EmptyFolder-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folderName = `Empty ${Date.now()}`
    await createFolder(page, folderName)

    await openRowMenu(page, folderName)
    await page.getByRole('menuitem', { name: /^Share/ }).click()

    const note = page.getByTestId('folder-snapshot-note')
    await expect(note).toContainText('Nothing to share yet', { timeout: 20_000 })
    await expect(page.getByRole('button', { name: /generate encrypted link/i })).toBeDisabled()
  })

  test('a link made before 2238 (file share on a folder id) explains itself instead of failing a download', async ({ page, browser }) => {
    test.setTimeout(120_000)

    await page.goto('/?nodev=1')
    await signupAndUnlock(page, {
      email: uniqueEmail('2238-legacy'),
      password: '2238LegacyFolder-correct-horse-1',
    })
    await dismissFirstRunOverlays(page)

    const folderName = `Legacy ${Date.now()}`
    await createFolder(page, folderName)
    await enterFolder(page, folderName)
    const folderId = new URL(page.url()).searchParams.get('folder')
    expect(folderId, 'the drive puts the folder id in ?folder=').toBeTruthy()
    await page.goto('/?nodev=1')

    // Mint the pre-2238 shape directly: `share_type: 'file'` over the folder's
    // own id. The server accepted (and still accepts) this — that is the bug.
    const created = await page.request.post(`${API_URL}/api/v1/shares`, {
      data: {
        file_id: folderId,
        share_type: 'file',
        wrapped_file_key: randomBytes(60).toString('base64'),
      },
    })
    expect(
      created.status(),
      `POST /shares for a legacy folder link failed: ${created.status()} ${await created.text()}`,
    ).toBe(201)
    const { token: legacyToken } = await created.json()
    const legacyKey = randomBytes(32).toString('base64url')

    const anonCtx = await anonymousContext(browser)
    const anon = await anonCtx.newPage()

    // The client's PRIMARY legacy signal is `is_folder` on the share metadata
    // (legacy-folder-link.ts). The server's single-file branch does not send it
    // yet — that is a separate, unchanged server follow-up — so this test
    // injects it into the REAL response for a REAL broken folder link, which is
    // exactly the shape the page must handle. The second signal (the download
    // refusal, `400 cannot download a folder`) is unit-tested in
    // test/2238-legacy-folder-link.test.ts because a synthetic link cannot hold
    // a usable wrapped key for the folder.
    // The server's single-file branch does not send `is_folder` yet, so this
    // stubs the ONE field the client already reacts to (see isFolderTarget):
    // the page must explain itself on load, without a failed download. The
    // second signal — the `cannot download a folder` refusal — is unit-tested
    // (test/2238-legacy-folder-link.test.ts), because a synthetic share cannot
    // carry a usable wrapped key for a folder row.
    await anon.route(`**/api/v1/shares/${legacyToken}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'legacy-2238',
          share_type: 'file',
          is_folder: true,
          name_encrypted: '',
          size_bytes: 0,
          requires_passphrase: false,
        }),
      }),
    )

    await anon.goto(`/s/${legacyToken}#key=${legacyKey}`)
    await expect(
      anon.getByText(
        'This link was made before folder links existed; ask the owner for a new link',
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60_000 })
    await expect(anon.getByText(/cannot download a folder/i)).toHaveCount(0)

    await anonCtx.close()
  })
})
