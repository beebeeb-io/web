import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Task 1745 — onboarding renderer, real browser.
 *
 * Renders golden documents from the vendored contract through the SAME
 * `OnboardingRenderer` the flagged live signup uses, at /dev/onboarding/<name>.
 * No server: every /api call is answered 401 here, and the fixture page stubs
 * the actions. The password policy, breach gate and recovery phrase run on the
 * real core WASM, so the signup walk exercises core, not a mock of it.
 *
 * Screenshots go to E2E_EVIDENCE_DIR (default: the workspace task evidence
 * folder for 1745).
 */

const EVIDENCE =
  process.env.E2E_EVIDENCE_DIR ??
  '/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/1745'

const CONTRACT_FIXTURES = join(__dirname, '..', 'src', 'contracts', 'onboarding', 'fixtures')

test.beforeAll(() => {
  mkdirSync(join(EVIDENCE, 'all'), { recursive: true })
})

test.beforeEach(async ({ page }) => {
  // No backend in this harness. The app shell may ask who is signed in: nobody.
  await page.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }))
  // Only the API namespace: `**/api/**` would also catch Vite's own module URL
  // /packages/shared/src/api/index.ts and blank the page.
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/'),
    (r) =>
      r.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized' }),
      }),
  )
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
      // Keep the cookie banner out of the evidence screenshots.
      localStorage.setItem('bb_cookie_consent', 'essential')
    } catch {
      /* ignore */
    }
  })
})

