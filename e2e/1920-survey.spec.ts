/**
 * 1920 — the public exit survey page `/surveys/:id?token=...` (the link in the trial-ended
 * follow-up email), on the REAL stack: a local API built from the server's
 * `feat/1920-exit-survey` branch (server PR #213) on a scratch database, a Vite dev server
 * pointed at it, and invitations seeded straight into `survey_invitations`.
 *
 *   happy      open the link signed out (390 px) -> the form is drawn from the API's questions
 *              -> empty submit is refused inline -> answer (with a detail, a text, the box)
 *              -> thank-you; the token is gone from the address bar; the stored row matches;
 *              no wasm / crypto worker was ever requested
 *   reopen     the same link again -> "You already answered this"
 *   refusals   bad token, unknown id, no token, expired invitation -> ONE identical screen
 *   race       another tab answers first -> submitting here lands on "already answered"
 *   session    a stale session in localStorage does not bounce the page to /login
 *   a11y       every control has an accessible name; the radio group works from the keyboard
 *   outage     an unreachable API -> "We could not load this" and "Try again" recovers (mocked)
 *   refused    a server 400 names its field inline and keeps the answers (mocked 400)
 *
 * E2E_PROD_BUILD=1 runs it against `vite preview` of a production build (see the task notes).
 *
 * Environment (the runner is in the task's notes): E2E_API_URL (the local API), E2E_WEB_URL (Vite
 * started with VITE_API_URL=<api>), E2E_DB_NAME (the scratch DB the API runs on),
 * E2E_PG_CONTAINER (default beebeeb dev postgres container). Screenshots: E2E_EVIDENCE_DIR.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:37961'
const DB_NAME = process.env.E2E_DB_NAME ?? 'bb_1920_web_e2e'
const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'beebeebio-postgres-1'
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? path.join('test-results', '1920')

const shot = (name: string) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  return path.join(EVIDENCE, name)
}

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-e', 'PGPASSWORD=beebeeb_dev', PG_CONTAINER, 'psql', '-U', 'beebeeb', '-d', DB_NAME, '-tA', '-c', sql],
    { encoding: 'utf8' },
  ).trim()
}

interface Invitation {
  id: string
  token: string
  userId: string
}

/** What the server stores: SHA-256 of "beebeeb-survey-token-v1:" + token (survey.rs `hash_token`). */
function hashToken(token: string): string {
  return createHash('sha256').update('beebeeb-survey-token-v1:').update(token).digest('hex')
}

function seedInvitation(opts: { expiresIn?: string; answered?: boolean } = {}): Invitation {
  const userId = randomUUID()
  const id = randomUUID()
  const token = randomBytes(32).toString('base64url')
  psql(
    `INSERT INTO users (id, email, password_hash, salt, email_verified, plan_required) ` +
      `VALUES ('${userId}', 'survey-${userId.slice(0, 8)}@e2e.example', 'x', 'x', TRUE, TRUE)`,
  )
  psql(
    `INSERT INTO survey_invitations (id, user_id, survey_kind, token_hash, expires_at, sent_at, answered_at) ` +
      `VALUES ('${id}', '${userId}', 'trial_ended_v1', decode('${hashToken(token)}', 'hex'), ` +
      `NOW() + INTERVAL '${opts.expiresIn ?? '30 days'}', NOW(), ${opts.answered ? 'NOW()' : 'NULL'})`,
  )
  return { id, token, userId }
}

const link = (inv: { id: string; token: string }) => `/surveys/${inv.id}?token=${inv.token}`
const storedAnswers = (id: string) => psql(`SELECT answers::text FROM survey_responses WHERE invitation_id = '${id}'`)

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'no horizontal scroll').toBeLessThanOrEqual(0)
}

// A first-time visitor sees the app-wide cookie notice, a fixed bar that sits over the bottom of the
// form on a phone until it is answered. Every test records that choice up front so the survey itself
// is what is under test (the notice is not part of this task).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('bb_cookie_consent', 'essential')
    } catch {
      /* storage unavailable */
    }
  })
})

