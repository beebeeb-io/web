import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { openRowMenu, uploadTextFile } from './helpers/drive'

// Release-window rung only. Uploads go through the API, never direct upload.
// Use a preconfigured LOCAL API + MinIO, with CORS already installed by the lead.
const web = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const api = process.env.E2E_API_URL ?? 'http://localhost:3003'
const pair = process.env.VITE_DEV_STORAGE_PAIR ? JSON.parse(process.env.VITE_DEV_STORAGE_PAIR) as { host: string; bucket: string } : null
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
test.skip(process.env.BB_E2E_STORAGE !== 'minio', 'Release-window local MinIO rung; run with BB_E2E_STORAGE=minio')
test.beforeAll(() => {
  for (const base of [web, api]) {
    const url = new URL(base)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('2173 browser rung requires local stack')
  }
  if (!pair) throw new Error('VITE_DEV_STORAGE_PAIR is required; zero matching tests is not evidence')
})

async function saved(page: Page, name: string, expected: Buffer) {
  await openRowMenu(page, name)
  const pending = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /^Download/ }).click()
  const download = await pending
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).toBeTruthy()
  expect(digest(await readFile(path!))).toBe(digest(expected))
}

for (const mode of ['direct', 'api', 'cors-refused', 'redirect', 'missing-pair'] as const) {
  test(`2173 download-only ${mode}: byte-identical saved file`, async ({ page }) => {
    const storage = `http://${pair!.host}/${pair!.bucket}/`
    let gets = 0, grants = 0, options = 0
    page.on('request', req => {
      if (req.url().startsWith(storage)) { if (req.method() === 'GET') gets++; if (req.method() === 'OPTIONS') options++ }
      if (req.url().endsWith('/download-grants')) grants++
    })
    await page.goto('/')
    // Support switch also forces the seed upload through the API on future W3 builds.
    await page.evaluate(() => localStorage.setItem('bb.transport', 'api'))
    const payload = Buffer.from(`2173 ${mode} direct download test\n`)
    const name = `2173-${mode}-${Date.now()}.txt`
    await uploadTextFile(page, name, payload.toString())
    if (mode !== 'api') await page.evaluate(() => localStorage.removeItem('bb.transport'))
    if (mode === 'cors-refused') await page.route(`${storage}**`, route => route.abort('failed'))
    if (mode === 'redirect') await page.route(`${storage}**`, route => route.fulfill({ status: 302, headers: { Location: `${storage}redirect-target` } }))
    if (mode === 'missing-pair') await page.route('**/transfer/capabilities', async route => {
      const response = await route.fetch()
      const body = await response.json()
      body.storage_buckets.push({ host: pair!.host, bucket: 'unlisted-test-bucket' })
      await route.fulfill({ response, json: body })
    })
    await saved(page, name, payload)
    expect(options).toBe(0) // GET has no non-safelisted request headers.
    if (mode === 'direct') { expect(gets).toBeGreaterThan(0); expect(grants).toBeGreaterThan(0) }
    if (mode === 'api' || mode === 'missing-pair') { expect(gets).toBe(0); expect(grants).toBe(0) }
    if (mode === 'cors-refused' || mode === 'redirect') {
      expect(gets).toBeGreaterThan(0); expect(gets).toBeLessThanOrEqual(16)
      // Same signed-in session: second file performs zero storage requests after the breaker.
      await page.evaluate(() => localStorage.setItem('bb.transport', 'api'))
      const second = name.replace('.txt', '-second.txt')
      await uploadTextFile(page, second, payload.toString())
      await page.evaluate(() => localStorage.removeItem('bb.transport'))
      const before = gets
      await saved(page, second, payload)
      expect(gets - before).toBe(0)
    }
  })
}
