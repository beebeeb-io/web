import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { uploadTextFile } from './helpers/drive'

/**
 * STALE since task 2050 (storage location by COUNTRY): this opt-in real-stack spec still asserts the
 * per-datacenter, per-city model of 1919 and must be rewritten against a server built from 2050
 * (follow-up). The country model is covered by e2e/2050-location-by-country.spec.ts (mocked API).
 *
 * Task 1919 (web) — the region choice, proven end to end on a local stack.
 *
 * Product model (Guus, 2026-10-17): "Europe" is the DEFAULT (no country, any of
 * our European datacenters, the server places the data). Below it the person
 * can pin new uploads to one datacenter: Falkenstein, Helsinki, Nuremberg
 * (live) and Ede is listed as COMING SOON, not selectable. The list comes from
 * the API (`choices` of GET /me/region), never from the client.
 *
 * Opt-in (like 1416 before it): needs an API from the server 1919 branch with
 * THREE local pools whose `region` is fsn1 / hel1 / nbg1 (fsn1 the default
 * pool) and a scratch Postgres the spec may edit to change the API's data.
 * `e2e/scripts/region-stack.sh up` builds exactly that and prints the env:
 *
 *   E2E_1919=1 E2E_API_URL=http://localhost:3039 E2E_WEB_URL=http://localhost:5139 \
 *   E2E_1919_DB=bb_1919_web E2E_1919_BLOB_ROOT=<dir with fsn1/ hel1/ nbg1/> \
 *   E2E_1919_PGPASSWORD=<dev db password> E2E_NO_WEBSERVER=1 \
 *   bunx playwright test e2e/1919-region-choice.spec.ts
 *
 * What it proves (each is an assertion, not a screenshot alone):
 *   1. the page lists Europe (Default, selected for a person with no choice), three
 *      live cities with city + country FROM THE PAYLOAD, and Ede as Coming soon,
 *      disabled, and a click on it sends no request;
 *   2. choosing Helsinki / Nuremberg / Europe is persisted (survives a reload), the
 *      sidebar names it, and an UPLOAD lands in that pool: the chunk bytes appear
 *      under that pool's blob directory and in no other, the file's own
 *      `storage_location.city` says so, and the drive row names the same city;
 *   3. the list is the API's: flipping rows in the API's database (a datacenter
 *      coming soon, a pool switched off) changes the page with no client release;
 *   4. an API failure shows an honest error with Retry and NO invented list.
 */
test.skip(
  !process.env.E2E_1919,
  'needs the 1919 local stack (pools fsn1/hel1/nbg1, scratch DB); run e2e/scripts/region-stack.sh up and set E2E_1919=1',
)

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const DB = process.env.E2E_1919_DB ?? ''
const BLOB_ROOT = process.env.E2E_1919_BLOB_ROOT ?? ''
const PG_CONTAINER = process.env.E2E_1919_PG_CONTAINER ?? 'beebeebio-postgres-1'
const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR ?? path.join(process.cwd(), 'test-results', '1919')

test.describe.configure({ mode: 'serial' })

/** Edit the API's own database: the "change the API data" lever. */
function sql(statement: string): void {
  execFileSync(
    'docker',
    ['exec', '-e', 'PGPASSWORD', PG_CONTAINER, 'psql', '-U', 'beebeeb', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { env: { ...process.env, PGPASSWORD: process.env.E2E_1919_PGPASSWORD ?? '' }, stdio: 'pipe' },
  )
}

/** Count regular files under a pool's blob directory (chunks live somewhere below it). */
function blobCount(pool: 'fsn1' | 'hel1' | 'nbg1'): number {
  const walk = (dir: string): number =>
    readdirSync(dir).reduce((n, name) => {
      const p = path.join(dir, name)
      return n + (statSync(p).isDirectory() ? walk(p) : 1)
    }, 0)
  return walk(path.join(BLOB_ROOT, pool))
}

async function sessionHeaders(page: Page): Promise<Record<string, string>> {
  const cookie = (await page.context().cookies()).find((c) => c.name === 'bb_session')
  if (!cookie) throw new Error('bb_session cookie not present on the page context')
  return { Cookie: `bb_session=${cookie.value}` }
}

async function putPreference(page: Page, value: string | null): Promise<void> {
  const res = await page.request.put(`${API_URL}/api/v1/me/region`, {
    data: { preferred_region: value },
    headers: await sessionHeaders(page),
  })
  expect(res.ok(), `PUT /me/region ${value} -> ${res.status()}`).toBe(true)
}

async function bootApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 30_000 })
}