test.beforeAll(async () => {
  const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5_000) }).catch(() => null)
  expect(res?.ok, `the local API must be up at ${API_URL} (E2E_API_URL)`).toBe(true)
  expect(psql('SELECT COUNT(*) FROM survey_invitations'), 'the scratch DB must have the 1920 tables').toMatch(/^\d+$/)
})

test('happy path: open the link, answer, thank-you; the token leaves the address bar; nothing crypto loads', async ({ page }) => {
  const inv = seedInvitation()
  const requested: string[] = []
  page.on('request', (r) => requested.push(r.url()))

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(link(inv))

  // The form is drawn from what the API sends, not from this repo.
  const api = (await (await fetch(`${API_URL}/api/v1/surveys/${inv.id}?token=${inv.token}`)).json()) as {
    title: string
    intro: string
    privacy_note: string
    thanks: { title: string; body: string }
    questions: { id: string; label: string; options?: { value: string; label: string }[] }[]
  }
  await expect(page.getByRole('heading', { name: api.title })).toBeVisible()
  await expect(page.getByText(api.intro)).toBeVisible()
  for (const q of api.questions) {
    await expect(page.getByTestId(`survey-q-${q.id}`), `question ${q.id} is drawn`).toBeVisible()
    await expect(page.getByTestId(`survey-q-${q.id}`)).toContainText(q.label)
  }
  const reason = api.questions.find((q) => q.id === 'reason')!
  await expect(page.getByRole('radio')).toHaveCount(reason.options!.length)
  await expect(page.getByTestId('survey-privacy-note')).toHaveText(api.privacy_note)

  // The token was read once and removed from the address bar (and so from the history entry).
  await expect.poll(() => new URL(page.url()).search, { message: 'token stripped from the URL' }).toBe('')
  expect(page.url()).not.toContain(inv.token)
  expect(await page.evaluate(() => window.location.href)).not.toContain(inv.token)
  await noHorizontalScroll(page)
  await page.screenshot({ path: shot('survey-form-390-light.png'), fullPage: true })

  // Submitting nothing is refused inline, with focus on the first choice; nothing was sent.
  const posts: string[] = []
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/surveys/') && posts.push(r.url()))
  await page.getByTestId('survey-submit').click()
  await expect(page.getByTestId('survey-field-error')).toHaveText('Please choose one answer.')
  await expect(page.getByRole('radio').first()).toBeFocused()
  expect(posts, 'a refused form sends nothing').toEqual([])
  await page.screenshot({ path: shot('survey-form-390-error.png'), fullPage: true })

  // Answer: a choice with a detail, an optional text, the contact box.
  await page.getByRole('radio', { name: 'I was missing a feature' }).check()
  await page.getByLabel('Which feature?').fill('  Search inside documents  ')
  await page.getByLabel(/What would make you come back/).fill('Offline folders')
  await page.getByRole('checkbox', { name: /You may email me/ }).check()
  await expect(page.getByTestId('survey-field-error')).toHaveCount(0)
  await page.screenshot({ path: shot('survey-form-390-filled.png'), fullPage: true })

  await page.getByTestId('survey-submit').click()
  await expect(page.getByTestId('survey-thanks')).toBeVisible()
  await expect(page.getByRole('heading', { name: api.thanks.title })).toBeVisible()
  await expect(page.getByTestId('survey-thanks')).toContainText(api.thanks.body)
  expect(posts).toHaveLength(1)
  await noHorizontalScroll(page)
  await page.screenshot({ path: shot('survey-thanks-390-light.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: shot('survey-thanks-390-dark.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: shot('survey-thanks-1280-light.png') })

  // What the server stored is what was typed (trimmed), keyed by the survey's own ids.
  expect(JSON.parse(storedAnswers(inv.id))).toEqual({
    reason: 'missing_feature',
    missing_feature_detail: 'Search inside documents',
    come_back: 'Offline folders',
    contact_ok: true,
  })

  // A person who only answers a survey never starts the vault: no wasm, no crypto worker.
  // A production build's index.html carries ONE static `<link rel=preload>` for the WASM bytes on every
  // route (vite.config.ts `preloadWasmPlugin`, a cache warm for the main app); with E2E_PROD_BUILD=1 that
  // single fetch is tolerated, the worker, the glue code and the other workers still must not load.
  const prodBuild = process.env.E2E_PROD_BUILD === '1'
  const cryptoish = requested.filter((u) =>
    new RegExp(`${prodBuild ? '' : '\\.wasm|'}crypto\\.worker|beebeeb-wasm|beebeeb_wasm\\.js|raw-preview|tiff-decode`, 'i').test(u),
  )
  expect(cryptoish, 'no crypto worker / wasm glue was requested').toEqual([])
  if (prodBuild) expect(requested.filter((u) => /\.wasm/i.test(u)).length, 'at most the static preload hint').toBeLessThanOrEqual(1)
  // The token appears in the page's own first URL and the survey API calls, and in no other request.
  expect(
    requested.filter((u) => u.includes(inv.token) && !u.includes('/api/v1/surveys/') && new URL(u).pathname !== `/surveys/${inv.id}`),
  ).toEqual([])
})

test('reopening an answered link says so, without asking again', async ({ page }) => {
  const inv = seedInvitation()
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto(link(inv))
  await page.getByRole('radio', { name: 'Something else' }).check()
  await page.getByTestId('survey-submit').click()
  await expect(page.getByTestId('survey-thanks')).toBeVisible()
  // Optional boxes left blank + box unticked: stored as exactly that.
  expect(JSON.parse(storedAnswers(inv.id))).toEqual({ reason: 'other', contact_ok: false })

  await page.goto(link(inv))
  await expect(page.getByTestId('survey-already-answered')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'You already answered this' })).toBeVisible()
  await expect(page.getByTestId('survey-form')).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).search).toBe('')
  await noHorizontalScroll(page)
  await page.screenshot({ path: shot('survey-already-answered-390-light.png'), fullPage: true })
  expect(psql(`SELECT COUNT(*) FROM survey_responses WHERE invitation_id = '${inv.id}'`)).toBe('1')
})

