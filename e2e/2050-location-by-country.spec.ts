/**
 * Task 2050 — storage location by COUNTRY, never city (web).
 *
 * Web-app-only: no server runs, every API call is mocked with page.route (the
 * JSON is the server's `RegionChoice` contract, beebeeb-api routes/regions.rs @
 * 8649cc2f). The vault unlock uses the REAL WASM crypto path via the mocked
 * /dev/auto-login — same harness as e2e/1605-trial-limits-ui.spec.ts.
 *
 * Run: bunx playwright test --config=e2e/2050-location-by-country.config.ts
 * Screenshots: $E2E_EVIDENCE_DIR (default test-results/2050).
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5250'
const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? path.resolve(__dirname, '../test-results/2050')

const CITIES = /Falkenstein|Helsinki|Nuremberg|Nürnberg|\bEde\b/

// The server's list (GET /api/v1/storage-regions == `choices` of GET /me/region).
const CHOICES = [
  { id: 'europe', kind: 'region', name: 'Europe', country: null, country_code: null, status: 'live', selectable: true, is_default: true },
  { id: 'de', kind: 'country', name: 'Germany', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
  { id: 'fi', kind: 'country', name: 'Finland', country: 'Finland', country_code: 'FI', status: 'live', selectable: true, is_default: false },
  { id: 'nl', kind: 'country', name: 'Netherlands', country: 'Netherlands', country_code: 'NL', status: 'coming_soon', selectable: false, is_default: false },
]

// A server older than 2050 (task 1919): one entry per datacenter, named after its city.
const OLD_CHOICES = [
  { id: 'europe', kind: 'region', name: 'Europe', city: null, country: null, country_code: null, status: 'live', selectable: true, is_default: true },
  { id: 'fsn1', kind: 'datacenter', name: 'Falkenstein', city: 'Falkenstein', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
  { id: 'hel1', kind: 'datacenter', name: 'Helsinki', city: 'Helsinki', country: 'Finland', country_code: 'FI', status: 'live', selectable: true, is_default: false },
  { id: 'nbg1', kind: 'datacenter', name: 'Nuremberg', city: 'Nuremberg', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
  { id: 'ede', kind: 'datacenter', name: 'Ede', city: 'Ede', country: 'Netherlands', country_code: 'NL', status: 'coming_soon', selectable: false, is_default: false },
]

const AUTH_USER = {
  user_id: '00000000-0000-0000-0000-000000000001',
  email: 'dev@beebeeb.dev',
  email_verified: true,
  created_at: '2026-01-01T00:00:00Z',
  role: 'user',
  totp_enabled: false,
}

const CORS = { 'access-control-allow-origin': WEB, 'access-control-allow-credentials': 'true' }

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) })
}

interface MockOptions {
  choices?: unknown[]
  preferred?: string | null
  strict?: boolean
  files?: unknown[]
  /** Every PUT /me/region body, in order. */
  puts?: Array<Record<string, unknown>>
  onUploadInit?: () => { status: number; body: unknown } | null
}

function installMocks(page: Page, opts: MockOptions = {}) {
  let preferred = opts.preferred ?? null
  let strict = opts.strict ?? false
  return page.route('**/*', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    const isApi = url.includes('/api/v1/') || url.includes('/dev/auto-login')
    if (!isApi) return route.fallback()

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization',
        },
      })
    }
    if (url.includes('/dev/auto-login')) {
      const bytes = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
      const b64 = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return json(route, { session_token: 'dev-mock-session', user_id: AUTH_USER.user_id, master_key_bytes_base64: b64, email: 'dev@beebeeb.dev', role: 'user' })
    }
    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)

    if (url.includes('/me/region')) {
      if (method === 'PUT') {
        const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        opts.puts?.push(body)
        preferred = (body.preferred_region as string | null) ?? null
        strict = body.region_strict === true
        return json(route, { preferred_region: preferred, region_strict: strict })
      }
      return json(route, {
        preferred_region: preferred,
        region_strict: strict,
        available_regions: [{ continent: 'europe', display_name: 'Europe', example_country: 'Germany', is_default: true }],
        choices: opts.choices ?? CHOICES,
      })
    }

    if (url.includes('/billing/subscription')) {
      return json(route, {
        plan: 'basic', billing_cycle: 'monthly', seats: 1, status: 'active', billing_state: 'active',
        created_at: '2026-09-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z', trial_ends_at: null,
        pending_downgrade_plan: null, has_used_trial: true, can_upgrade: true, account_state: 'ok',
      })
    }
    if (url.includes('/billing/plans')) return json(route, { plans: [] })
    if (url.includes('/billing/usage')) return json(route, { used_bytes: 1_200_000_000, file_count: 12 })
    if (url.includes('/billing/')) return json(route, {})

    if (url.includes('/uploads/init') && method === 'POST') {
      const result = opts.onUploadInit?.()
      if (result) return json(route, result.body, result.status)
      return json(route, {})
    }
    if (url.includes('/files/usage')) return json(route, { used_bytes: 1_200_000_000, plan_limit_bytes: 200_000_000_000, plan_name: 'basic' })
    if (url.includes('/files/count')) return json(route, { total_files: 0, total_folders: 0, total_bytes: 0, trashed_files: 0, trashed_bytes: 0 })
    if (url.includes('/files/all-images')) return json(route, { files: [] })
    if (url.includes('/notifications')) return json(route, { notifications: [], unread_count: 0 })
    if (url.includes('/files')) return json(route, { files: opts.files ?? [] })
    if (url.includes('/preferences/welcome_tour')) {
      return json(route, { value: { seen: true, completed: ['upload', 'security', 'share', 'device'] } })
    }
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })
    return json(route, {})
  })
}

