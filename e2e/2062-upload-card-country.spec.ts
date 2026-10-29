/**
 * Task 2062 — the in-progress upload card names the COUNTRY the server chose at
 * init ("Stored in Finland") while the chunks are still moving, not "Europe".
 * Web-app-only, every API call mocked with page.route (mirrors
 * 1474-devices-sse.spec.ts): the chunk PUT is held so the card stays in its
 * Uploading state, then released.
 *
 * Run: bunx playwright test --config=e2e/2062-upload-card-country.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import path from 'path'
import { mkdirSync } from 'node:fs'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5192'

// Defaults to a repo-relative test-results dir (works from any worktree,
// unlike a hardcoded absolute workspace-root path — this spec runs from a
// worktree under ~/code/bb-worktrees/web-2062, which is outside the
// workspace tree entirely, a sibling checkout, not nested under it, so a
// hardcoded workspace-root path only ever worked on one machine/checkout).
// Mirrors checkout-confirmation-resilience-0957.spec.ts's pattern (PR #53
// review). Override with E2E_EVIDENCE_DIR to land screenshots under the
// workspace's tracked `.claude/tasks/_qa-evidence/2062/` for the real
// evidence capture, e.g.:
//   E2E_EVIDENCE_DIR=/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/2062 \
//     bunx playwright test -c e2e/2062-devices-sse.config.ts
const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? path.join(process.cwd(), 'test-results', '2062-evidence')

const AUTH_USER = {
  user_id: '00000000-0000-0000-0000-000000000474',
  email: 'dev@beebeeb.dev',
  email_verified: true,
  created_at: '2026-01-01T00:00:00Z',
  role: 'user',
  totp_enabled: false,
}

const CORS = {
  'access-control-allow-origin': WEB,
  'access-control-allow-credentials': 'true',
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  })
}


const SESSION = '00000000-0000-0000-0000-0000000020a2'
const FILE_ID = '00000000-0000-0000-0000-0000000020f1'

async function install(page: Page, location: unknown) {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const seen = { init: 0, chunk: 0 }

  await page.route('**/*', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    const isApi = url.includes('/api/v1/') || url.includes('/dev/auto-login')
    if (!isApi) return route.fallback()
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
          'access-control-allow-headers': '*',
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

    if (url.endsWith('/api/v1/uploads/init')) {
      seen.init += 1
      const body: Record<string, unknown> = {
        file_id: FILE_ID, tenant_id: AUTH_USER.user_id, object_version_id: SESSION,
        upload_session_id: SESSION, chunk_size_bytes: 4_194_304, chunk_count: 1,
        storage_format_version: 2, storage_pool_id: SESSION, region: 'europe',
        lease_seconds: 3600, heartbeat_interval_secs: 1200,
      }
      if (location !== undefined) body.storage_location = location
      return json(route, body, 201)
    }
    if (/\/uploads\/[^/]+\/chunks\/\d+$/.test(url)) {
      seen.chunk += 1
      await gate
      return json(route, { index: 0, size: 1 })
    }
    if (url.includes('/uploads/') && url.endsWith('/heartbeat')) return json(route, { lease_seconds: 3600, heartbeat_interval_secs: 1200 })
    if (url.includes('/uploads/') && url.endsWith('/complete')) {
      return json(route, { id: FILE_ID, name_encrypted: 'x', size_bytes: 1, chunk_count: 1, is_uploading: false, version_number: 1, storage_location: { region: 'europe', country: 'Finland', country_code: 'FI' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), uploaded_at: new Date().toISOString() })
    }
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/files/usage')) return json(route, { used_bytes: 0, plan_limit_bytes: 5_000_000_000, plan_name: 'free' })
    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })
    if (url.includes('/billing/subscription')) {
      return json(route, { plan: 'free', billing_cycle: 'monthly', seats: 1, region: 'eu-central', status: 'active', created_at: '2026-01-01T00:00:00Z', current_period_end: null, pending_downgrade_plan: null })
    }
    if (url.includes('/billing/usage')) return json(route, { used_bytes: 0, file_count: 0 })
    if (url.endsWith('/announcements')) return json(route, [])
    if (url.endsWith('/notifications')) return json(route, { notifications: [], unread_count: 0 })
    if (url.endsWith('/auth/sessions')) return json(route, { sessions: [] })
    if (url.endsWith('/me/region')) return json(route, { preferred_region: null, region_strict: false, choices: [] })
    if (url.endsWith('/sync/stream-token')) return json(route, { stream_token: 'strm_mock_2062', expires_at: new Date(Date.now() + 3_600_000).toISOString() })
    return json(route, {})
  })
  return { seen, release }
}

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
  })
  await page.goto('/')
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 20_000 })
}

test.describe.configure({ retries: 0 })

test.describe('2062 - upload card names the country during the transfer', () => {
  test.beforeAll(() => { mkdirSync(EVIDENCE_DIR, { recursive: true }) })

  test('init says Finland: the card reads "Stored in Finland" while the chunk is in flight', async ({ page }) => {
    const { seen, release } = await install(page, { region: 'europe', country: 'Finland', country_code: 'FI' })
    await boot(page)
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'finland-2062.txt', mimeType: 'text/plain', buffer: Buffer.from('hello 2062') })
    const card = page.getByTestId('upload-card').filter({ hasText: 'finland-2062.txt' })
    await expect.poll(() => seen.chunk, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect(card).toContainText('Stored in Finland', { timeout: 10_000 })
    await expect(card).not.toContainText('Stored in Europe')
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '2062-01-finland-during-transfer.png'), fullPage: true })
    release()
    await expect(page.getByTestId('upload-card')).toHaveCount(0, { timeout: 20_000 })
  })

  test('an older server without storage_location keeps the "Europe" fallback', async ({ page }) => {
    const { seen, release } = await install(page, undefined)
    await boot(page)
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'europe-2062.txt', mimeType: 'text/plain', buffer: Buffer.from('hello 2062') })
    const card = page.getByTestId('upload-card').filter({ hasText: 'europe-2062.txt' })
    await expect.poll(() => seen.chunk, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect(card).toContainText('Stored in Europe', { timeout: 10_000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '2062-02-europe-fallback.png'), fullPage: true })
    release()
    await expect(page.getByTestId('upload-card')).toHaveCount(0, { timeout: 20_000 })
  })
})
