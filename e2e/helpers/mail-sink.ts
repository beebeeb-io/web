import { readFileSync } from 'node:fs'

/**
 * Task 1525 — reads the "dev mail sink" the isolated e2e harness already
 * produces for the signup email-code flow.
 *
 * There is no dedicated mail-sink service in this stack (no Mailpit/MailHog
 * container, no `/dev/emails` inspection endpoint — checked). What DOES
 * exist: `beebeeb-api`'s `EmailBackend::Console` (`beebeeb-api/src/email.rs`)
 * — the backend it falls back to whenever SMTP isn't configured, which is
 * always true for `e2e/scripts/web-e2e.sh`'s isolated :3003 backend. Console
 * mode logs the FULL rendered email (to/subject/body) via `tracing::info!`,
 * and the harness already redirects that process's stdout+stderr to
 * `/tmp/bb-web-e2e-api.log` (`start_backend()`'s `>/tmp/bb-web-e2e-api.log
 * 2>&1`). That log file IS the sink — this module just reads it.
 *
 * Requires `RUST_LOG` to include the email module at `info` (the default
 * `EnvFilter` with `RUST_LOG` unset only surfaces `ERROR`, which drops these
 * lines silently — checked by running the debug binary both ways). Every
 * spec that drives a real signup through `e2e/helpers/signup.ts` needs this;
 * set it once when invoking the harness:
 *
 *   RUST_LOG=beebeeb_api::email=info ./e2e/scripts/web-e2e.sh <spec>
 *
 * (narrowly scoped to the one module that logs emails, so it doesn't drown
 * the log in unrelated request-tracing noise). `Makefile`'s `web-e2e` target
 * exports this default so `make web-e2e` needs no extra flag; a caller that
 * sets its own `RUST_LOG` keeps that value untouched.
 */

const DEFAULT_LOG_PATH = '/tmp/bb-web-e2e-api.log'

export function mailSinkLogPath(): string {
  return process.env.BB_E2E_API_LOG ?? DEFAULT_LOG_PATH
}

/**
 * Split a Console-mode log into per-email blocks. Each send renders as one
 * `tracing::info!` event whose message is the literal template from
 * `EmailBackend::Console`'s `send()`:
 *
 *   \n--- EMAIL (console mode) ---\nFrom: ...\nTo: ...\nSubject: ...\n...\n\n<body>\n--- END EMAIL ---
 *
 * Splitting on the opening marker gives one array entry per send, each
 * still carrying everything up to (and past) its own closing marker — good
 * enough to `.includes()` / regex-match against without needing to find the
 * closing marker explicitly.
 */
function emailBlocks(log: string): string[] {
  return log.split('--- EMAIL (console mode) ---').slice(1)
}

/**
 * The 8-digit code from the MOST RECENT `VerificationEmail` sent to `email`
 * (task 1525's `/signup/email-start` new-account branch,
 * `email_templates.rs::VerificationEmail::text()` — "Enter this code to
 * verify your Beebeeb account: <code>").
 *
 * Stale note (round 1/2, no longer true): this doc used to say "a second
 * /email-start call invalidates the first code" — round 3 (server #95,
 * `3c5f706`) changed that: a resend now ADDS a new live code (up to
 * `MAX_LIVE_CODES_PER_EMAIL` = 3 simultaneously live) rather than replacing
 * it, so an earlier code stays valid too. "Most recent" here just means
 * this function always returns the LATEST one sent — a caller that needs a
 * SPECIFIC earlier code (e.g. to prove it still verifies after a resend)
 * should capture it directly from an earlier `waitForSignupCode()` call, or
 * use `waitForNewSignupCode()` below to get a code distinct from one already
 * held.
 */
export function extractSignupCode(log: string, email: string): string | null {
  const blocks = emailBlocks(log)
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (!block.includes(`To: ${email}\n`)) continue
    const m = block.match(/Enter this code to verify your Beebeeb account: (\d{8})/)
    if (m) return m[1]
  }
  return null
}

