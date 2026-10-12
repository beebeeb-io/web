/**
 * 1899 — credit notes on the billing page.
 *
 * Web-app-only: every API call is mocked with page.route (same pattern as
 * e2e/1542-web-billing-copy.spec.ts). The mocked JSON mirrors the real shape of
 * GET /api/v1/billing/credit-notes (repos/server billing.rs `credit_notes`).
 *
 * Run: E2E_WEB_URL=http://localhost:<port> bunx playwright test --config=e2e/1899-credit-notes.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? 'e2e/screenshots'
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173'

const ACTIVE_SUB = {
  plan: 'free',
  billing_cycle: 'monthly',
  seats: 1,
  region: 'eu-central',
  status: 'active',
  billing_state: 'active',
  created_at: '2026-01-01T00:00:00Z',
  current_period_end: null,
  pending_downgrade_plan: null,
  has_used_trial: true,
  can_upgrade: true,
}

const PLANS = [
  {
    id: 'free', name: 'Free', price_eur: 0, price_yearly_eur: 0,
    storage_bytes: 100_000_000_000, storage_label: '100 GB', per_seat: false,
    min_seats: 1, features: ['100 GB'], is_active: true, sort_order: 0,
  },
  {
    id: 'basic', name: 'Basic', price_eur: 4.99, price_yearly_eur: 49,
    storage_bytes: 200_000_000_000, storage_label: '200 GB', per_seat: false,
    min_seats: 1, features: ['200 GB', 'Priority support'], is_active: true, sort_order: 1,
  },
  {
    id: 'pro', name: 'Pro', price_eur: 10.99, price_yearly_eur: 105.5,
    storage_bytes: 1_000_000_000_000, storage_label: '1 TB', per_seat: false,
    min_seats: 1, features: ['1 TB', 'Versioning'], is_active: true, sort_order: 2,
  },
]

const AUTH_USER = {
  user_id: '00000000-0000-0000-0000-000000000001',
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


const INVOICES = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001', number: 'INV-2026-000001',
    invoice_date: '2026-09-25', amount_gross_cents: 1990, amount_net_cents: 1645,
    vat_amount_cents: 345, vat_rate_bps: 2100, status: 'paid', vat_treatment: 'domestic',
    pdf_url: '/api/v1/billing/invoices/aaaaaaaa-0000-0000-0000-000000000001/pdf',
  },
]

const CN_ID = 'cccccccc-0000-0000-0000-000000000001'
const CREDIT_NOTES = [
  {
    id: CN_ID, number: 'CN-2026-000002', credit_note_date: '2026-10-12',
    original_invoice_number: 'INV-2026-000001', reason: 'Refund processed 2026-10-02',
    currency: 'EUR', amount_net_cents: -1612, vat_rate_bps: 2100, amount_vat_cents: -339,
    amount_gross_cents: -1951, vat_treatment: 'domestic', status: 'issued',
    pdf_url: `/api/v1/billing/credit-notes/${CN_ID}/pdf`,
  },
]

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

function installMocks(page: Page, creditNotes: unknown[], pdfAuth: { header?: string; url?: string } = {}) {
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
      const b64 = Buffer.from(bytes).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return json(route, {
        session_token: 'dev-mock-session', user_id: AUTH_USER.user_id,
        master_key_bytes_base64: b64,
        email: 'dev@beebeeb.dev', role: 'user',
      })
    }

    if (url.includes('/auth/upgrade-session')) return json(route, { ok: true })
    if (url.includes('/auth/me')) return json(route, AUTH_USER)

    if (url.includes('/billing/credit-notes/') && url.endsWith('/pdf')) {
      pdfAuth.header = route.request().headers()['authorization']
      pdfAuth.url = url
      return route.fulfill({
        status: 200, body: PDF_BYTES,
        headers: { ...CORS, 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="CN-2026-000002.pdf"' },
      })
    }
    if (url.includes('/billing/credit-notes')) return json(route, { credit_notes: creditNotes })
    if (url.includes('/billing/subscription')) return json(route, ACTIVE_SUB)
    if (url.includes('/billing/plans')) return json(route, { plans: PLANS })
    if (url.includes('/billing/invoices')) return json(route, { invoices: INVOICES })
    if (url.includes('/billing/transactions')) return json(route, { transactions: [] })
    if (url.includes('/billing/usage')) {
      return json(route, { used_bytes: 1_200_000_000, file_count: 12 })
    }
    if (url.includes('/billing/storage-addons')) {
      return json(route, {
        extra_storage_tb: 0, base_storage_tb: 0, max_storage_tb: 0,
        effective_storage_bytes: 100_000_000_000,
      })
    }
    if (url.includes('/billing/winback-eligible')) return json(route, { eligible: false })
    if (url.includes('/files')) return json(route, { files: [] })
    if (url.includes('/preferences/')) return json(route, {}, 404)
    if (url.includes('/incoming') || url.includes('/shares')) return json(route, { shares: [] })

    return json(route, {})
  })
}

async function bootApp(page: Page, path: string) {
  await page.addInitScript(() => {
    localStorage.setItem('bb_cookie_consent', 'all')
    localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'done' }))
  })
  await page.goto(`${WEB}${path}`)
  await page.waitForFunction(
    () => document.body.dataset.cryptoReady === 'true',
    { timeout: 20_000 },
  )
}

test.describe('1899 credit notes on the billing page', () => {
  test('lists the credit note and downloads its PDF with the bearer (no token in URL)', async ({ page }) => {
    const pdfAuth: { header?: string; url?: string } = {}
    await installMocks(page, CREDIT_NOTES, pdfAuth)
    await bootApp(page, '/settings/billing')

    const list = page.getByTestId('credit-notes-list')
    await expect(list).toBeVisible({ timeout: 15_000 })
    await expect(list).toContainText('CN-2026-000002')
    await expect(list).toContainText('INV-2026-000001')
    await expect(list).toContainText('-EUR 19.51')
    await expect(list).toContainText('12 Oct 2026')

    mkdirSync(EVIDENCE, { recursive: true })
    await page.getByTestId('credit-notes-list').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${EVIDENCE}/credit-notes-light.png`, fullPage: true })

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download credit note CN-2026-000002' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('CN-2026-000002.pdf')
    const path = await download.path()
    const bytes = (await import('node:fs')).readFileSync(path!)
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF')
    // Same auth as the invoice PDF: bearer header when the session holds a token
    // (the mocked dev auto-login may be cookie-only), never a token in the URL.
    if (pdfAuth.header !== undefined) expect(pdfAuth.header).toMatch(/^Bearer \S+$/)
    expect(pdfAuth.url).toContain(`/api/v1/billing/credit-notes/${CN_ID}/pdf`)
    expect(pdfAuth.url).not.toMatch(/token|bearer|session/i)
  })

  test('dark theme screenshot', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => localStorage.setItem('beebeeb-theme', 'dark'))
    await installMocks(page, CREDIT_NOTES)
    await bootApp(page, '/settings/billing')
    await expect(page.getByTestId('credit-notes-list')).toBeVisible({ timeout: 15_000 })
    mkdirSync(EVIDENCE, { recursive: true })
    await page.getByTestId('credit-notes-list').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${EVIDENCE}/credit-notes-dark.png`, fullPage: true })
  })

  test('no credit notes -> no section at all', async ({ page }) => {
    await installMocks(page, [])
    await bootApp(page, '/settings/billing')
    await expect(page.getByTestId('invoices-list')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('credit-notes-list')).toHaveCount(0)
    await expect(page.getByText('Credit notes')).toHaveCount(0)
  })
})
