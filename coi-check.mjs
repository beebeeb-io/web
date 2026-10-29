import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:39912/coi-test/parent.html', { waitUntil: 'load', timeout: 15000 })
await page.waitForTimeout(500)
const frame = page.frames().find(f => f.url().includes('coi-check.html'))
if (!frame) {
  console.log('NO IFRAME FOUND. frames:', page.frames().map(f => f.url()))
} else {
  const coi = await frame.evaluate(() => window.crossOriginIsolated)
  const sab = await frame.evaluate(() => typeof SharedArrayBuffer !== 'undefined')
  console.log('IFRAME crossOriginIsolated:', coi, 'hasSAB:', sab)
}
console.log('PARENT crossOriginIsolated:', await page.evaluate(() => window.crossOriginIsolated))
await browser.close()
