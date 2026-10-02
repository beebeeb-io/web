import { chromium } from '@playwright/test'
const b = await chromium.launch(); const p = await b.newPage()
p.on('console', m => console.log('console:', m.text().slice(0,200)))
await p.goto('http://localhost:5350/login'); await p.waitForTimeout(8000)
await p.screenshot({ path: process.argv[2] }); console.log(p.url()); console.log((await p.content()).slice(0, 300))
await b.close()
