import { test, expect, type Page } from '@playwright/test'
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Task 1734 (P0, security review 2026-10-04, finding 9) — a device-code login
 * must not be approvable by a click on a link.
 *
 * The attack, played for real against the isolated stack: an ATTACKER opens the
 * device-auth WebSocket with an ECDH key they generated, receives a code, and
 * sends the VICTIM a link to the approval page. Before the fix, the link
 * carried the code, the page showed it with one Authorize button, and a click
 * from a signed-in, unlocked victim minted a 30-day session and wrapped the
 * victim's master key to the attacker's key.
 *
 * What this spec proves in a browser (the user-facing surface — curl would not):
 *  1. visiting the link approves nothing and fetches nothing: the page ignores
 *     the code in the URL, says so, and offers no approve button;
 *  2. the person must TYPE the code; the page then shows what the SERVER
 *     measured about the asker (address, time) and what the device merely
 *     claims, with the honest warning;
 *  3. approving requires re-proving the password first, and a WRONG password
 *     releases nothing — no session minted, nothing relayed, the attacker's
 *     socket stays silent;
 *  4. with the right password the happy path still works end to end: the
 *     device decrypts a payload holding a working session, the account owner
 *     gets a security notification, and no request body ever carried the
 *     master key in the clear.
 *
 * Screenshots land under E2E_EVIDENCE_DIR (default test-results/1734).
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'
const DEV_PASSWORD = 'devdevdevdevdev!'
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? 'test-results/1734'

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true })
  // The cookie banner floats over the card in a screenshot; dismiss it so the
  // evidence shows the page, not the banner.
  const essentialOnly = page.getByRole('button', { name: 'Essential only' })
  if (await essentialOnly.isVisible().catch(() => false)) await essentialOnly.click()
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) })
}

async function devLogin(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB_URL}/?dev_email=${encodeURIComponent(email)}`)
  await page.waitForFunction(() => document.body.dataset.cryptoReady === 'true', { timeout: 60_000 })
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === 'bb_session'), { timeout: 30_000 })
    .toBe(true)
}

function uniqueDevEmail(label: string): string {
  return `cli-e2e-1734-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@beebeeb.dev`
}

/** The attacker's device: a real P-256 key and a real device-auth socket. */
class AttackerDevice {
  private ecdh = createECDH('prime256v1')
  private ws!: WebSocket
  readonly frames: Array<Record<string, unknown>> = []
  code = ''
  verificationUri = ''

  async start(extra: Record<string, unknown> = {}): Promise<void> {
    this.ecdh.generateKeys()
    this.ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/api/v1/auth/cli`)
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('device-auth WebSocket failed to open'))
    })
    const hello = new Promise<Record<string, unknown>>((resolve) => {
      this.ws.onmessage = (ev) => {
        const frame = JSON.parse(String(ev.data)) as Record<string, unknown>
        this.frames.push(frame)
        if (typeof frame.user_code === 'string') resolve(frame)
      }
    })
    this.ws.send(
      JSON.stringify({ ecdh_public_key_b64: this.ecdh.getPublicKey().toString('base64'), ...extra }),
    )
    const first = await hello
    this.code = first.user_code as string
    this.verificationUri = first.verification_uri as string
  }

  /** Frames received AFTER the code was issued (i.e. a relayed payload or an error). */
  get relayed(): Array<Record<string, unknown>> {
    return this.frames.filter((f) => typeof f.user_code !== 'string')
  }

  async waitForRelay(ms: number): Promise<Record<string, unknown> | null> {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const hit = this.relayed.find((f) => typeof f.encrypted_payload_b64 === 'string')
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 200))
    }
    return null
  }

  /** ECDH -> HKDF-SHA256("beebeeb-cli-auth-v1") -> AES-256-GCM, exactly what `bb login` does. */
  decrypt(frame: Record<string, unknown>): { session_token: string; master_key_b64: string; email: string } {
    const shared = this.ecdh.computeSecret(Buffer.from(frame.browser_ecdh_public_b64 as string, 'base64'))
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'beebeeb-cli-auth-v1', 32))
    const sealed = Buffer.from(frame.encrypted_payload_b64 as string, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(frame.nonce_b64 as string, 'base64'))
    decipher.setAuthTag(sealed.subarray(sealed.length - 16))
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  }

  close(): void {
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}

