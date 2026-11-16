import { test } from '@playwright/test'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fillSignupForm, reachPasswordStep, createAccount } from './helpers/signup'

// Creates the QA accounts through the real web signup (real vault keys, so the desktop app can sign in with them).
const OUT = process.env.KIT_ACCOUNTS_OUT ?? '/private/tmp/kit1887-accounts.json'
const who = (process.env.KIT_ACCOUNTS ?? 'a,b').split(',')
for (const w of who) {
  test(`create ${w}`, async ({ page }) => {
    const email = w === 'r' ? 'qa-1887-r@beebeeb.io' : `qa-1887-${w}@beebeeb.io`
    const password = `Qa1887${w}-${crypto.randomBytes(6).toString('hex')}`
    page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)))
    page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)))
    page.on('requestfailed', (r) => console.log('reqfail', r.url().slice(0, 120), r.failure()?.errorText))
    await page.goto('/?nodev=1')
    await page.waitForTimeout(1500)
    // A fresh account lands on the "Choose your plan" step (billing). The account and its vault exist by then; the kit
    // grants it the grandfathered no-plan-required state in the DB afterwards, so no payment step is ever driven.
    await fillSignupForm(page, { email })
    const words = await reachPasswordStep(page)
    await createAccount(page, password)
    await page.getByText(/Choose your plan/i).waitFor({ timeout: 60_000 })
    const acct = { recoveryPhrase: words.join(' ') }
    const cur = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
    cur[w] = { email, password, recoveryPhrase: acct.recoveryPhrase }
    fs.writeFileSync(OUT, JSON.stringify(cur, null, 2), { mode: 0o600 })
  })
}
