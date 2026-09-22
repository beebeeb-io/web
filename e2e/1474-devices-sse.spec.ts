/**
 * Task 1474 — `devices.tsx`'s `useSessionSSE` opened
 * `new EventSource(...&token=<bb_session>)` reading the legacy localStorage
 * slot (`getToken()`), which is empty for any real cookie-authenticated
 * user, and the server's old `AuthUser` extractor never even read the query
 * string — see server PR #68 (https://github.com/beebeeb-io/server/pull/68)'s
 * premise-check finding. Fixed: gate on `isAuthenticated(user)` and mint a
 * FRESH short-lived stream token via `POST /sync/stream-token` before each
 * `EventSource` open, matching the endpoint's new contract (a required
 * `token` query param, same token type the WS path already uses).
 *
 * Web-app-only: NO server runs. Every API call is mocked with page.route
 * (`unit/1471-ws-reconnect-race.test.ts` and `unit test 1474-session-sse-
 * stream-token.test.ts` already cover the pure connect-decision logic
 * headlessly; this spec is the browser rung: a REAL native `EventSource`
 * connecting through a REAL DOM, receiving a REAL server-sent event, and the
 * React tree re-rendering off it). The vault unlock uses the REAL WASM
 * crypto path (32 deterministic master-key bytes returned by the mocked
 * `/dev/auto-login` → `cacheVaultKey` via `DevAuthGate`) — mirrors
 * `trial-0905.spec.ts`'s mocking + boot pattern.
 *
 * Run: bunx playwright test --config=e2e/1474-devices-sse.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import path from 'path'

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5187'

// Absolute, NOT relative to this file — this spec runs from a worktree under
// ~/code/bb-worktrees/web-1474, which is outside the workspace tree entirely
// (a sibling checkout, not nested under it), so `path.resolve(__dirname, …)`
// cannot reach the workspace's `.claude/tasks/_qa-evidence/`.
const EVIDENCE_DIR = '/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/.claude/tasks/_qa-evidence/1474'

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

/** The live `session_created` event the mocked SSE endpoint pushes. Payload
 *  shape matches `ClientSession` (src/lib/api.ts) — no matching device in
 *  the (empty) initial `/clients/devices` list, so `devices.tsx`'s
 *  "Session for an unknown device -- create a placeholder" branch is what
 *  actually renders the row, proving the event drove the re-render rather
 *  than the initial REST load. */
const LIVE_SESSION = {
  id: 'sess_e2e_1474',
  name: 'e2e-laptop sync',
  session_type: 'sync',
  local_path: '/Users/e2e/Documents',
  remote_path: '/Documents',
  status: 'active',
  device_hostname: 'e2e-laptop-1474',
  device_platform: 'macos',
  device_id: 'dev_e2e_1474',
  heartbeat_interval_secs: 60,
  alert_after_missed: 3,
  last_heartbeat: new Date().toISOString(),
  files_synced: 42,
  files_total: 42,
  bytes_synced: 1_048_576,
  bytes_total: 1_048_576,
  heartbeat_status: 'watching',
  current_file: null,
  speed_bps: null,
  created_at: new Date().toISOString(),
}

/**
 * Install the mock backend. Returns counters so the test can assert
 * `POST /sync/stream-token` was actually called (proving the EventSource
 * opened with a freshly-minted stream token, not a static/legacy one) and
 * that the SSE endpoint was hit with that exact token in the query string.
 */
