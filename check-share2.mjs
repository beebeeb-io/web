import { chromium } from '@playwright/test';
import fs from 'node:fs';

const url = process.argv[2];
const outPng = process.argv[3];
const downloadDir = process.argv[4] || '/tmp';

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleMsgs = [];
page.on('console', (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleMsgs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2500);

let downloadPath = null;
try {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByText('Download and decrypt', { exact: false }).click(),
  ]);
  downloadPath = `${downloadDir}/downloaded-${download.suggestedFilename()}`;
  await download.saveAs(downloadPath);
  console.log('DOWNLOAD_SAVED:', downloadPath, 'suggestedFilename=', download.suggestedFilename());
} catch (e) {
  console.log('DOWNLOAD_FAILED:', e.message);
}

await page.waitForTimeout(2000);
const bodyText = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: outPng, fullPage: true });

console.log('---BODY TEXT AFTER DOWNLOAD---');
console.log(bodyText.slice(0, 1500));
console.log('---CONSOLE (last 20)---');
console.log(consoleMsgs.slice(-20).join('\n'));

if (downloadPath && fs.existsSync(downloadPath)) {
  const buf = fs.readFileSync(downloadPath);
  console.log('DOWNLOADED_BYTES:', buf.length);
  console.log('DOWNLOADED_HEX_HEAD:', buf.subarray(0, 16).toString('hex'));
}

await browser.close();
