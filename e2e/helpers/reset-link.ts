import { execFileSync } from 'child_process'
import crypto from 'crypto'

/**
 * Get the emailed /set-password/<token> link for `email` (task 1803).
 *
 * The raw one-time token only ever exists in the email — the server stores its
 * SHA-256 (task 0451/0452 convention). Two ways to obtain it, in order:
 *
 *  1. Mailpit (`E2E_MAILPIT_URL`, e.g. http://localhost:8025): the API under
 *     test was started with SMTP pointed at Mailpit, so this reads the REAL
 *     email the forgot-password request sent. This is the preferred rung.
 *  2. No Mailpit: mint a token the way the request leg stores it (an
 *     `auth_confirmations` row, purpose `set_password`, SHA-256 at rest) with a
 *     raw value of our own. This skips the email transport and nothing else.
 *
 * `usedMailpit` is returned so a spec can say which rung it ran on.
 */

const PG_URL = `postgres://beebeeb:beebeeb_dev@localhost:${process.env.E2E_PG_PORT ?? '5434'}/${process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'}`

function sql(statement: string): void {
  try {
    execFileSync('psql', [PG_URL, '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    // No host psql: the dev Postgres container (same fallback web-e2e.sh uses).
    const container = process.env.E2E_PG_CONTAINER ?? 'beebeebio-postgres-1'
    const db = process.env.E2E_DB_NAME ?? 'beebeeb_web_e2e_3003'
    execFileSync(
      'docker',
      ['exec', '-e', 'PGPASSWORD=beebeeb_dev', container, 'psql', '-U', 'beebeeb', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', statement],
      { stdio: 'pipe' },
    )
  }
}

async function tokenFromMailpit(mailpitUrl: string, email: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
      if (res.ok) {
        const data = (await res.json()) as { messages?: Array<{ ID: string }> }
        const first = data.messages?.[0]
        if (first) {
          const msg = (await (await fetch(`${mailpitUrl}/api/v1/message/${first.ID}`)).json()) as { Text?: string }
          const m = (msg.Text ?? '').match(/\/set-password\/([A-Za-z0-9_-]+)/)
          if (m) return m[1]
          last = 'message found but no /set-password/<token> link in its text'
        }
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no set-password email for ${email} at ${mailpitUrl} within ${timeoutMs}ms (${last})`)
}

export async function setPasswordToken(email: string): Promise<{ token: string; usedMailpit: boolean }> {
  const mailpit = process.env.E2E_MAILPIT_URL
  if (mailpit) return { token: await tokenFromMailpit(mailpit, email), usedMailpit: true }

  const raw = `t1803-${crypto.randomBytes(24).toString('base64url')}`
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const safeEmail = email.replace(/'/g, "''")
  sql(
    `INSERT INTO auth_confirmations (user_id, token, expires_at, purpose) ` +
      `SELECT id, '${hash}', NOW() + INTERVAL '30 minutes', 'set_password' FROM users WHERE email = '${safeEmail}'`,
  )
  return { token: raw, usedMailpit: false }
}