async function bootApp(page: Page, appPath: string) {
  await page.addInitScript(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
    sessionStorage.setItem('beebeeb_upgrade_nudge_dismissed', '1')
  })
  await page.goto(`${WEB}${appPath}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
}

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'phone-390', width: 390, height: 844 },
] as const

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
})

test.describe('2050 — data residency settings, by country', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: Europe default, Germany pinned and strict, Finland live, Netherlands coming soon`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await installMocks(page, { preferred: 'de', strict: true })
      await bootApp(page, '/settings/data-residency')

      await expect(page.getByTestId('region-europe')).toBeVisible({ timeout: 15_000 })
      // The list is the API's, in the API's order: Europe, then countries.
      const ids = await page.locator('[data-testid^="region-"][data-status]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-testid')),
      )
      expect(ids).toEqual(['region-europe', 'region-de', 'region-fi', 'region-nl'])

      await expect(page.getByTestId('region-europe')).toContainText('Default')
      await expect(page.getByTestId('region-de')).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByTestId('region-fi')).toBeEnabled()
      const nl = page.getByTestId('region-nl')
      await expect(nl).toContainText('Netherlands')
      await expect(nl).toContainText('Coming soon')
      await expect(nl).toBeDisabled()
      await expect(nl).toHaveAttribute('aria-checked', 'false')

      // Strict mode: the server's country name, in the copy.
      const strictCard = page.getByTestId('region-strict')
      await expect(strictCard).toContainText('Only store in Germany')
      await expect(page.getByRole('switch', { name: 'Only store in Germany' })).toHaveAttribute('aria-checked', 'true')

      // Never a city, anywhere on the page.
      expect(await page.locator('body').innerText()).not.toMatch(CITIES)
      // No horizontal scroll at phone width.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)

      await page.screenshot({ path: `${EVIDENCE_DIR}/settings-data-residency-strict-${vp.name}.png`, fullPage: true })
    })
  }

  test('selecting Finland sends its id with the strict choice carried over; Europe ends strict', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = []
    await installMocks(page, { preferred: 'de', strict: true, puts })
    await bootApp(page, '/settings/data-residency')

    await page.getByTestId('region-fi').click()
    await expect(page.getByTestId('region-fi')).toHaveAttribute('aria-checked', 'true')
    expect(puts.at(-1)).toEqual({ preferred_region: 'fi', region_strict: true })
    await expect(page.getByTestId('region-strict')).toContainText('Only store in Finland')

    await page.getByTestId('region-europe').click()
    await expect(page.getByTestId('region-europe')).toHaveAttribute('aria-checked', 'true')
    expect(puts.at(-1)).toEqual({ preferred_region: 'europe', region_strict: false })
    await expect(page.getByTestId('region-strict')).toHaveCount(0)

    // Choosing a country with strict off (the default), then turning strict on.
    await page.getByTestId('region-de').click()
    expect(puts.at(-1)).toEqual({ preferred_region: 'de', region_strict: false })
    await page.getByRole('switch', { name: 'Only store in Germany' }).click()
    await expect.poll(() => puts.at(-1)).toEqual({ preferred_region: 'de', region_strict: true })

    // The coming-soon country is not selectable even by force.
    const before = puts.length
    await page.getByTestId('region-nl').click({ force: true })
    expect(puts.length).toBe(before)
  })

  test('a server older than 2050 (one entry per datacenter): no crash, countries only, never a city', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = []
    await installMocks(page, { choices: OLD_CHOICES, preferred: 'nbg1', puts })
    await bootApp(page, '/settings/data-residency')

    await expect(page.getByTestId('region-europe')).toBeVisible({ timeout: 15_000 })
    const names = await page.locator('[data-testid^="region-"][data-status]').evaluateAll((els) =>
      els.map((e) => (e.querySelector('span.font-semibold')?.textContent ?? '').trim()),
    )
    expect(names).toEqual(['Europe', 'Germany', 'Finland', 'Netherlands'])
    // The stored `nbg1` is Germany's row.
    await expect(page.getByTestId('region-fsn1')).toHaveAttribute('aria-checked', 'true')
    expect(await page.locator('body').innerText()).not.toMatch(CITIES)
    await page.screenshot({ path: `${EVIDENCE_DIR}/settings-data-residency-older-server-desktop-1440.png`, fullPage: true })

    // Choosing Finland sends the datacenter id that older server accepts.
    await page.getByTestId('region-hel1').click()
    expect(puts.at(-1)).toMatchObject({ preferred_region: 'hel1' })
  })
})

