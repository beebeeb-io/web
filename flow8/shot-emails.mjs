import { chromium } from '@playwright/test'
import fs from 'fs'
const d = process.argv[2]
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 640, height: 900 } })
const out = []
for (const f of fs.readdirSync(d).filter(f => f.endsWith('.html')).sort()) {
  await p.goto('file://' + d + '/' + f)
  await p.screenshot({ path: d + '/' + f.replace('.html', '.png'), fullPage: true })
  const links = await p.$$eval('a', as => as.map(a => a.getAttribute('href')))
  out.push(f + ' ' + JSON.stringify(links))
}
fs.writeFileSync(d + '/links.txt', out.join('\n') + '\n')
await b.close()
