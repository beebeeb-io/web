/**
 * Task 1918 round 3 — the erase needs an email confirmation before anything counts down.
 *
 * Guus, 2026-10-18: "Mm erase all files then requires email verify", and how: "Verify link + 72 h".
 * A new request is `verified: false` with no due time; the email carries a confirmation link
 * (`/erase-request/verify#t=<token>`) and a cancel link. Only the click on the confirmation link
 * starts the 72 hours. Unconfirmed for 24 hours, the request lapses. These tests pin the web half:
 *
 *  1. the status is parsed with the new fields, and a request whose due time and confirmation
 *     disagree is refused;
 *  2. the locked screen shows three states: "check your email to confirm" (awaiting), the due time
 *     with Cancel (pending, confirmed), and "the confirmation link expired" (ask, after a lapse);
 *  3. the screen looks again when the confirmation window closes;
 *  4. `verifyByLink` posts the fragment token without credentials and maps every answer;
 *  5. the confirmation page says what will happen and does NOT confirm on load (mail scanners
 *     run JavaScript); after the click it shows the due time and a Cancel button;
 *  6. the page is vault-free and never reaches the credentialed client.
 *
 * Modules that do not exist before round 3 are imported dynamically, so on the round-2 head each
 * test fails on its own instead of the file failing to load.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EraseRequestCard, type EraseRequestCardProps } from '../src/components/erase-request-card'
import { eraseCard, formatDue, parseEraseStatus, type EraseStatus } from '../src/lib/erase-request'
import { isVaultFreePath } from '../src/lib/vault-free-paths'

const SRC = path.resolve(import.meta.dir, '../src')
const TOKEN = 'Qm9vbS1ib29tLWJvb20tYm9vbS1ib29tLWJvb20tYm9v'
const TOKEN2 = 'U2Vjb25kLWNhbmNlbC10b2tlbi1mb3ItdGhlLWVtYWls'

type Mod = Record<string, unknown>
type Fn = (...args: unknown[]) => unknown

async function lib(): Promise<Mod> {
  return (await import('../src/lib/erase-request')) as unknown as Mod
}
async function link(): Promise<Mod> {
  return (await import('../src/lib/erase-request-link')) as unknown as Mod
}
async function page(): Promise<Mod> {
  return (await import('../src/pages/erase-request-verify')) as unknown as Mod
}

/** A request the owner has not confirmed yet: no due time, a 24-hour link. */
const AWAITING = {
  id: '6f1c2b8e-0000-4000-8000-000000000003',
  requested_at: '2026-10-18T10:00:00Z',
  due_at: null,
  item_count: 1240,
  cancellable: true,
  verified: false,
  verify_expires_at: '2026-10-19T10:00:00Z',
}

/** Confirmed at 2026-10-18T12:00Z: due 72 h later. */
const CONFIRMED = {
  ...AWAITING,
  due_at: '2026-10-21T12:00:00Z',
  verified: true,
  verify_expires_at: null,
}

function status(over: Record<string, unknown> = {}): EraseStatus {
  return {
    request: null,
    live_items: 1240,
    cooldown_hours: 72,
    trash_retention_days: 30,
    last_executed: null,
    last_expired: null,
    ...over,
  } as unknown as EraseStatus
}

function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function renderCard(over: Partial<EraseRequestCardProps> = {}): string {
  const props: EraseRequestCardProps = {
    card: eraseCard(status()),
    loadError: '',
    email: 'owner@example.org',
    cooldownHours: 72,
    retentionDays: 30,
    typed: '',
    onTypedChange: () => {},
    onRequest: () => {},
    onCancel: () => {},
    onRetryLoad: () => {},
    busy: false,
    note: '',
    error: '',
    ...over,
  }
  return decode(renderToStaticMarkup(React.createElement(EraseRequestCard, props)))
}

/** The whole `<button …>…</button>` element carrying `data-testid="<id>"` ('' when absent). */
function buttonTag(html: string, id: string): string {
  const at = html.indexOf(`data-testid="${id}"`)
  if (at < 0) return ''
  const start = html.lastIndexOf('<button', at)
  return html.slice(start, html.indexOf('</button>', at) + '</button>'.length)
}

// ── 1. parsing ──────────────────────────────────────────────────────────────

