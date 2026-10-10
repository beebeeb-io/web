import { expect, test } from '@playwright/test'

/**
 * Task 1884 part 3 — a deliberate client error reaches GlitchTip's ingest
 * endpoint exactly once, and the payload carries none of the forbidden values.
 * The ingest host is intercepted (route.fulfill): nothing leaves the machine.
 */
const FORBIDDEN = [
  'guus@beebeeb.io',
  '203.0.113.42',
  '2001:db8',
  'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5',
  '#k=',
  'hunter2secret',
  'token=',
  'Holiday photos',
  'Corfu',
]

const POISON =
  'sync failed for guus@beebeeb.io from 203.0.113.42 / 2001:db8::ff00:42:8329 ' +
  'on https://app.beebeeb.io/s/Tk9QRQ#k=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5 ' +
  'via /api/v1/x?token=hunter2secret "Holiday photos 2026 Corfu.jpeg"'

async function arm(page: import('@playwright/test').Page, consent: boolean) {
  const envelopes: { body: string; referer: string | undefined; cookie: string | undefined }[] = []
  await page.route('https://errors.beebeeb.io/**', async (route) => {
    const req = route.request()
    const h = req.headers()
    envelopes.push({ body: req.postData() ?? '', referer: h['referer'], cookie: h['cookie'] })
    await route.fulfill({ status: 200, body: '{}' })
  })
  // Everything else the app touches is mocked: no boot-time failure may report
  // before the deliberate error (it would consume the reporter's 5 s interval),
  // and nothing may reach a real host.
  await page.route('http://127.0.0.1:1/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }))
  await page.route('https://status.beebeeb.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"incidents":[]}' }))
  if (consent) await page.addInitScript(() => localStorage.setItem('bb_error_reports', 'on'))
  await page.goto('/login')
  // GlobalHandlers register in a mounted effect: wait for the app to render.
  await page.waitForSelector('a.skip-to-content', { state: 'attached' })
  await page.waitForTimeout(1500)
  expect(envelopes, 'no report before the deliberate error').toHaveLength(0)
  return envelopes
}

test('opted in: one uncaught error -> exactly one envelope, nothing forbidden in it', async ({ page }) => {
  const envelopes = await arm(page, true)
  await page.evaluate((msg) => { setTimeout(() => { throw new Error(msg) }, 0) }, POISON)
  await expect.poll(() => envelopes.length, { timeout: 10_000 }).toBe(1)
  await page.waitForTimeout(1500) // a second send would land here
  expect(envelopes).toHaveLength(1)

  const { body, referer, cookie } = envelopes[0]
  const lines = body.trim().split('\n')
  expect(lines).toHaveLength(3)
  const event = JSON.parse(lines[2])
  expect(event.exception.values[0].type).toBe('Error')
  expect(event.release).toMatch(/^web@/)
  expect(event.user).toBeUndefined()
  expect(event.breadcrumbs).toBeUndefined()
  expect(event.request).toBeUndefined()
  for (const f of FORBIDDEN) expect(body, `payload must not contain ${f}`).not.toContain(f)
  expect(referer).toBeUndefined()
  expect(cookie).toBeUndefined()
})

test('unhandled rejection is reported too, equally clean', async ({ page }) => {
  const envelopes = await arm(page, true)
  await page.evaluate((msg) => { void Promise.reject(new Error(msg)) }, POISON)
  await expect.poll(() => envelopes.length, { timeout: 10_000 }).toBe(1)
  for (const f of FORBIDDEN) expect(envelopes[0].body).not.toContain(f)
})

test('not opted in (the web default): the same error sends nothing', async ({ page }) => {
  const envelopes = await arm(page, false)
  await page.evaluate((msg) => { setTimeout(() => { throw new Error(msg) }, 0) }, POISON)
  await page.waitForTimeout(2000)
  expect(envelopes).toHaveLength(0)
})