async function openResidency(page: Page): Promise<void> {
  await page.goto('/settings/data-residency')
  await expect(page.locator('h1, h2').getByText('Data Residency')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Loading regions…')).toHaveCount(0, { timeout: 15_000 })
}

async function listFileIds(page: Page): Promise<Map<string, { city: string | null }>> {
  const res = await page.request.get(`${API_URL}/api/v1/files`, { headers: await sessionHeaders(page) })
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { files: Array<{ id: string; is_folder: boolean; storage_location?: { city?: string } }> }
  return new Map(
    body.files.filter((f) => !f.is_folder).map((f) => [f.id, { city: f.storage_location?.city ?? null }]),
  )
}

test.beforeAll(() => {
  expect(DB, 'E2E_1919_DB').not.toBe('')
  expect(BLOB_ROOT, 'E2E_1919_BLOB_ROOT').not.toBe('')
  mkdirSync(EVIDENCE_DIR, { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await bootApp(page)
  // Start every test as a person with NO stored choice and a fully-live API.
  await putPreference(page, null)
  sql("UPDATE datacenters SET status = 'live' WHERE code IN ('fsn1','hel1','nbg1')")
  sql("UPDATE storage_pools SET is_active = TRUE WHERE region IN ('fsn1','hel1','nbg1')")
})

test.afterAll(() => {
  try {
    sql("UPDATE datacenters SET status = 'live' WHERE code IN ('fsn1','hel1','nbg1')")
    sql("UPDATE storage_pools SET is_active = TRUE WHERE region IN ('fsn1','hel1','nbg1')")
  } catch {
    /* best effort: the scratch DB is thrown away anyway */
  }
})

test('1. lists Europe (default), three live cities and Ede as coming soon, all from the API', async ({ page }) => {
  const listed = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/me/region') && r.request().method() === 'GET' && r.ok(),
  )
  await openResidency(page)
  const body = (await (await listed).json()) as { choices: Array<{ id: string; status: string }> }
  expect(body.choices.map((c) => `${c.id}:${c.status}`)).toEqual([
    'europe:live',
    'fsn1:live',
    'hel1:live',
    'nbg1:live',
    'ede:coming_soon',
  ])

  const europe = page.getByTestId('region-europe')
  await expect(europe).toHaveAttribute('aria-checked', 'true')
  await expect(europe).toContainText('Default')
  await expect(europe).toContainText('Any of our European datacenters')

  for (const [id, city, country] of [
    ['fsn1', 'Falkenstein', 'Germany'],
    ['hel1', 'Helsinki', 'Finland'],
    ['nbg1', 'Nuremberg', 'Germany'],
  ] as const) {
    const row = page.getByTestId(`region-${id}`)
    await expect(row).toBeEnabled()
    await expect(row).toContainText(city)
    await expect(row).toContainText(country)
    await expect(row).toHaveAttribute('aria-checked', 'false')
    await expect(row).not.toContainText('Coming soon')
  }

  const ede = page.getByTestId('region-ede')
  await expect(ede).toContainText('Ede')
  await expect(ede).toContainText('Netherlands')
  await expect(ede).toContainText('Coming soon')
  await expect(ede).toBeDisabled()
  await expect(ede).toHaveAttribute('aria-checked', 'false')

  // A click on a coming-soon row sends nothing and changes nothing.
  const puts: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v1/me/region') && r.method() === 'PUT') puts.push(r.postData() ?? '')
  })
  await ede.click({ force: true })
  await page.waitForTimeout(400)
  expect(puts).toEqual([])
  await expect(europe).toHaveAttribute('aria-checked', 'true')

  // The old single-region wording must be gone now that there is a real choice.
  await expect(page.getByText(/More regions coming soon/i)).toHaveCount(0)
  await expect(page.getByTestId('sidebar-region')).toHaveText('Europe')
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '1-list-default-europe.png'), fullPage: true })
})