/**
 * Every distinct 8-digit signup code sent to `email` so far, oldest first.
 * Task 1525 round 3: up to `MAX_LIVE_CODES_PER_EMAIL` (3) can be
 * simultaneously live, so a resend-heavy flow can have more than one.
 */
export function extractAllSignupCodes(log: string, email: string): string[] {
  const blocks = emailBlocks(log)
  const codes: string[] = []
  for (const block of blocks) {
    if (!block.includes(`To: ${email}\n`)) continue
    const m = block.match(/Enter this code to verify your Beebeeb account: (\d{8})/)
    if (m && !codes.includes(m[1])) codes.push(m[1])
  }
  return codes
}

/**
 * Poll until a signup code DIFFERENT from `excluding` shows up for `email` —
 * the resend case (task 1525 round 3: a resend ADDS a new code rather than
 * replacing the old one, so two distinct codes can be live at once and both
 * verify).
 */
export async function waitForNewSignupCode(
  email: string,
  excluding: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  return pollLog((log) => extractAllSignupCodes(log, email).find((c) => c !== excluding) ?? null, {
    timeoutMs: opts.timeoutMs ?? 10_000,
    intervalMs: opts.intervalMs ?? 250,
  })
}

export interface SignupExistsEmail {
  subject: string
  /** The sign-in link's full URL, e.g. "http://localhost:5173/login?email=...". */
  signinUrl: string | null
}

/**
 * The MOST RECENT `SignupEmailExistsEmail` sent to `email` (task 1525's
 * `/signup/email-start` existing-account branch — NO code, a sign-in link
 * instead). Used by the "existing email" e2e case to prove the sink
 * received the right template without ever needing (or being able to
 * obtain) a real code for that email.
 */
export function extractSignupExistsEmail(log: string, email: string): SignupExistsEmail | null {
  const blocks = emailBlocks(log)
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (!block.includes(`To: ${email}\n`)) continue
    if (!block.includes('You already have an account')) continue
    const subjectMatch = block.match(/^Subject: (.+)$/m)
    const urlMatch = block.match(/forgotten it: (\S+)/)
    return {
      subject: subjectMatch ? subjectMatch[1].trim() : '',
      signinUrl: urlMatch ? urlMatch[1] : null,
    }
  }
  return null
}

async function pollLog<T>(
  extract: (log: string) => T | null,
  opts: { timeoutMs: number; intervalMs: number },
): Promise<T> {
  const logPath = mailSinkLogPath()
  const deadline = Date.now() + opts.timeoutMs
  let lastLogLength = -1
  for (;;) {
    let log = ''
    try {
      log = readFileSync(logPath, 'utf8')
    } catch {
      // Log file not created yet (backend still booting) — keep polling.
    }
    const found = extract(log)
    if (found !== null) return found
    if (Date.now() >= deadline) {
      throw new Error(
        `mail-sink: timed out after ${opts.timeoutMs}ms waiting for a match in ${logPath} ` +
          `(${log.length} bytes read, was ${lastLogLength} bytes on the previous poll). ` +
          `Is RUST_LOG=beebeeb_api::email=info set on the harness invocation? See mail-sink.ts's header comment.`,
      )
    }
    lastLogLength = log.length
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs))
  }
}

/** Poll the mail sink until `email`'s signup code appears, or throw. */
export async function waitForSignupCode(
  email: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  return pollLog((log) => extractSignupCode(log, email), {
    timeoutMs: opts.timeoutMs ?? 10_000,
    intervalMs: opts.intervalMs ?? 250,
  })
}

/** Poll the mail sink until `email`'s "you already have an account" email appears, or throw. */
export async function waitForSignupExistsEmail(
  email: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<SignupExistsEmail> {
  return pollLog((log) => extractSignupExistsEmail(log, email), {
    timeoutMs: opts.timeoutMs ?? 10_000,
    intervalMs: opts.intervalMs ?? 250,
  })
}
