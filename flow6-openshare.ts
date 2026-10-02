import { chromium } from '@playwright/test'
const [url, out] = process.argv.slice(2)
const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true })
await ctx.addInitScript(() => { localStorage.setItem('bb_cookie_consent', 'all'); sessionStorage.setItem('bb_dev_authed', 'skipped') })
const p = await ctx.newPage()
await p.goto(url); await p.waitForTimeout(6000)
await p.screenshot({ path: out + '.png', fullPage: true })
const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600)
console.log('BODY', txt)
const dl = p.getByRole('button', { name: /download/i }).first()
if (await dl.count()) {
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }).catch(() => null), dl.click()])
  if (d) { await d.saveAs(out + '.download'); console.log('DOWNLOADED', await d.suggestedFilename()) } else console.log('NO_DOWNLOAD_EVENT')
}
await b.close()