for (const target of [
  { id: 'hel1', city: 'Helsinki', label: 'Helsinki, Finland' },
  { id: 'nbg1', city: 'Nuremberg', label: 'Nuremberg, Germany' },
  { id: 'fsn1', city: 'Falkenstein', label: 'Falkenstein, Germany' },
] as const) {
  test(`2. choose ${target.city}: it persists, the sidebar names it, and an upload lands in the ${target.id} pool only`, async ({ page }) => {
    await openResidency(page)
    const put = page.waitForRequest((r) => r.url().endsWith('/api/v1/me/region') && r.method() === 'PUT')
    await page.getByTestId(`region-${target.id}`).click()
    expect(JSON.parse((await put).postData() ?? '{}')).toEqual({ preferred_region: target.id })
    await expect(page.getByText('Region updated')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId(`region-${target.id}`)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('region-europe')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('sidebar-region')).toHaveText(target.label)

    // Persisted on the server: a full reload still shows it.
    await openResidency(page)
    await expect(page.getByTestId(`region-${target.id}`)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('sidebar-region')).toHaveText(target.label)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `2-${target.id}-selected.png`), fullPage: true })

    // Upload through the real UI and see which pool took the bytes.
    await bootApp(page)
    const before = { fsn1: blobCount('fsn1'), hel1: blobCount('hel1'), nbg1: blobCount('nbg1') }
    const knownIds = new Set((await listFileIds(page)).keys())
    const name = `region-${target.id}-${Date.now()}.txt`
    await uploadTextFile(page, name, `hello ${target.city} ${Math.random()}`)

    await expect
      .poll(() => blobCount(target.id), { timeout: 20_000, message: `${target.id} pool should hold the new chunk(s)` })
      .toBeGreaterThan(before[target.id])
    const after = { fsn1: blobCount('fsn1'), hel1: blobCount('hel1'), nbg1: blobCount('nbg1') }
    for (const other of ['fsn1', 'hel1', 'nbg1'] as const) {
      if (other !== target.id) expect(after[other], `${other} must not gain bytes`).toBe(before[other])
    }

    const nowFiles = await listFileIds(page)
    const fresh = [...nowFiles.entries()].filter(([id]) => !knownIds.has(id))
    expect(fresh.length).toBe(1)
    expect(fresh[0][1].city, "the file's own storage_location").toBe(target.city)

    // The drive row names the file's real city (not a hardcoded one) ...
    await expect(page.getByText(`AES-256-GCM · Europe · ${target.city}`).first()).toBeVisible({ timeout: 20_000 })
    // ... and so does the encryption-details panel.
    await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Encryption details' }).click()
    await expect(page.getByRole('dialog').getByText(`Europe · ${target.city}`)).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `2-${target.id}-uploaded-row.png`), fullPage: true })
  })
}

test('3. choose Europe (the default): the upload follows default placement (the default pool, fsn1)', async ({ page }) => {
  await putPreference(page, 'hel1') // start from a pinned city so choosing Europe is a real change
  await openResidency(page)
  await expect(page.getByTestId('region-hel1')).toHaveAttribute('aria-checked', 'true')

  const put = page.waitForRequest((r) => r.url().endsWith('/api/v1/me/region') && r.method() === 'PUT')
  await page.getByTestId('region-europe').click()
  expect(JSON.parse((await put).postData() ?? '{}')).toEqual({ preferred_region: 'europe' })
  await expect(page.getByTestId('region-europe')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('sidebar-region')).toHaveText('Europe')

  await openResidency(page)
  await expect(page.getByTestId('region-europe')).toHaveAttribute('aria-checked', 'true')

  await bootApp(page)
  const before = { fsn1: blobCount('fsn1'), hel1: blobCount('hel1'), nbg1: blobCount('nbg1') }
  const knownIds = new Set((await listFileIds(page)).keys())
  await uploadTextFile(page, `region-europe-${Date.now()}.txt`, `hello europe ${Math.random()}`)
  await expect.poll(() => blobCount('fsn1'), { timeout: 20_000 }).toBeGreaterThan(before.fsn1)
  expect(blobCount('hel1')).toBe(before.hel1)
  expect(blobCount('nbg1')).toBe(before.nbg1)
  const fresh = [...(await listFileIds(page)).entries()].filter(([id]) => !knownIds.has(id))
  expect(fresh.length).toBe(1)
  expect(fresh[0][1].city).toBe('Falkenstein')
})

test('4. the list is the API\'s: change its data and the page changes, no client release', async ({ page }) => {
  await openResidency(page)
  await expect(page.getByTestId('region-nbg1')).toBeEnabled()

  // A datacenter marked coming soon in the API's data becomes a Coming soon row.
  sql("UPDATE datacenters SET status = 'coming_soon' WHERE code = 'nbg1'")
  await openResidency(page)
  await expect(page.getByTestId('region-nbg1')).toContainText('Coming soon')
  await expect(page.getByTestId('region-nbg1')).toBeDisabled()
  await expect(page.getByTestId('region-hel1')).toBeEnabled()

  // A datacenter whose pool is switched off is not offered at all.
  sql("UPDATE datacenters SET status = 'live' WHERE code = 'nbg1'")
  sql("UPDATE storage_pools SET is_active = FALSE WHERE region = 'nbg1'")
  await openResidency(page)
  await expect(page.getByTestId('region-nbg1')).toHaveCount(0)
  await expect(page.getByText('Nuremberg')).toHaveCount(0)
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '4-nuremberg-removed-by-api-data.png'), fullPage: true })

  // A person who chose it before it went away is told, and sits on Europe.
  sql("UPDATE storage_pools SET is_active = TRUE WHERE region = 'nbg1'")
  await putPreference(page, 'nbg1')
  sql("UPDATE storage_pools SET is_active = FALSE WHERE region = 'nbg1'")
  await openResidency(page)
  await expect(page.getByTestId('region-unavailable')).toBeVisible()
  await expect(page.getByTestId('region-europe')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('sidebar-region')).toHaveText('Europe')

  // And when it is back, their choice is selected again, untouched.
  sql("UPDATE storage_pools SET is_active = TRUE WHERE region = 'nbg1'")
  await openResidency(page)
  await expect(page.getByTestId('region-nbg1')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('region-unavailable')).toHaveCount(0)
})

