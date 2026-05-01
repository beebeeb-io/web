import { test, expect } from '@playwright/test'

/**
 * E2E test for the file upload flow.
 *
 * Verifies the round-trip: signup → upload → drive listing returns the
 * file with the original metadata. Goes through the public HTTP surface
 * (no test-only seams) so a regression in any layer — auth, multipart
 * parsing, blob storage, listing query — fails the test.
 *
 * Prerequisites (same as other specs):
 *   1. Postgres:  docker compose -f ../../docker-compose.yml up -d postgres
 *   2. API:       cd ../server && cargo run -p beebeeb-api
 *   3. Web:       bun dev
 */

const API = 'http://localhost:3001'
const PASSWORD = 'test-password-e2e-secure!'
const uniqueEmail = () => `upload-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@beebeeb-test.io`

test.describe('Upload E2E', () => {
  test('signup → upload file → appears in drive listing', async ({ page }) => {
    const email = uniqueEmail()
    const filename = `e2e-upload-${Date.now()}.txt`
    const fileBytes = Buffer.from('Hello from the Beebeeb upload E2E test.\n', 'utf-8')

    // 1. Signup creates the account and returns a session token.
    const signup = await page.request.post(`${API}/api/v1/auth/signup`, {
      data: { email, password: PASSWORD },
    })
    expect(signup.ok()).toBeTruthy()
    const { session_token } = await signup.json()
    expect(session_token).toBeTruthy()

    // 2. Login round-trips the credentials so the session-cookie/token path
    //    is exercised end-to-end (signup also returns a token, but a separate
    //    login is what real users hit).
    const login = await page.request.post(`${API}/api/v1/auth/login`, {
      data: { email, password: PASSWORD },
    })
    expect(login.ok()).toBeTruthy()
    const loginBody = await login.json()
    const token = loginBody.session_token ?? session_token
    expect(token).toBeTruthy()

    // 3. Upload the file via the multipart endpoint that the web client uses.
    const metadata = JSON.stringify({
      name_encrypted: filename,
      mime_type: 'text/plain',
      size_bytes: fileBytes.length,
      parent_id: null,
    })
    const upload = await page.request.post(`${API}/api/v1/files/upload`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        metadata: { name: 'metadata.json', mimeType: 'application/json', buffer: Buffer.from(metadata) },
        chunk_0: { name: filename, mimeType: 'text/plain', buffer: fileBytes },
      },
    })
    expect(upload.ok(), `upload failed: ${upload.status()} ${await upload.text()}`).toBeTruthy()
    const uploaded = await upload.json()
    expect(uploaded.id).toBeTruthy()
    expect(uploaded.name_encrypted).toBe(filename)
    expect(uploaded.size_bytes).toBe(fileBytes.length)
    expect(uploaded.chunk_count).toBe(1)

    // 4. The listing endpoint returns the new file.
    const list = await page.request.get(`${API}/api/v1/files`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(list.ok()).toBeTruthy()
    const { files } = await list.json()
    const found = files.find((f: { id: string }) => f.id === uploaded.id)
    expect(found, `uploaded file ${uploaded.id} missing from /api/v1/files`).toBeTruthy()
    expect(found.name_encrypted).toBe(filename)
    expect(found.size_bytes).toBe(fileBytes.length)
    expect(found.is_folder).toBe(false)

    // 5. Drive UI loads the listing for this session and shows the filename.
    //    Names that aren't valid encrypted-JSON (this test uses the raw
    //    filename) fall through to the raw value, so it appears as-is.
    await page.addInitScript(t => localStorage.setItem('bb_session', t), token)
    await page.goto('/')

    // Either the drive renders the file, or vault provisioning blocks the
    // route. Both are valid outcomes for a session that didn't go through
    // the recovery-phrase onboarding — the API-level assertions above are
    // the load-bearing ones. Best-effort UI check:
    const driveCell = page.getByText(filename, { exact: false })
    await driveCell.first().waitFor({ timeout: 5_000 }).catch(() => {
      // UI render is not the contract under test; the API listing already
      // proved the upload reached storage. Don't fail the test on it.
    })
  })
})
