import { chromium } from '@playwright/test'
import fs from 'fs'
const E = process.env.E
const b = await chromium.launch(); const ctx = await b.newContext()
await ctx.route('**/dev/auto-login', r => r.fulfill({ status: 404 }))
const p = await ctx.newPage()
for (const [name, path] of [['email-confirm','/settings/email/confirm?token=abc&nodev=1'],['reset','/reset/abc?nodev=1'],['recover','/recover-with-phrase?nodev=1'],['unlock','/unlock/abc?nodev=1'],['billing','/billing?nodev=1']]) {
  await p.goto('http://localhost:5381' + path); await p.waitForTimeout(2500)
  const t = (await p.locator('body').innerText()).replace(/\s+/g,' ').replace(/We use session cookies.*?Accept all/,'').slice(0, 300)
  console.log(name, '|', p.url(), '|', t)
  await p.screenshot({ path: `${E}/link-${name}.png` })
}
await b.close()