test('every refusal of the link is one identical screen: wrong token, unknown id, no token, expired', async ({ page }) => {
  const live = seedInvitation()
  const expired = seedInvitation({ expiresIn: '-1 day' })
  const other = seedInvitation()
  const cases: Record<string, string> = {
    'wrong token': `/surveys/${live.id}?token=${randomBytes(32).toString('base64url')}`,
    'another invitation token': `/surveys/${live.id}?token=${other.token}`,
    'unknown id': `/surveys/${randomUUID()}?token=${live.token}`,
    'malformed id': `/surveys/not-a-uuid?token=${live.token}`,
    'no token': `/surveys/${live.id}`,
    'expired invitation': link(expired),
  }
  await page.setViewportSize({ width: 390, height: 780 })
  const seen: Record<string, string> = {}
  for (const [name, url] of Object.entries(cases)) {
    await page.goto(url)
    await expect(page.getByTestId('survey-invalid'), name).toBeVisible()
    await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible()
    seen[name] = (await page.getByTestId('survey-invalid').innerText()) + '|' + (await page.locator('h2').innerText())
  }
  const distinct = new Set(Object.values(seen))
  expect(distinct.size, `all ${Object.keys(cases).length} refusals read the same: ${JSON.stringify(seen)}`).toBe(1)
  expect([...distinct][0]).toContain('not valid or has expired')
  // It never mentions an account, an address or who the link belonged to.
  expect([...distinct][0]).not.toMatch(/account|email address|@e2e/i)
  await noHorizontalScroll(page)
  await page.screenshot({ path: shot('survey-invalid-390-light.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: shot('survey-invalid-390-dark.png'), fullPage: true })
})

test('another tab answers first: sending here ends on "already answered", nothing is lost or doubled', async ({ page }) => {
  const inv = seedInvitation()
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto(link(inv))
  await page.getByRole('radio', { name: 'It was too slow' }).check()

  // The "other tab": the same invitation answered through the API.
  const res = await fetch(`${API_URL}/api/v1/surveys/${inv.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: inv.token, answers: { reason: 'trust' } }),
  })
  expect(res.status).toBe(204)

  await page.getByTestId('survey-submit').click()
  await expect(page.getByTestId('survey-already-answered')).toBeVisible()
  expect(JSON.parse(storedAnswers(inv.id)).reason, 'the first answer stands').toBe('trust')
  expect(psql(`SELECT COUNT(*) FROM survey_responses WHERE invitation_id = '${inv.id}'`)).toBe('1')
})

test('a stale session does not bounce the survey to /login', async ({ page }) => {
  const inv = seedInvitation()
  await page.addInitScript(() => localStorage.setItem('bb_session', 'stale-token-from-an-old-session'))
  await page.goto(link(inv))
  await expect(page.getByTestId('survey-form')).toBeVisible()
  await page.waitForTimeout(1500)
  expect(new URL(page.url()).pathname, 'the session-expired handler must not navigate away').toBe(`/surveys/${inv.id}`)
  await expect(page.getByTestId('survey-form')).toBeVisible()
})

test('accessible: every control has a name, the choice group works from the keyboard, Enter submits', async ({ page }) => {
  const inv = seedInvitation()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(link(inv))
  await expect(page.getByTestId('survey-form')).toBeVisible()

  // Names, from the labels the API sent.
  await expect(page.getByRole('group', { name: /What was the main reason/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /What would make you come back/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Anything else/ })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /You may email me/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send my answer' })).toBeVisible()
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="survey-form"] input, [data-testid="survey-form"] textarea')].filter((el) => {
      const e = el as HTMLInputElement
      return !(e.labels && e.labels.length > 0)
    }).length,
  )
  expect(unnamed, 'inputs without a <label>').toBe(0)

  // Keyboard: Tab into the radio group, arrow down to the second option, it selects.
  await page.getByRole('radio').first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: 'I was missing a feature' })).toBeChecked()
  await expect(page.getByLabel('Which feature?')).toBeVisible()
  // The detail field appears without stealing focus from the group.
  await expect(page.getByRole('radio', { name: 'I was missing a feature' })).toBeFocused()

  // Touch targets are at least 44 px high on a phone.
  const heights = await page.getByRole('radio').evaluateAll((els) =>
    els.map((el) => (el.closest('label') as HTMLElement).offsetHeight),
  )
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)

  // Enter in a text box submits the form.
  await page.getByRole('textbox', { name: /What would make you come back/ }).fill('Cheaper')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('survey-thanks')).toBeVisible()
})

test('an unreachable API is "could not load", not "invalid"; Try again recovers (mocked outage)', async ({ page }) => {
  const inv = seedInvitation()
  let down = true
  await page.route(`${API_URL}/api/v1/surveys/**`, (route) => (down ? route.abort('connectionrefused') : route.continue()))
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto(link(inv))
  await expect(page.getByTestId('survey-unavailable')).toBeVisible()
  await expect(page.getByTestId('survey-invalid')).toHaveCount(0)
  await page.screenshot({ path: shot('survey-unavailable-390-light.png'), fullPage: true })
  down = false
  await page.getByTestId('survey-retry').click()
  await expect(page.getByTestId('survey-form')).toBeVisible()
})

test('a server 400 names its field inline and keeps what was typed (mocked 400)', async ({ page }) => {
  const inv = seedInvitation()
  await page.route(`${API_URL}/api/v1/surveys/${inv.id}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_answers', field: 'anything_else', message: 'That answer is not accepted.' }),
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(link(inv))
  await page.getByRole('radio', { name: 'Something else' }).check()
  await page.getByRole('textbox', { name: /Anything else/ }).fill('keep me')
  await page.getByTestId('survey-submit').click()
  await expect(page.getByTestId('survey-field-error')).toHaveText('That answer is not accepted.')
  await expect(page.getByRole('textbox', { name: /Anything else/ })).toBeFocused()
  await expect(page.getByRole('textbox', { name: /Anything else/ })).toHaveValue('keep me')
  await page.screenshot({ path: shot('survey-server-refusal-390-light.png'), fullPage: true })
  expect(psql(`SELECT COUNT(*) FROM survey_responses WHERE invitation_id = '${inv.id}'`), 'nothing stored on a mocked refusal').toBe('0')
})
