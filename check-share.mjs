import { chromium } from '@playwright/test';

const url = process.argv[2];
if (!url) {
  console.error('usage: node check-share.mjs <url>');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleMsgs = [];
page.on('console', (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleMsgs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(4000);

try {
  await page.getByText('Download and decrypt', { exact: false }).click({ timeout: 5000 });
  await page.waitForTimeout(3000);
} catch (e) {
  console.log('CLICK_FAILED:', e.message);
}

const bodyText = await page.evaluate(() => document.body.innerText);
const title = await page.title();
const screenshotPath = process.argv[3] || '/tmp/share-page.png';
await page.screenshot({ path: screenshotPath, fullPage: true });

console.log('TITLE:', title);
console.log('---BODY TEXT---');
console.log(bodyText.slice(0, 2000));
console.log('---CONSOLE---');
console.log(consoleMsgs.slice(-40).join('\n'));
console.log('---SCREENSHOT---', screenshotPath);

await browser.close();