test.describe('2050 — a file shows its country', () => {
  const FILES = [
    {
      id: 'file-de', name_encrypted: '{"nonce":"AAAA","ciphertext":"BBBB"}', mime_type: 'application/pdf',
      size_bytes: 2_400_000, is_folder: false, is_trashed: false, parent_id: null, chunk_count: 1,
      is_starred: false, has_thumbnail: false, version_number: 1,
      created_at: '2026-10-18T10:00:00Z', updated_at: '2026-10-18T10:00:00Z',
      // The server still sends the deprecated `city` for one release: it must never show.
      storage_location: { region: 'europe', country: 'Germany', country_code: 'DE', city: 'Falkenstein' },
    },
    {
      id: 'file-old', name_encrypted: '{"nonce":"CCCC","ciphertext":"DDDD"}', mime_type: 'application/pdf',
      size_bytes: 1_100_000, is_folder: false, is_trashed: false, parent_id: null, chunk_count: 1,
      is_starred: false, has_thumbnail: false, version_number: 1,
      created_at: '2026-10-17T10:00:00Z', updated_at: '2026-10-17T10:00:00Z',
      // An older server: a city and no country.
      storage_location: { region: 'europe', city: 'Helsinki' },
    },
  ]

  for (const vp of VIEWPORTS) {
    test(`${vp.name}: the drive row says Germany, never the city; a file without a country says Europe`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await installMocks(page, { preferred: 'de', files: FILES })
      await bootApp(page, '/')

      const rows = page.getByText(/AES-256-GCM ·/)
      await expect(rows.first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('AES-256-GCM · Germany')).toHaveCount(1)
      await expect(page.getByText('AES-256-GCM · Europe', { exact: true })).toHaveCount(1)
      expect(await page.locator('body').innerText()).not.toMatch(CITIES)
      // The sidebar says where new uploads go: the pinned country.
      await expect(page.getByTestId('sidebar-region')).toHaveText(/Germany/)

      await page.screenshot({ path: `${EVIDENCE_DIR}/drive-file-country-${vp.name}.png`, fullPage: true })
    })
  }
})

test.describe('2050 — strict refusal names the country', () => {
  test('a 409 region_unavailable_strict upload says "Germany can\'t take new files", not the city alias', async ({ page }) => {
    await installMocks(page, {
      preferred: 'de',
      strict: true,
      onUploadInit: () => ({
        status: 409,
        body: {
          error: 'region_unavailable_strict',
          message: 'refused',
          datacenter: 'de',
          country: 'Germany',
          country_code: 'DE',
          city: 'Germany',
          reason: 'full',
        },
      }),
    })
    await bootApp(page, '/')

    const tmpFile = path.join(os.tmpdir(), `2050-strict-upload-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'task 2050 strict upload probe\n')
    await page.locator('input[type="file"]').first().setInputFiles(tmpFile)

    const card = page.getByTestId('upload-card')
    await expect(card).toContainText("Germany can't take new files right now", { timeout: 20_000 })
    await expect(card).toContainText('Your choice is set to only Germany')
    await expect(card).toContainText('allow other EU countries in Settings')
    await page.screenshot({ path: `${EVIDENCE_DIR}/upload-strict-refusal-desktop-1440.png`, fullPage: true })
    fs.rmSync(tmpFile, { force: true })
  })
})
