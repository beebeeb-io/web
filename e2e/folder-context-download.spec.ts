/**
 * Flow 3 finding (web core journeys, A10): "Download" in a FOLDER's context
 * menu did nothing — no download, no toast. drive.tsx handleFileAction
 * ('download') called handleFileDownload(), which returns early for
 * `file.is_folder`, while context-menu.tsx still offers Download on folders.
 * The zip path (downloadAsZip) was only reachable via checkbox selection +
 * the bulk Download button.
 *
 * Fix: folder downloads from the context menu (and the details panel) route
 * through handleBulkDownload([id]) → downloadAsZip.
 *
 * This spec uploads a real folder tree through the "Upload folder" input,
 * opens the folder's kebab menu, clicks Download, and requires a .zip whose
 * entries are byte-equal to the fixture tree.
 *
 * Real stack (run via e2e/scripts/web-e2e.sh).
 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { execFileSync } from 'child_process'
import { signupAndUnlock } from './helpers/signup'
import { openRowMenu } from './helpers/drive'

test.use({ storageState: { cookies: [], origins: [] } })

const FOLDER = 'Flow3Folder'

function sha(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(p, base))
    else out.push(path.relative(base, p))
  }
  return out.sort()
}

test('folder context menu > Download produces a zip byte-equal to the folder tree', async ({ page }, testInfo) => {
  test.setTimeout(180_000)

  // Fixture tree: FOLDER/{a.txt, b.bin, sub/c.txt}
  const root = testInfo.outputPath('fixture')
  const tree = path.join(root, FOLDER)
  fs.mkdirSync(path.join(tree, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(tree, 'a.txt'), 'alpha file for folder download\n')
  fs.writeFileSync(path.join(tree, 'b.bin'), crypto.randomBytes(48 * 1024))
  fs.writeFileSync(path.join(tree, 'sub', 'c.txt'), 'nested charlie\n')
  const want: Record<string, string> = {}
  for (const rel of listFiles(tree)) want[rel.split(path.sep).join('/')] = sha(path.join(tree, rel))

  await page.goto('/?nodev=1')
  await signupAndUnlock(page, { password: 'FolderDownloadFlow3!' })
  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()

  await page.locator('input[type=file][webkitdirectory]').first().setInputFiles(tree)
  const folderRow = page.locator('[role=row]').filter({ hasText: FOLDER }).first()
  await expect(folderRow).toBeVisible({ timeout: 90_000 })
  // Let the folder upload settle (all three files encrypted + committed).
  await expect(page.getByText(/Uploading|Encrypting/i)).toHaveCount(0, { timeout: 90_000 }).catch(() => {})

  await openRowMenu(page, FOLDER)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('menuitem', { name: /^Download/ }).first().click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.zip$/)

  const zipPath = testInfo.outputPath('folder.zip')
  await download.saveAs(zipPath)
  const outDir = testInfo.outputPath('unzipped')
  fs.mkdirSync(outDir, { recursive: true })
  execFileSync('unzip', ['-q', zipPath, '-d', outDir])

  // Map each extracted file to its path relative to the folder root (the zip
  // may or may not prefix entries with the folder name itself).
  const got: Record<string, string> = {}
  for (const rel of listFiles(outDir)) {
    const posix = rel.split(path.sep).join('/')
    const key = posix.startsWith(FOLDER + '/') ? posix.slice(FOLDER.length + 1) : posix
    got[key] = sha(path.join(outDir, rel))
  }
  expect(got).toEqual(want)
})