/** Every request the page makes to the device-auth endpoints, and every body it posts. */
function watchRequests(page: Page) {
  const cliCalls: string[] = []
  const bodies: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (/\/api\/v1\/auth\/cli-/.test(url)) cliCalls.push(`${req.method()} ${new URL(url).pathname}`)
    const body = req.postData()
    if (body) bodies.push(body)
  })
  return { cliCalls, bodies }
}

test.describe('task 1734: a device-approval link carries nothing to approve', () => {
  test('visiting the attacker link approves nothing, fetches nothing and says why', async ({ page }) => {
    const attacker = new AttackerDevice()
    await attacker.start({ client: 'cli', device_name: 'attacker-box', os: 'linux' })
    try {
      await devLogin(page, uniqueDevEmail('link'))
      const seen = watchRequests(page)

      // The link the attacker sends. Before the fix this alone armed the one-click approval.
      await page.goto(`${WEB_URL}/cli-auth?code=${attacker.code}`)

      // Let the page settle FIRST. A "there is no approve button" check run before
      // the page has rendered passes vacuously; the unfixed page needs a moment to
      // fetch the attacker's key and then shows its one-click button.
      await expect.soft(page.getByLabel('Code from your device')).toBeVisible()
      await page.waitForTimeout(2500)

      // Soft assertions: on the unfixed page EVERY one of these is wrong, and the
      // report should say so, not stop at the first.
      await expect.soft(page.getByRole('button', { name: /approve|authorize/i })).toHaveCount(0)
      await expect.soft(page.getByLabel('Code from your device')).toHaveValue('')
      await expect.soft(page.getByTestId('cli-link-code-notice')).toBeVisible()
      await expect.soft(page.getByTestId('cli-link-code-notice')).toContainText('We ignored it')
      await shot(page, '01-link-with-code-is-ignored')

      expect.soft(seen.cliCalls, `the page called ${seen.cliCalls.join(', ')} just from a link`).toEqual([])
      expect.soft(attacker.relayed, 'the attacker received something from a mere link visit').toEqual([])
    } finally {
      attacker.close()
    }
  })

  test('typing the code shows who is asking; the wrong password releases nothing; the right one approves', async ({
    page,
  }) => {
    const attacker = new AttackerDevice()
    await attacker.start({ client: 'cli', client_version: '0.9.9', device_name: 'E2E-Laptop', os: 'macos' })
    try {
      const email = uniqueDevEmail('approve')
      await devLogin(page, email)
      const seen = watchRequests(page)

      await page.goto(`${WEB_URL}/cli-auth`)
      await expect(page.getByLabel('Code from your device')).toBeVisible()
      await expect(page.getByTestId('cli-link-code-notice')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /approve|authorize/i })).toHaveCount(0)

      // A typo is refused with an honest message.
      await page.getByLabel('Code from your device').fill('ZZZZ-ZZZZ')
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByText('Nothing is waiting under that code')).toBeVisible()

      // The real code, typed lower-case with a space the way people paste it.
      const spaced = `${attacker.code.slice(0, 4)} ${attacker.code.slice(5)}`.toLowerCase()
      await page.getByLabel('Code from your device').fill(spaced)
      await expect(page.getByLabel('Code from your device')).toHaveValue(attacker.code)
      await page.getByRole('button', { name: 'Continue' }).click()

      // What the SERVER measured, what the device merely claims, and the warning.
      const facts = page.getByTestId('cli-request-facts')
      await expect(facts).toBeVisible()
      await expect(facts).toContainText('127.0.0.1')
      await expect(facts).toContainText('just now')
      const reported = page.getByTestId('cli-request-reported')
      await expect(reported).toContainText('E2E-Laptop')
      await expect(reported).toContainText('Beebeeb command-line tool 0.9.9 on macOS')
      await expect(reported).toContainText('can be wrong or made up')
      await expect(page.getByTestId('cli-warning')).toContainText('Only approve this if you started it yourself')
      await shot(page, '02-typed-code-shows-who-is-asking')

      // Approve -> the step-up. Nothing has been minted or sent yet.
      await page.getByRole('button', { name: /approve this device/i }).click()
      const dialog = page.getByRole('dialog', { name: 'Confirm your identity' })
      await expect(dialog).toBeVisible()
      expect(seen.cliCalls.filter((c) => /cli-(session|authorize)/.test(c))).toEqual([])

      // WRONG password: refused, and still nothing minted, nothing relayed.
      await dialog.getByLabel('Password').fill('definitely-not-my-password')
      await dialog.getByRole('button', { name: 'Approve device' }).click()
      await expect(dialog.getByText('Incorrect password')).toBeVisible()
      await shot(page, '03-wrong-password-releases-nothing')
      await page.waitForTimeout(1500)
      expect(
        seen.cliCalls.filter((c) => /cli-(session|authorize)/.test(c)),
        'a wrong password must not mint a session or call the relay',
      ).toEqual([])
      expect(attacker.relayed, 'a wrong password must release nothing to the device').toEqual([])

      // RIGHT password: approved.
      await dialog.getByLabel('Password').fill(DEV_PASSWORD)
      await dialog.getByRole('button', { name: 'Approve device' }).click()
      await expect(page.getByText('Device approved')).toBeVisible({ timeout: 60_000 })
      await shot(page, '04-approved-after-the-right-password')

      // The device receives a payload it can decrypt: a working session + the key.
      const relayed = await attacker.waitForRelay(15_000)
      expect(relayed, 'the device never received the relayed payload').not.toBeNull()
      const creds = attacker.decrypt(relayed!)
      expect(creds.email).toBe(email)
      expect(creds.master_key_b64.length).toBeGreaterThan(40)
      const me = await page.request.get(`${API_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${creds.session_token}` },
      })
      expect(me.status(), 'the minted session must work').toBe(200)
      expect(((await me.json()) as { email: string }).email).toBe(email)

      // The server saw only ciphertext: the master key never travelled in the clear.
      for (const body of seen.bodies) {
        expect(body.includes(creds.master_key_b64), 'a request body carried the master key in the clear').toBe(false)
      }

      // The account owner was told.
      const notes = await page.request.get(`${API_URL}/api/v1/notifications`)
      const titles = ((await notes.json()) as { notifications: Array<{ type: string; title: string }> }).notifications
        .filter((n) => n.type === 'security')
        .map((n) => n.title)
      expect(titles.some((t) => t.includes('Device sign-in approved from 127.0.0.1'))).toBe(true)

      // And the exact sequence the page used: lookup, mint, relay — in that order, once each.
      expect(seen.cliCalls).toEqual([
        'GET /api/v1/auth/cli-pubkey',
        'GET /api/v1/auth/cli-pubkey',
        'POST /api/v1/auth/cli-session',
        'POST /api/v1/auth/cli-authorize',
      ])
    } finally {
      attacker.close()
    }
  })

  test('"This isn\'t me" abandons the request without sending anything', async ({ page }) => {
    const attacker = new AttackerDevice()
    await attacker.start()
    try {
      await devLogin(page, uniqueDevEmail('decline'))
      const seen = watchRequests(page)
      await page.goto(`${WEB_URL}/cli-auth`)
      await page.getByLabel('Code from your device').fill(attacker.code)
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByTestId('cli-warning')).toBeVisible()
      await page.getByRole('button', { name: "This isn't me" }).click()
      await expect(page.getByLabel('Code from your device')).toHaveValue('')
      await page.waitForTimeout(1000)
      expect(seen.cliCalls.filter((c) => /cli-(session|authorize)/.test(c))).toEqual([])
      expect(attacker.relayed).toEqual([])
    } finally {
      attacker.close()
    }
  })
})
