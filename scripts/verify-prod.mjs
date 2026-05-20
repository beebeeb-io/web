#!/usr/bin/env node
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5173'
const SHOTS = '/tmp/screenshots/prod-verify'
mkdirSync(SHOTS, { recursive: true })

let step = 0
async function shot(page, name) {
  step++
  const path = `${SHOTS}/${String(step).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path, fullPage: false })
  console.log(`  [${step}] ${path}`)
  return path
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', err => errors.push(err.message))

  try {
    // Load the app — localhost auto-logs in as dev@beebeeb.dev
    console.log(`Testing against ${BASE}`)
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)
    await shot(page, 'initial-load')

    // Accept cookies if banner present
    const acceptBtn = page.locator('button:has-text("Accept"), button:has-text("Essential only")')
    if (await acceptBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptBtn.first().click()
      await page.waitForTimeout(500)
    }

    // Skip onboarding tour if present
    const skipTour = page.locator('button:has-text("Skip tour"), button:has-text("Skip")')
    if (await skipTour.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipTour.first().click()
      await page.waitForTimeout(500)
    }

    const pagesToTest = [
      ['drive', '/'],
      ['trash', '/trash'],
      ['recent', '/recent'],
      ['photos', '/photos'],
      ['starred', '/starred'],
      ['billing', '/settings/billing'],
      ['referrals', '/settings/referrals'],
      ['developer', '/settings/developer'],
      ['notifications', '/settings/notifications'],
      ['activity', '/settings/activity'],
      ['privacy', '/settings/privacy'],
    ]

    const results = []

    for (const [name, path] of pagesToTest) {
      console.log(`\n--- ${name} (${path}) ---`)
      const errsBefore = errors.length
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(2000)
      await shot(page, name)

      const body = await page.textContent('body').catch(() => '')
      const errsAfter = errors.length
      const pageErrors = errsAfter - errsBefore

      let status = 'OK'
      if (body.includes('Something went wrong')) status = 'CRASHED'
      else if (body.includes('Welcome back') || body.includes('Sign in')) status = 'AUTH_LOST'
      else if (body.includes('Page not found') || body.includes('404')) status = '404'

      // Page-specific checks
      if (name === 'referrals' && body.includes('Coming soon')) console.log('  PASS: Shows "Coming soon"')
      if (name === 'developer' && body.includes('Coming soon')) console.log('  PASS: Shows "Coming soon"')
      if (name === 'notifications' && (body.includes('SECURITY') || body.includes('Security'))) console.log('  PASS: Has Security section')
      if (name === 'notifications' && (body.includes('IN-APP') || body.includes('In-app'))) console.log('  PASS: Has In-app/Email columns')

      results.push({ name, status, pageErrors })
      console.log(`  Status: ${status} | Console errors: ${pageErrors}`)
    }

    // Summary
    console.log('\n\n=== RESULTS ===')
    for (const r of results) {
      const icon = r.status === 'OK' ? 'PASS' : 'FAIL'
      console.log(`  [${icon}] ${r.name}: ${r.status}${r.pageErrors > 0 ? ` (${r.pageErrors} errors)` : ''}`)
    }

    console.log('\n=== CONSOLE ERRORS ===')
    const uniqueErrors = [...new Set(errors)]
    if (uniqueErrors.length === 0) {
      console.log('  None!')
    } else {
      console.log(`  ${uniqueErrors.length} unique errors:`)
      uniqueErrors.forEach(e => console.log(`  - ${e.slice(0, 200)}`))
    }
    console.log(`\n${step} screenshots in ${SHOTS}/`)

  } catch (err) {
    console.error('FAILED:', err.message)
    await shot(page, 'fatal-error')
  } finally {
    await browser.close()
  }
})()
