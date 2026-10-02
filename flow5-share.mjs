import { chromium } from '@playwright/test'
const [url, pass, shot] = process.argv.slice(2)
const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true }); const p = await ctx.newPage()
p.on('console', m => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0,200)) })
p.on('response', r => { if (r.url().includes('/api/')) console.log('resp', r.status(), r.request().method(), r.url().replace(/^https?:\/\/[^/]+/, '').slice(0,90)) })
await p.goto(url); await p.waitForTimeout(6000)
await p.screenshot({ path: shot + '-1.png' })
const pw = p.getByLabel('Share password')
if (pass && await pw.isVisible().catch(() => false)) {
  await pw.fill(pass); await pw.press('Enter'); await p.waitForTimeout(6000)
}
await p.screenshot({ path: shot + '-2.png', fullPage: true })
const dl = p.getByRole('button', { name: /download/i }).first()
if (await dl.isVisible().catch(() => false)) {
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }).catch(e => null), dl.click()])
  if (d) { await d.saveAs(shot + '-download.bin'); console.log('DOWNLOADED', d.suggestedFilename()) } else console.log('NO DOWNLOAD EVENT')
  await p.waitForTimeout(3000); await p.screenshot({ path: shot + '-3.png' })
}
console.log('TEXT:', (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 900))
await b.close()