test('5. an API failure shows an honest error with Retry and no invented list; an older server says so', async ({ page }) => {
  await page.route('**/api/v1/me/region', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
      : route.continue(),
  )
  await page.goto('/settings/data-residency')
  await expect(page.getByTestId('region-error')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('region-error')).toContainText('could not load the region list')
  for (const id of ['europe', 'fsn1', 'hel1', 'nbg1', 'ede']) {
    await expect(page.getByTestId(`region-${id}`)).toHaveCount(0)
  }
  await expect(page.getByText(/Falkenstein|Helsinki|Nuremberg/)).toHaveCount(0)

  // Retry reaches the real API again.
  await page.unroute('**/api/v1/me/region')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByTestId('region-hel1')).toBeVisible({ timeout: 15_000 })

  // A server older than the feature answers without `choices`: say so, list nothing.
  await page.route('**/api/v1/me/region', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const real = await route.fetch()
    const json = (await real.json()) as Record<string, unknown>
    delete json.choices
    return route.fulfill({ response: real, json })
  })
  await page.goto('/settings/data-residency')
  await expect(page.getByTestId('region-error')).toContainText('needs the latest server update', { timeout: 30_000 })
  await expect(page.getByTestId('region-hel1')).toHaveCount(0)
})

test('6. a sync-derived refresh keeps every row\'s real city (review on web#167)', async ({ page }) => {
  // Files from test 2 sit in three pools. The drive first shows the API rows,
  // which carry `storage_location`; sync nodes carry only a pool id.
  await bootApp(page)
  const files = await listFileIds(page)
  const cities = new Set([...files.values()].map((f) => f.city))
  for (const city of ['Helsinki', 'Nuremberg', 'Falkenstein']) {
    expect(cities.has(city), `a file stored in ${city} exists (from test 2)`).toBe(true)
    await expect(page.getByText(`AES-256-GCM · Europe · ${city}`).first()).toBeVisible({ timeout: 20_000 })
  }

  // Another device stars the Helsinki file. The page hears it over the sync
  // stream (`file.starred`), which re-derives the rows from the sync tree and
  // triggers no API refetch: the rows on screen are now sync-derived.
  const pressed = page.locator('button[aria-label="Unstar"][aria-pressed="true"]')
  const starredBefore = await pressed.count()
  const helId = [...files.entries()].find(([, f]) => f.city === 'Helsinki')?.[0]
  expect(helId).toBeTruthy()
  const toggle = async () => {
    const res = await page.request.patch(`${API_URL}/api/v1/files/${helId}/star`, { headers: await sessionHeaders(page) })
    expect(res.ok(), `PATCH star -> ${res.status()}`).toBe(true)
    return ((await res.json()) as { is_starred: boolean }).is_starred
  }
  const nowStarred = await toggle()
  try {
    // The star (or its removal) reached the page: the rows are sync-derived now.
    await expect(pressed).toHaveCount(starredBefore + (nowStarred ? 1 : -1), { timeout: 20_000 })

    // Every row still names its own city; none fell back to plain "Europe".
    // Sampled without retries: a later API refetch could hide a lost city
    // behind an auto-retrying assertion.
    const bare = page.getByText('AES-256-GCM · Europe', { exact: true })
    for (let i = 0; i < 10; i++) {
      expect(await bare.count(), `rows without a city, sample ${i}`).toBe(0)
      for (const city of ['Helsinki', 'Nuremberg', 'Falkenstein']) {
        expect(await page.getByText(`AES-256-GCM · Europe · ${city}`).count(), `${city} rows, sample ${i}`).toBeGreaterThan(0)
      }
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '6-sync-refresh-keeps-cities.png'), fullPage: true })
  } finally {
    // Leave the file as it was.
    await toggle()
  }
})
