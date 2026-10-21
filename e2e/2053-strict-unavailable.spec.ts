/**
 * Task 2053 — strict "only store in <country>" while that country is
 * unavailable (web). Mocked API only (page.route); no server runs.
 *
 * Run: bunx playwright test --config=e2e/2053-strict-unavailable.config.ts
 * Screenshots: $E2E_EVIDENCE_DIR (default test-results/2053).
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5253'
const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? path.resolve(__dirname, '../test-results/2053')

const EUROPE = { id: 'europe', kind: 'region', name: 'Europe', country: null, country_code: null, status: 'live', selectable: true, is_default: true }
const DE = { id: 'de', kind: 'country', name: 'Germany', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false }
const FI_COMING = { id: 'fi', kind: 'country', name: 'Finland', country: 'Finland', country_code: 'FI', status: 'coming_soon', selectable: false, is_default: false }

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
        // Server rule (store_choice): a stored country that is still KNOWN (in
        // choices) may be re-saved while unavailable, with either strict value;
        // a value missing from choices that is not choosable is a 400.
        const want = body.preferred_region as string | null | undefined
        if (want) {
          const row = (opts.choices ?? CHOICES).find((c) => (c as { id: string }).id === want) as
            | { selectable: boolean }
            | undefined
          const ok = row ? row.selectable || want === preferred : false
          if (!ok) return json(route, { error: 'region_unavailable' }, 400)
        }
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
  { name: 'phone-375', width: 375, height: 812 },
] as const

const CASES = [
  { key: 'missing', label: 'Finland missing from choices', choices: [EUROPE, DE] },
  { key: 'not-selectable', label: 'Finland present but not selectable', choices: [EUROPE, DE, FI_COMING] },
] as const

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
})

for (const c of CASES) {
  for (const vp of VIEWPORTS) {
    test(`${c.key} ${vp.name}: strict + Finland unavailable says uploads are refused, keeps the strict choice`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      const puts: Array<Record<string, unknown>> = []
      await installMocks(page, { choices: [...c.choices], preferred: 'fi', strict: true, puts })
      await bootApp(page, '/settings/data-residency')

      const notice = page.getByTestId('region-unavailable')
      await expect(notice).toBeVisible({ timeout: 15_000 })
      await expect(notice).toContainText('New uploads are refused while Finland is unavailable')
      await expect(notice).not.toContainText('go to any of our European data centers')
      // Europe is not shown as selected: nothing is, uploads are refused.
      await expect(page.getByTestId('region-europe')).toHaveAttribute('aria-checked', 'false')
      // The strict choice stays visible and on.
      await expect(page.getByTestId('region-strict')).toContainText('Only store in Finland')
      await expect(page.getByRole('switch', { name: 'Only store in Finland' })).toHaveAttribute('aria-checked', 'true')
      // The normal country choice is still there.
      await expect(page.getByTestId('region-de')).toBeEnabled()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)

      await page.screenshot({ path: `${EVIDENCE_DIR}/strict-unavailable-${c.key}-${vp.name}.png`, fullPage: true })

      if (vp.name === 'desktop-1440') {
        await page.getByRole('button', { name: 'Allow other EU countries' }).click()
        if (c.key === 'missing') {
          // Finland is not a known country any more: send "any EU country", never the old id.
          await expect.poll(() => puts.at(-1)).toEqual({ preferred_region: null, region_strict: false })
          await expect(page.getByTestId('region-europe')).toHaveAttribute('aria-checked', 'true')
          await expect(page.getByText('Failed to save region')).toHaveCount(0)
          await expect(page.getByTestId('region-unavailable')).toHaveCount(0)
          await expect(page.getByText(/until your country is back/)).toHaveCount(0)
        } else {
          await expect.poll(() => puts.at(-1)).toEqual({ preferred_region: 'fi', region_strict: false })
          // Strict is off now: the honest "goes elsewhere" note applies.
          await expect(page.getByTestId('region-unavailable')).toContainText('go to any of our European data centers')
          await expect(page.getByRole('button', { name: 'Allow other EU countries' })).toHaveCount(0)
        }
      }
    })
  }
}