describe('the status carries the confirmation', () => {
  test('an unconfirmed request parses: no due time, verified false, the link deadline kept', () => {
    const parsed = parseEraseStatus(status({ request: AWAITING }))
    expect(parsed?.request).toEqual(AWAITING as never)
  })

  test('a confirmed request parses with its due time', () => {
    const parsed = parseEraseStatus(status({ request: CONFIRMED }))
    expect(parsed?.request).toEqual(CONFIRMED as never)
  })

  test('a due time without a confirmation, or a confirmation without one, is refused', () => {
    expect(parseEraseStatus(status({ request: { ...AWAITING, due_at: '2026-10-21T12:00:00Z' } }))).toBeNull()
    expect(parseEraseStatus(status({ request: { ...CONFIRMED, due_at: null } }))).toBeNull()
  })

  test('the last lapsed request is read', () => {
    const parsed = parseEraseStatus(status({ last_expired: { id: AWAITING.id, expired_at: '2026-10-19T10:00:00Z' } }))
    expect((parsed as unknown as Mod)?.last_expired).toEqual({ id: AWAITING.id, expired_at: '2026-10-19T10:00:00Z' })
  })
})

// ── 2. the three states of the locked screen ───────────────────────────────

describe('the locked screen: check your email, then the due time, or the link expired', () => {
  test('unconfirmed: awaiting, even though it is cancellable', () => {
    expect(eraseCard(status({ request: AWAITING })).kind as string).toBe('awaiting')
  })

  test('awaiting: "check your email to confirm", the link deadline, Cancel, and no due time', () => {
    const html = renderCard({ card: eraseCard(status({ request: AWAITING })) })
    expect(html).toContain('data-testid="erase-awaiting"')
    expect(html).toContain('Check your email to confirm')
    expect(html).toContain('owner@example.org')
    expect(html).toContain('Nothing happens unless you confirm')
    expect(html).toContain(formatDue(AWAITING.verify_expires_at))
    expect(buttonTag(html, 'erase-cancel-button')).toContain('Cancel the request')
    expect(html).not.toContain('data-testid="erase-pending"')
    expect(html).not.toContain('Erase confirmed')
  })

  test('confirmed: the due time counted from the confirmation, and Cancel', () => {
    const html = renderCard({ card: eraseCard(status({ request: CONFIRMED })) })
    expect(html).toContain('data-testid="erase-pending"')
    expect(html).toContain('Erase confirmed.')
    expect(html).toContain(formatDue(CONFIRMED.due_at))
    expect(buttonTag(html, 'erase-cancel-button')).toContain('Cancel the erase')
    expect(html).not.toContain('Check your email to confirm')
  })

  test('lapsed: the ask card says the confirmation link expired and nothing moved', () => {
    const expiredAt = '2026-10-19T10:00:00Z'
    const card = eraseCard(status({ last_expired: { id: AWAITING.id, expired_at: expiredAt } }))
    expect(card).toEqual({ kind: 'ask', liveItems: 1240, expiredAt } as never)
    const html = renderCard({ card })
    expect(html).toContain('data-testid="erase-expired"')
    expect(html).toContain('The confirmation link of your last request expired')
    expect(html).toContain(formatDue(expiredAt))
    expect(html).toContain('nothing moved')
    expect(buttonTag(html, 'erase-request-button')).toContain('Request erase')
  })

  test('without a lapse the ask card has no expired note, and it says nothing moves without the email click', () => {
    const html = renderCard()
    expect(html).not.toContain('data-testid="erase-expired"')
    expect(html).toContain('Nothing happens unless you confirm by email')
  })

  test('the password step says the email confirmation comes next, not that the 72 hours start now', () => {
    const screen = readFileSync(path.join(SRC, 'components/vault-locked-no-key.tsx'), 'utf8')
    expect(screen).toContain('We then email you a link to confirm it: nothing moves unless you do')
    expect(screen).not.toContain('Nothing moves for ${eraseStatus?.cooldown_hours ?? 72} hours, and we email you a link to cancel')
  })
})

// ── 3. looking again ────────────────────────────────────────────────────────

describe('the screen looks again while it waits for the email click', () => {
  test('awaiting: a 60 s poll and a timer just after the link expires', async () => {
    const m = await lib()
    const card = eraseCard(status({ request: AWAITING }))
    const now = Date.parse('2026-10-19T09:00:00Z')
    expect((m.eraseRefreshPlan as Fn)(card, now)).toEqual({ pollMs: 60_000, dueInMs: 3_600_000 + 1_000 })
  })
})

// ── 4. verifyByLink ────────────────────────────────────────────────────────

function answer(statusCode: number, body: unknown = {}): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: statusCode })) as unknown as typeof fetch
}