async function open(page: Page, fixture: string) {
  await page.goto(`/dev/onboarding/${fixture}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('fixture-root')).toBeVisible({ timeout: 30_000 })
}

function screen(page: Page) {
  return page.getByTestId('onboarding-screen')
}

async function events(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __onboardingEvents?: string[] }).__onboardingEvents ?? [])
}

/** Let the auth card's entrance animation finish so screenshots are sharp. */
async function shot(page: Page, path: string, fullPage = false) {
  await page.waitForTimeout(450)
  await page.screenshot({ path, fullPage })
}

const STRONG = 'Correct-Horse-Battery-9'

test.describe('1745 onboarding renderer', () => {
  test('web new signup: email, code, terms, password (core meter), recovery phrase (core), create_account', async ({ page }) => {
    await open(page, 'pre_account.web')
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:enter_email')
    await expect(page.getByTestId('region-line')).toContainText('Stored in the EU.')
    await shot(page, join(EVIDENCE, '01-web-signup-email.png'))

    // enter_email
    await page.getByTestId('onboarding-email').fill('new.person@beebeeb.io')
    await page.getByRole('button', { name: /^continue$/i }).click()

    // verify_email_code: anti-enumeration copy, identical for every address
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
    await expect(page.getByText('If this address can be used, we sent an email.')).toBeVisible()
    await expect(page.getByTestId('ask-again-at')).toContainText('You can ask for a new code in')
    // The wait is the document's resend_after_seconds (60 in the fixture) and it ticks (task 1738).
    await expect(page.getByTestId('ask-again-at')).toContainText(/0:[0-5]\d|1:00/)
    const countdownBefore = await page.getByTestId('ask-again-at').innerText()
    await page.waitForTimeout(2200)
    expect(await page.getByTestId('ask-again-at').innerText()).not.toBe(countdownBefore)
    await page.getByTestId('onboarding-code').fill('00000000')
    await page.getByRole('button', { name: /^verify$/i }).click()
    await expect(page.getByTestId('onboarding-error')).toContainText('not right')
    await shot(page, join(EVIDENCE, '02-web-signup-code-wrong.png'))
    await page.getByTestId('onboarding-code').fill('12345678')
    await page.getByRole('button', { name: /^verify$/i }).click()

    // accept_terms
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:accept_terms')
    await expect(page.getByTestId('accept-terms-continue')).toBeDisabled()
    await page.getByRole('checkbox').nth(0).click()
    await expect(page.getByTestId('accept-terms-continue')).toBeDisabled()
    await page.getByRole('checkbox').nth(1).click()
    await shot(page, join(EVIDENCE, '03-web-signup-terms.png'))
    await page.getByTestId('accept-terms-continue').click()

    // set_password: the meter and the hint come from core's evaluator
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
    await page.getByTestId('onboarding-password').fill('abc12')
    await expect(page.getByTestId('password-strength-message')).toContainText('Needs at least 12 characters, 7 more.')
    await page.getByTestId('onboarding-password').fill('abcdefghijkl')
    await expect(page.getByTestId('password-strength-message')).toContainText(/upper|number or symbol/i)
    await page.getByTestId('onboarding-password').fill(STRONG)
    await expect(page.getByTestId('password-strength-message')).toHaveText('Strong.')
    await page.getByTestId('onboarding-password-confirm').fill('Correct-Horse-Battery-8')
    await expect(page.getByTestId('confirm-mismatch')).toBeVisible()
    await expect(page.getByTestId('set-password-continue')).toBeDisabled()
    await page.getByTestId('onboarding-password-confirm').fill(STRONG)
    await expect(page.getByTestId('confirm-match')).toBeVisible()
    await shot(page, join(EVIDENCE, '04-web-signup-password.png'))
    await page.getByTestId('set-password-continue').click()

    // save_recovery_phrase: 12 real words from core
    await expect(page.getByTestId('phrase-words')).toBeVisible({ timeout: 30_000 })
    const words: string[] = []
    for (let i = 1; i <= 12; i++) {
      words.push((await page.getByTestId(`phrase-word-${i}`).innerText()).trim())
    }
    expect(words.length).toBe(12)
    for (const w of words) expect(w).toMatch(/^[a-z]{3,}$/)
    await shot(page, join(EVIDENCE, '05-web-signup-phrase.png'))
    await expect(page.getByTestId('phrase-saved')).toBeDisabled()
    await page.getByRole('checkbox').click()
    await page.getByTestId('phrase-saved').click()

    // confirm_phrase: core picks the positions; a wrong word is refused by core
    const inputs = page.locator('[data-testid^="phrase-answer-"]')
    await expect(inputs).toHaveCount(3)
    const positions: number[] = []
    for (let i = 0; i < 3; i++) {
      const id = await inputs.nth(i).getAttribute('data-testid')
      positions.push(Number(id!.replace('phrase-answer-', '')))
    }
    for (const pos of positions) await page.getByTestId(`phrase-answer-${pos}`).fill('wrongword')
    await page.getByRole('button', { name: /^confirm$/i }).click()
    await expect(page.getByTestId('onboarding-error')).toContainText('do not match your recovery phrase')
    await shot(page, join(EVIDENCE, '06-web-signup-phrase-wrong.png'))
    for (const pos of positions) await page.getByTestId(`phrase-answer-${pos}`).fill(words[pos - 1])
    await page.getByRole('button', { name: /^confirm$/i }).click()

    // create_account: there is no server on the fixture page. The flow reaches the step,
    // runs core's startRegistration, and stops at the stubbed register-start.
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:create_account')
    await expect(page.getByTestId('onboarding-error')).toContainText('We could not create your account', { timeout: 30_000 })
    await shot(page, join(EVIDENCE, '07-web-signup-create-account-stub.png'))

    const ev = await events(page)
    expect(ev).toContain('email_start:new.person@beebeeb.io')
    expect(ev).toContain('register_start')
  })

  /** Walk pre_account.web to the password step (email, code, terms), using the fixture's stubs. */
  async function walkToPassword(page: Page, query = '') {
    await page.goto(`/dev/onboarding/pre_account.web${query}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('fixture-root')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('onboarding-email').fill('breach.test@beebeeb.io')
    await page.getByRole('button', { name: /^continue$/i }).click()
    await page.getByTestId('onboarding-code').fill('12345678')
    await page.getByRole('button', { name: /^verify$/i }).click()
    await page.getByRole('checkbox').nth(0).click()
    await page.getByRole('checkbox').nth(1).click()
    await page.getByTestId('accept-terms-continue').click()
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:set_password', { timeout: 30_000 })
  }

  test('breach gate: core refuses a breached password; an outage with fail_open=true lets it through', async ({ page }) => {
    await walkToPassword(page)
    await page.getByTestId('onboarding-password').fill('Breached-Password-1')
    await page.getByTestId('onboarding-password-confirm').fill('Breached-Password-1')
    await page.getByTestId('set-password-continue').click()
    await expect(page.getByTestId('onboarding-error')).toContainText('appears in known data breaches')
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:set_password')
    await shot(page, join(EVIDENCE, '08-password-breached.png'))

    // A clean password on the same page passes the same gate.
    await page.getByTestId('onboarding-password').fill(STRONG)
    await page.getByTestId('onboarding-password-confirm').fill(STRONG)
    await page.getByTestId('set-password-continue').click()
    await expect(page.getByTestId('phrase-words')).toBeVisible({ timeout: 30_000 })

    // Outage: the endpoint fails, the document says fail_open=true, core lets the breached password pass.
    await walkToPassword(page, '?breach=down')
    await page.getByTestId('onboarding-password').fill('Breached-Password-1')
    await page.getByTestId('onboarding-password-confirm').fill('Breached-Password-1')
    await page.getByTestId('set-password-continue').click()
    await expect(page.getByTestId('phrase-words')).toBeVisible({ timeout: 30_000 })

    // Same outage, but the document says fail_open=false: core blocks, the page stays on the step.
    await walkToPassword(page, '?breach=down&failopen=0')
    await page.getByTestId('onboarding-password').fill(STRONG)
    await page.getByTestId('onboarding-password-confirm').fill(STRONG)
    await page.getByTestId('set-password-continue').click()
    await expect(page.getByTestId('onboarding-error')).toContainText('could not check this password')
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:set_password')
    await shot(page, join(EVIDENCE, '09-password-breach-check-blocked.png'))
  })

  test('back from the code step to the email step, then a DIFFERENT address sends a new email (ceremony.emailChanged path)', async ({ page }) => {
    await open(page, 'pre_account.web')
    await page.getByTestId('onboarding-email').fill('first@beebeeb.io')
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
    await page.getByTestId('use-different-email').click()
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:enter_email')
    // same address again: no second email
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
    await page.getByTestId('use-different-email').click()
    await page.getByTestId('onboarding-email').fill('second@beebeeb.io')
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
    const ev = (await events(page)).filter((e) => e.startsWith('email_start:'))
    expect(ev).toEqual(['email_start:first@beebeeb.io', 'email_start:second@beebeeb.io'])
  })

  test('trialing_no_card (desktop fixture): trial running over the allowance', async ({ page }) => {
    await open(page, 'account.trialing_no_card.desktop')
    await expect(screen(page)).toHaveAttribute('data-screen', 'account:trialing_no_card')
    await expect(page.getByRole('heading', { name: 'Your trial runs until 18 Oct 2026' })).toBeVisible()
    await expect(page.getByTestId('account-state')).toHaveAttribute('data-tone', 'attention')
    await expect(page.getByText('No card is on file, so nothing will be charged.')).toBeVisible()
    await expect(page.getByText('Your trial ends on 18 Oct. Files above 2 GB become read-only')).toBeVisible()
    await expect(page.getByTestId('usage-used')).toHaveText('6.3 GB used')
    await expect(page.getByTestId('usage-quota')).toHaveText('of 10 GB')
    await expect(page.getByTestId('usage-over-allowance')).toHaveText(
      'The trial allows up to 10 GB. After it ends, the 2 GB allowance applies.',
    )
    await expect(page.getByText('allowance is exceeded')).toHaveCount(0)
    await expect(page.locator('[data-capability="share"]')).toContainText('Up to 5 active links')
    await expect(page.locator('[data-capability="download"] svg.text-green')).toHaveCount(0)
    await shot(page, join(EVIDENCE, '10-trialing-no-card.png'), true)
    await shot(page, join(EVIDENCE, 'r2-trialing-no-card.png'), true)
  })

  test('trial_ended over the allowance (iOS fixture): read-only, deletion date, nothing to buy', async ({ page }) => {
    await open(page, 'account.trial_ended.ios')
    await expect(screen(page)).toHaveAttribute('data-screen', 'account:trial_ended')
    await expect(page.getByRole('heading', { name: 'Your trial has ended' })).toBeVisible()
    await expect(page.getByTestId('account-state')).toHaveAttribute('data-tone', 'restricted')
    await expect(page.getByText('Your trial ended. Files above 2 GB are read-only and will be deleted on 1 Nov')).toBeVisible()
    await expect(page.locator('[data-capability="upload"]')).toContainText('Trial ended')
    await expect(page.getByTestId('plans-managed-note')).toHaveText('Plans are managed from your account on the web.')
    // Fail closed on money: 0 purchase affordances
    await expect(page.locator('a[href*="/billing"]')).toHaveCount(0)
    await expect(page.getByTestId('start-trial')).toHaveCount(0)
    await expect(page.getByTestId('step-choose_plan')).toHaveCount(0)
    await shot(page, join(EVIDENCE, '11-trial-ended-ios.png'), true)
  })

  test('unknown future step: optional is skipped, required stops with the step fallback', async ({ page }) => {
    await open(page, 'forward_compat.unknown_step.ios')
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:enter_email')
    await page.getByTestId('onboarding-email').fill('future@beebeeb.io')
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(screen(page)).toHaveAttribute('data-screen', 'step:verify_email_code')
    await page.getByTestId('onboarding-code').fill('12345678')
    await page.getByRole('button', { name: /^verify$/i }).click()

    await expect(screen(page)).toHaveAttribute('data-screen', 'fallback')
    await expect(page.getByTestId('fallback-step-id')).toHaveText('confirm_phone_number')
    await expect(page.getByTestId('step-fallback-action')).toHaveAttribute('href', 'https://beebeeb.io/signup')
    // the unknown OPTIONAL step never showed
    await expect(page.getByText('future_nice_to_have')).toHaveCount(0)
    await shot(page, join(EVIDENCE, '12-unknown-required-step-fallback.png'))
  })

  test('update_required blocks everything', async ({ page }) => {
    await open(page, 'client.update_required.ios')
    await expect(screen(page)).toHaveAttribute('data-screen', 'update_required')
    await expect(page.getByTestId('onboarding-email')).toHaveCount(0)
    await expect(page.getByTestId('update-required-action')).toBeVisible()
    await shot(page, join(EVIDENCE, '13-update-required.png'))
  })

  test('round 2: an authenticated update_required screen still offers Sign out (contract rule 7); pre-account does not', async ({ page }) => {
    await page.goto('/dev/onboarding/account.active.web?client=update_required', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('fixture-root')).toBeVisible({ timeout: 30_000 })
    await expect(screen(page)).toHaveAttribute('data-screen', 'update_required')
    await expect(page.getByTestId('update-required-action')).toBeVisible()
    await expect(page.getByTestId('update-required-sign-out')).toBeVisible()
    await shot(page, join(EVIDENCE, 'r2-update-required-account-sign-out.png'))
    await page.getByTestId('update-required-sign-out').click()
    await expect.poll(() => events(page)).toContain('sign_out')

    await page.goto('/dev/onboarding/client.update_required.ios', { waitUntil: 'domcontentloaded' })
    await expect(screen(page)).toHaveAttribute('data-screen', 'update_required')
    await expect(page.getByTestId('update-required-sign-out')).toHaveCount(0)
  })

  test('round 2: after register-finish succeeded the recovery screen offers sign in, never try again or start over', async ({ page }) => {
    await page.goto('/dev/onboarding/pre_account.web?screen=account_created_setup_failed', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('fixture-root')).toBeVisible({ timeout: 30_000 })
    await expect(screen(page)).toHaveAttribute('data-screen', 'account_created_setup_failed')
    await expect(page.getByRole('heading', { name: 'Your account was created' })).toBeVisible()
    await expect(page.getByTestId('account-created-sign-in')).toHaveAttribute('href', '/login')
    await expect(page.getByRole('button', { name: /try again|start over/i })).toHaveCount(0)
    await shot(page, join(EVIDENCE, 'r2-account-created-setup-failed.png'))
  })

  test('web allowance: plans link and the no-card trial offer are drawn (offer available)', async ({ page }) => {
    await open(page, 'account.allowance.web')
    await expect(page.getByRole('heading', { name: 'You have 2 GB to start with' })).toBeVisible()
    await expect(page.getByTestId('step-choose_plan')).toBeVisible()
    await expect(page.getByText('Start a 14-day trial')).toBeVisible()
    await page.getByTestId('start-trial').click()
    await expect.poll(() => events(page)).toContain('start_trial:/api/v1/billing/trial/start')
    await shot(page, join(EVIDENCE, '14-allowance-web.png'), true)
  })

  test('every one of the 19 fixtures renders a screen in a real browser (no crash, no blank page)', async ({ page }) => {
    const files = readdirSync(CONTRACT_FIXTURES).filter((f) => f.endsWith('.json')).sort()
    expect(files.length).toBe(19)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    for (const f of files) {
      const name = f.replace(/\.json$/, '')
      await open(page, name)
      await expect(screen(page)).toBeVisible()
      const marker = await screen(page).getAttribute('data-screen')
      expect(marker, name).toBeTruthy()
      await shot(page, join(EVIDENCE, 'all', `${name}.png`), true)
    }
    expect(errors).toEqual([])
  })
})