function installMocks(page: Page) {
  const counters = { streamTokenPosts: 0, sseRequests: 0, sseTokensSeen: [] as string[] }
  let streamTokenSeq = 0

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
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization',
        },
      })
    }

    // dev auto-login → real WASM unlock with 32 deterministic bytes
    if (url.includes('/dev/auto-login')) {
      const bytes = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
      const b64 = Buffer.from(bytes).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return json(route, {
        session_token: 'dev-mock-session', master_key_bytes_base64: b64,
        email: 'dev@beebeeb.dev', role: 'user',
      })
    }

    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)

    // ── task 1474: stream-token mint + the SSE endpoint itself ──
    // `sessions/live` MUST be checked before the generic `sessions` match
    // below (it's a substring of it).
    if (url.includes('/clients/sessions/live')) {
      counters.sseRequests += 1
      const token = new URL(url).searchParams.get('token')
      counters.sseTokensSeen.push(token ?? '')
      // Deliberate delay so the test can observe the genuinely-empty state
      // (from the empty /clients/devices + /clients/sessions REST mocks)
      // BEFORE the live event lands, instead of racing the two.
      await new Promise((resolve) => setTimeout(resolve, 700))
      const body = `event: session_created\ndata: ${JSON.stringify(LIVE_SESSION)}\n\n`
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: CORS,
        body,
      })
    }
    if (url.includes('/sync/stream-token')) {
      streamTokenSeq += 1
      counters.streamTokenPosts += 1
      return json(route, {
        stream_token: `strm_mock_e2e_1474_${streamTokenSeq}`,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      })
    }

    // ── devices page's own REST load — starts EMPTY so the rendered row
    // in the test can only have come from the live SSE event above ──
    if (url.includes('/clients/devices')) return json(route, { devices: [] })
    if (url.includes('/clients/sessions')) return json(route, { sessions: [] })

    // ── drive/preferences side-fetches (layout mounts these too) ──
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })
    if (url.includes('/billing/subscription')) {
      return json(route, {
        plan: 'free', billing_cycle: 'monthly', seats: 1, region: 'eu-central',
        status: 'active', created_at: '2026-01-01T00:00:00Z',
        current_period_end: null, pending_downgrade_plan: null,
      })
    }
    if (url.includes('/billing/usage')) return json(route, { used_bytes: 0, file_count: 0 })

    return json(route, {})
  }).then(() => counters)
}

async function bootDevices(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
  })
  await page.goto(`${WEB}/devices`)
  await page.waitForFunction(
    () => document.body.dataset.cryptoReady === 'true',
    { timeout: 20_000 },
  )
}

test.describe('1474 — devices.tsx useSessionSSE opens with a fresh stream token', () => {
  test('a logged-in /devices page receives one SSE event and re-renders', async ({ page }) => {
    const counters = await installMocks(page)
    await bootDevices(page)

    // Initial REST load is empty — confirms the devices we're about to see
    // did NOT come from listClientDevices()/listClientSessions().
    await expect(page.getByText(/No devices registered/i)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '1474-01-empty-before-sse.png'),
      fullPage: true,
    })

    // The live SSE `session_created` event lands and the page re-renders
    // the placeholder device it creates for an unknown device_id.
    await expect(page.getByText('e2e-laptop-1474')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('e2e-laptop sync')).toBeVisible()
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '1474-02-device-after-sse-event.png'),
      fullPage: true,
    })

    // The EventSource opened with a token minted by POST /sync/stream-token
    // — never a static/legacy value — and that exact token rode the URL.
    expect(counters.streamTokenPosts).toBeGreaterThanOrEqual(1)
    expect(counters.sseRequests).toBeGreaterThanOrEqual(1)
    expect(counters.sseTokensSeen[0]).toMatch(/^strm_mock_e2e_1474_\d+$/)
  })

  test('logged-out visitor never reaches /devices (ProtectedRoute bounces to /login) — no stream-token mint, no SSE request', async ({ page }) => {
    const counters = await installMocks(page)
    // Override /auth/me to 401 so DevAuthGate's boot never establishes a
    // user — the simplest way to exercise "not authenticated" without a
    // real backend.
    await page.route('**/api/v1/auth/me', (route) =>
      route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"error":"unauthorized"}' }),
    )
    await page.route('**/dev/auto-login', (route) => route.fulfill({ status: 404, headers: CORS }))

    await page.addInitScript(() => {
      localStorage.setItem('bb_cookie_consent', 'all')
    })
    await page.goto(`${WEB}/devices`)
    await page.waitForURL(/\/login/, { timeout: 15_000 })
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '1474-03-logged-out-bounced-to-login.png'),
      fullPage: true,
    })

    expect(counters.streamTokenPosts).toBe(0)
    expect(counters.sseRequests).toBe(0)
  })
})