describe('verifyByLink(): token in the body, no credentials, every answer mapped', () => {
  test('POSTs the token in the body, never the URL, with no cookies', async () => {
    const m = await link()
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(
        JSON.stringify({ verified: true, already: false, request: CONFIRMED, cancel_token: TOKEN2, trash_retention_days: 30 }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const out = await (m.verifyByLink as Fn)(TOKEN, { fetchImpl, apiUrl: 'https://api.example' })
    // Round 4: `confirmationEmailSent` carries the server's `confirmation_email_sent` (absent here: null).
    expect(out).toEqual({
      kind: 'verified',
      dueAt: CONFIRMED.due_at,
      itemCount: 1240,
      retentionDays: 30,
      cancelToken: TOKEN2,
      confirmationEmailSent: null,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.example/api/v1/account/erase-request/verify-by-token')
    expect(calls[0].url).not.toContain(TOKEN)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.credentials).toBe('omit')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ token: TOKEN })
  })

  test('a second click: "already", with the due time, and no cancel token', async () => {
    const m = await link()
    const out = await (m.verifyByLink as Fn)(TOKEN, {
      fetchImpl: answer(200, { verified: true, already: true, request: CONFIRMED, trash_retention_days: 30 }),
      apiUrl: 'x',
    })
    expect(out).toEqual({ kind: 'already', dueAt: CONFIRMED.due_at, itemCount: 1240, retentionDays: 30 })
  })

  test('410 is "expired", 404 is "invalid", 429 and failures are "try again"', async () => {
    const m = await link()
    const v = m.verifyByLink as Fn
    expect(await v(TOKEN, { fetchImpl: answer(410, { error: 'erase_verify_expired' }), apiUrl: 'x' })).toEqual({ kind: 'expired' })
    expect(await v(TOKEN, { fetchImpl: answer(404), apiUrl: 'x' })).toEqual({ kind: 'invalid' })
    expect(await v(TOKEN, { fetchImpl: answer(429), apiUrl: 'x' })).toEqual({ kind: 'unavailable', rateLimited: true })
    expect(await v(TOKEN, { fetchImpl: answer(500), apiUrl: 'x' })).toEqual({ kind: 'unavailable', rateLimited: false })
    const down = (async () => {
      throw new TypeError('offline')
    }) as unknown as typeof fetch
    expect(await v(TOKEN, { fetchImpl: down, apiUrl: 'x' })).toEqual({ kind: 'unavailable', rateLimited: false })
  })

  test('a 200 we cannot read is not claimed as confirmed', async () => {
    const m = await link()
    const v = m.verifyByLink as Fn
    const garbled = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch
    expect(await v(TOKEN, { fetchImpl: garbled, apiUrl: 'x' })).toEqual({ kind: 'unavailable', rateLimited: false })
    expect(await v(TOKEN, { fetchImpl: answer(200, { verified: true, already: false, request: AWAITING }), apiUrl: 'x' })).toEqual({
      kind: 'unavailable',
      rateLimited: false,
    })
  })

  test('a malformed token never reaches the network', async () => {
    const m = await link()
    let called = 0
    const fetchImpl = (async () => {
      called++
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await (m.verifyByLink as Fn)('short', { fetchImpl, apiUrl: 'x' })).toEqual({ kind: 'invalid' })
    expect(called).toBe(0)
  })
})

// ── 5. the confirmation page ────────────────────────────────────────────────

async function renderVerify(view: Record<string, unknown>): Promise<string> {
  const m = await page()
  const View = m.EraseVerifyView as React.FC<{ view: unknown; onConfirm: () => void; onCancel: () => void }>
  return decode(renderToStaticMarkup(React.createElement(View, { view, onConfirm: () => {}, onCancel: () => {} })))
}

describe('the confirmation page says what happens and waits for a click', () => {
  test('ready: what confirming does, the 24-hour lapse, and one Confirm button', async () => {
    const html = await renderVerify({ kind: 'ready' })
    expect(html).toContain('Confirm: erase all files?')
    expect(html).toContain('Nothing happens unless you confirm here')
    expect(html).toContain('72-hour wait')
    expect(html).toContain('lapses after 24 hours')
    expect(html).toContain('moves to the trash')
    expect(buttonTag(html, 'erase-verify-confirm')).toContain('Confirm the erase')
    expect(buttonTag(html, 'erase-verify-confirm')).not.toContain('disabled')
  })

  test('the page never confirms on load: verifyByLink is called from the click handler only', () => {
    const src = readFileSync(path.join(SRC, 'pages/erase-request-verify.tsx'), 'utf8')
    const effects = [...src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)].map((m) => m[1])
    expect(effects.length).toBeGreaterThan(0)
    for (const body of effects) {
      expect(body).not.toContain('verifyByLink')
      expect(body).not.toContain('confirm(')
    }
    // The single call site is inside `confirm`, which only `onConfirm` (the button) reaches.
    expect(src.match(/verifyByLink\(/g)).toHaveLength(1)
    expect(src).toContain('onConfirm={() => void confirm()}')
  })

  test('verified: the due time, the retention, and a Cancel button', async () => {
    const html = await renderVerify({
      kind: 'verified',
      dueAt: CONFIRMED.due_at,
      itemCount: 1240,
      retentionDays: 30,
      cancelToken: TOKEN2,
      cancel: 'idle',
    })
    expect(html).toContain('Erase confirmed')
    expect(html).toContain(formatDue(CONFIRMED.due_at))
    expect(html).toContain('1240 items')
    expect(html).toContain('for 30 days')
    expect(buttonTag(html, 'erase-verify-cancel')).toContain('Cancel the erase')
  })

  test('verified, the cancel failed: the reason shows and the button stays', async () => {
    const html = await renderVerify({
      kind: 'verified',
      dueAt: CONFIRMED.due_at,
      itemCount: 1240,
      retentionDays: 30,
      cancelToken: TOKEN2,
      cancel: 'unavailable',
    })
    expect(html).toContain('data-testid="erase-verify-cancel-error"')
    expect(html).toContain("we can't tell whether it was cancelled")
    expect(buttonTag(html, 'erase-verify-cancel')).toContain('Cancel the erase')
  })

  test('already: nothing changed, the due time, and where to cancel', async () => {
    const html = await renderVerify({ kind: 'already', dueAt: CONFIRMED.due_at, itemCount: 1240, retentionDays: 30 })
    expect(html).toContain('Already confirmed')
    expect(html).toContain('nothing changed now')
    expect(html).toContain(formatDue(CONFIRMED.due_at))
  })

  test('expired: the link expired, nothing moved and nothing will', async () => {
    const html = await renderVerify({ kind: 'expired' })
    expect(html).toContain('The confirmation link expired')
    expect(html).toContain('nothing was moved, and nothing will be')
    expect(html).not.toContain('data-testid="erase-verify-confirm"')
  })

  test('invalid and unavailable say different things; only unavailable offers a retry', async () => {
    const invalid = await renderVerify({ kind: 'invalid' })
    expect(invalid).toContain('This link does not work any more')
    expect(invalid).not.toContain('Try again')
    const down = await renderVerify({ kind: 'unavailable', rateLimited: false })
    expect(down).toContain("we can't tell whether it was confirmed")
    expect(down).toContain('Try again')
  })

  test('cancelled from the page: nothing will move', async () => {
    const html = await renderVerify({ kind: 'cancelled' })
    expect(html).toContain('Erase cancelled')
    expect(html).toContain('Nothing will be moved to the trash')
  })
})

// ── 6. routing ──────────────────────────────────────────────────────────────

function localImportClosure(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  const resolve = (from: string, spec: string): string | null => {
    const base = path.resolve(path.dirname(from), spec)
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
      if (existsSync(cand) && /\.(ts|tsx)$/.test(cand)) return cand
    }
    return null
  }
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const next = resolve(file, m[1])
      if (next) queue.push(next)
    }
  }
  return [...seen].map((f) => path.relative(SRC, f))
}

describe('the confirmation page is vault-free and public', () => {
  test('vault-free on the exact path only', () => {
    expect(isVaultFreePath('/erase-request/verify')).toBe(true)
    expect(isVaultFreePath('/erase-request/verify/')).toBe(true)
    expect(isVaultFreePath('/erase-request/verify/extra')).toBe(false)
  })

  test('routed in the vault-free pages and listed as public', () => {
    const app = readFileSync(path.join(SRC, 'app.tsx'), 'utf8')
    expect(app).toContain('<Route path="/erase-request/verify" element={<EraseRequestVerifyPage />} />')
    expect(app).toContain("/^\\/erase-request\\/verify(\\/|$)/")
  })

  test('its imports never reach the credentialed client or the crypto stack', () => {
    const file = path.join(SRC, 'pages/erase-request-verify.tsx')
    expect(existsSync(file)).toBe(true)
    const closure = localImportClosure(file)
    expect(closure).toContain('lib/erase-request-link.ts')
    for (const banned of ['lib/api.ts', 'components/auth-shell.tsx', 'lib/key-context.tsx', 'lib/crypto.ts']) {
      expect(closure).not.toContain(banned)
    }
  })
})
