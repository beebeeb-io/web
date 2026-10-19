/**
 * Task 1918 round 4 — the web half of the /code-review findings on web#174 (round 3 head eebd97e)
 * plus "restore everything from the erase" (server#232 round 4).
 *
 *  1. [P1] the cancel-link page cancels only on ONE click, never on load (mail scanners run pages);
 *  2. the erase request is POSTed exactly once: no retry with the spent step-up token, after a
 *     network failure or on a 429; the 429's daily-cap message is shown; an unknown outcome says
 *     "we couldn't confirm whether it was scheduled" and asks the server;
 *  3. a reload after the link's token was read says "Open the link from your email again", on both
 *     link pages; the token is stored nowhere;
 *  4. honest copy: cancelling works on the locked screen, with the email link, or in Beebeeb on the
 *     web (a pending-erase banner with Cancel in the unlocked app); never "any device". A 404 on
 *     cancel reads the status again and says what is true (it may have run). The confirmation page
 *     promises no email the server did not send;
 *  5. "Restore everything from the erase on <date>": on the locked screen, in Trash and on the
 *     empty drive, with progress while the server restores in batches;
 *  6. outcomes are announced (one `role="status"` live region), the result takes the focus, and
 *     every error line is `role="alert"`;
 *  7. a status read never overwrites a newer action's state; "Check again" stays until the request
 *     shows up or a follow-up read ran;
 *  8. the typed number accepts real thousands grouping only.
 *
 * New modules and exports are imported dynamically, so on eebd97e each test fails on its own.
 *
 * Round 4d (web#174 review, finding 5): the tests of the restore block's polling and the banner's
 * cancel drive their controllers now; the placement test stays a source check (the locked screen,
 * Trash and the drive cannot be rendered with effects here).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { EraseRequestCard, type EraseRequestCardProps } from '../src/components/erase-request-card'
import { eraseCard, parseEraseStatus, type EraseStatus } from '../src/lib/erase-request'
import { apiError as fakeApiError, flush, manualTimers } from './helpers/erase-request-fakes'

const SRC = path.resolve(import.meta.dir, '../src')
const TOKEN = 'Qm9vbS1ib29tLWJvb20tYm9vbS1ib29tLWJvb20tYm9v'
const REQ = '6f1c2b8e-0000-4000-8000-000000000004'

type Mod = Record<string, unknown>
type Fn = (...args: unknown[]) => unknown
const lib = async () => (await import('../src/lib/erase-request')) as unknown as Mod
const link = async () => (await import('../src/lib/erase-request-link')) as unknown as Mod
const transport = async () => (await import('../src/lib/erase-request-transport')) as unknown as Mod
const restoreMod = async () => (await import('../src/components/restore-from-erase')) as unknown as Mod
const bannerMod = async () => (await import('../src/components/erase-request-banner')) as unknown as Mod
const restoreCtl = async () => (await import('../src/lib/restore-controller')) as unknown as Mod
const bannerCtl = async () => (await import('../src/lib/erase-banner-controller')) as unknown as Mod
const cancelPage = async () => (await import('../src/pages/erase-request-cancel')) as unknown as Mod
const verifyPage = async () => (await import('../src/pages/erase-request-verify')) as unknown as Mod

const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

const PENDING = {
  id: REQ,
  requested_at: '2026-10-18T10:00:00Z',
  due_at: '2026-10-21T12:00:00Z',
  item_count: 1240,
  cancellable: true,
  verified: true,
  verify_expires_at: null,
}
const AWAITING = { ...PENDING, due_at: null, verified: false, verify_expires_at: '2026-10-19T10:00:00Z' }

const EXECUTED = {
  id: REQ,
  executed_at: '2026-10-18T12:00:00Z',
  items_trashed: 150,
  trashed_at: '2026-10-18T11:59:00Z',
  restorable_until: '2026-11-17T11:59:00Z',
  in_trash: 150,
  restore: null,
}

function status(over: Record<string, unknown> = {}): EraseStatus {
  return {
    request: null,
    live_items: 0,
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
    card: eraseCard(status({ live_items: 1240 })),
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

/** The `<tag …>` opening tag of the element carrying `data-testid="<id>"` ('' when absent). */
function openTag(html: string, id: string): string {
  const at = html.indexOf(`data-testid="${id}"`)
  if (at < 0) return ''
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

/** Bodies of every `useEffect(() => { … }, [` in a source file. */
function effectBodies(src: string): string[] {
  return [...src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)].map((m) => m[1])
}

function apiError(statusCode: number, code: string, message = '') {
  return Object.assign(new Error(message || code), { status: statusCode, code, message: message || code })
}

// ── 1. the cancel link waits for a click ───────────────────────────────────────────────────

describe('1. the cancel-link page cancels only on one click', () => {
  test('opened with a token it shows "Cancel the erase?" and a button, not a cancel in progress', async () => {
    const m = await cancelPage()
    const Page = m.EraseRequestCancelPage as React.FC
    const html = decode(
      renderToStaticMarkup(
        React.createElement(MemoryRouter, { initialEntries: [`/erase-request/cancel#t=${TOKEN}`] }, React.createElement(Page)),
      ),
    )
    expect(html).toContain('Cancel the erase?')
    expect(openTag(html, 'erase-link-cancel')).toContain('<button')
    expect(html).not.toContain('erase-link-working')
    expect(html).not.toContain('One moment')
  })

  test('nothing on load calls the cancel: cancelByLink only from the click handler', () => {
    const src = read('pages/erase-request-cancel.tsx')
    const effects = effectBodies(src)
    expect(effects.length).toBeGreaterThan(0)
    for (const body of effects) {
      expect(body).not.toContain('cancelByLink')
      expect(body).not.toMatch(/\b(run|cancel)\(\)/)
    }
    expect(src.match(/cancelByLink\(/g)).toHaveLength(1)
    expect(src).toContain('onCancel={() => void cancel()}')
  })
})

// ── 2. one POST, never re-sent ─────────────────────────────────────────────────────────────

describe('2. the erase request is POSTed exactly once', () => {
  async function post(fetchImpl: typeof fetch) {
    const m = await transport()
    return (m.postEraseRequestOnce as Fn)(1240, 'step-up-token', {
      fetchImpl,
      apiUrl: 'https://api.example',
      token: null,
      extraHeaders: {},
    }) as Promise<unknown>
  }

  test('a network failure: one attempt, an ApiError with status 0 (unknown outcome), no retry', async () => {
    let calls = 0
    const down = (async () => {
      calls++
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const err = (await post(down).catch((e) => e)) as { status?: number }
    expect(calls).toBe(1)
    expect(err.status).toBe(0)
  })

  test('a 429 with a short Retry-After: one attempt, the server words come through', async () => {
    let calls = 0
    const capped = (async () => {
      calls++
      return new Response(
        JSON.stringify({ error: 'erase_request_rate_limited', message: "You asked to erase this account's files 3 times in the last 24 hours. Try again later." }),
        { status: 429, headers: { 'Retry-After': '5' } },
      )
    }) as unknown as typeof fetch
    const err = (await post(capped).catch((e) => e)) as { status?: number; code?: string; message?: string }
    expect(calls).toBe(1)
    expect(err.status).toBe(429)
    expect(err.code).toBe('erase_request_rate_limited')
    expect(err.message).toContain('3 times in the last 24 hours')
  })

  test('the step-up token, the count, cookies: the same request, sent once', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const ok = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return new Response(JSON.stringify({ request: AWAITING, created: true }), { status: 201 })
    }) as unknown as typeof fetch
    expect(await post(ok)).toEqual({ request: AWAITING, created: true })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://api.example/api/v1/account/erase-request')
    expect(seen[0].init.method).toBe('POST')
    expect(seen[0].init.credentials).toBe('include')
    expect((seen[0].init.headers as Record<string, string>)['X-Confirm-Token']).toBe('step-up-token')
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ confirm_count: 1240 })
  })

  test('createEraseRequest goes through the single-shot transport, not the retrying client', () => {
    const api = read('lib/api.ts')
    const start = api.indexOf('export async function createEraseRequest(')
    const body = api.slice(start, api.indexOf('\n}\n', start))
    expect(body).toContain('postEraseRequestOnce(')
    expect(body).not.toContain('request<')
  })

  test('requestErase: the 429 cap is shown in the server words; an unknown outcome never says "not scheduled"', async () => {
    const m = await lib()
    const requestErase = m.requestErase as Fn
    const capMsg = "You asked to erase this account's files 3 times in the last 24 hours. Try again later."
    const capped = await requestErase(
      { create: async () => Promise.reject(apiError(429, 'erase_request_rate_limited', capMsg)), cancel: async () => ({}), status: async () => status() },
      1240,
      't',
    )
    expect(capped).toEqual({ kind: 'refused', message: capMsg })
    const lost = (await requestErase(
      { create: async () => Promise.reject(apiError(0, '')), cancel: async () => ({}), status: async () => status({ live_items: 1240 }) },
      1240,
      't',
    )) as { kind: string; message: string }
    expect(lost.kind).toBe('unknown')
    expect(lost.message).toContain("We couldn't confirm whether it was scheduled")
    expect(lost.message).not.toMatch(/nothing was scheduled|not scheduled/i)
  })

  test('409 erase_request_in_progress is an unknown outcome to check again, not a refusal', async () => {
    const m = await lib()
    const out = (await (m.requestErase as Fn)(
      { create: async () => Promise.reject(apiError(409, 'erase_request_in_progress', 'Check again in a minute.')), cancel: async () => ({}), status: async () => status() },
      1240,
      't',
    )) as { kind: string }
    expect(out.kind).toBe('in_progress')
    const screen = read('components/vault-locked-no-key.tsx')
    expect(screen).toContain("outcome.kind === 'unknown' || outcome.kind === 'in_progress'")
  })
})

// ── 3. a reload after the token was read ───────────────────────────────────────────────────

describe('3. no token in the address: "Open the link from your email again"', () => {
  async function renderAt(mod: () => Promise<Mod>, name: string, url: string) {
    const m = await mod()
    const Page = m[name] as React.FC
    return decode(renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, React.createElement(Page))))
  }

  test('the cancel page asks to reopen the link and claims nothing about the request', async () => {
    const html = await renderAt(cancelPage, 'EraseRequestCancelPage', '/erase-request/cancel')
    expect(html).toContain('Open the link from your email again')
    expect(html).toContain('data-testid="erase-link-reopen"')
    expect(html).not.toMatch(/already used|time to cancel has passed|cancelled|has started|lapsed/i)
  })

  test('the confirmation page asks to reopen the link and claims nothing about the request', async () => {
    const html = await renderAt(verifyPage, 'EraseRequestVerifyPage', '/erase-request/verify')
    expect(html).toContain('Open the link from your email again')
    expect(html).toContain('data-testid="erase-verify-reopen"')
    expect(html).not.toContain('data-testid="erase-verify-invalid"')
    expect(html).not.toMatch(/was cancelled or has already run/i)
  })

  test('the token is kept nowhere but in memory', () => {
    for (const rel of ['pages/erase-request-cancel.tsx', 'pages/erase-request-verify.tsx', 'lib/erase-request-link.ts']) {
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(`${rel}: ${/localStorage|sessionStorage|indexedDB|pushState|history\.replaceState|document\.cookie/.test(code)}`).toBe(`${rel}: false`)
    }
  })
})

// ── 4. honest copy ─────────────────────────────────────────────────────────────────────────

describe('4a. cancelling works where the copy says: here, the email link, or Beebeeb on the web', () => {
  test('no surface promises "any device"', () => {
    for (const rel of [
      'components/erase-request-card.tsx',
      'components/erase-request-banner.tsx',
      'pages/erase-request-verify.tsx',
      'pages/erase-request-cancel.tsx',
      'components/vault-locked-no-key.tsx',
    ]) {
      expect(existsSync(path.join(SRC, rel))).toBe(true)
      // The copy, not the comments (a comment may state the rule).
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(`${rel}: ${/any (signed-in )?device|on any device/i.test(code)}`).toBe(`${rel}: false`)
    }
  })

  test('the confirmed card names the three places', () => {
    const html = renderCard({ card: eraseCard(status({ request: PENDING })), nowMs: Date.parse('2026-10-19T00:00:00Z') } as never)
    expect(html).toContain("here, with the link in the email, or in Beebeeb on the web while you're signed in")
  })

  test('the unlocked app shows a pending erase with Cancel (awaiting, confirmed, past due, moving)', async () => {
    const m = await bannerMod()
    const View = m.EraseRequestBannerView as React.FC<Record<string, unknown>>
    const draw = (card: unknown, nowMs = Date.parse('2026-10-19T00:00:00Z')) =>
      decode(renderToStaticMarkup(React.createElement(View, { card, busy: false, note: '', error: '', onCancel: () => {}, nowMs })))
    const awaiting = draw(eraseCard(status({ request: AWAITING })))
    expect(awaiting).toContain('Nothing happens unless you confirm it')
    expect(awaiting).toContain('Cancel the request')
    const pending = draw(eraseCard(status({ request: PENDING })))
    expect(pending).toContain('moves to the trash on')
    expect(pending).toContain('Cancel the erase')
    const pastDue = draw(eraseCard(status({ request: PENDING })), Date.parse('2026-10-22T00:00:00Z'))
    expect(pastDue).toContain('moves to the trash shortly')
    expect(pastDue).toContain('Cancel the erase')
    const moving = draw(eraseCard(status({ request: { ...PENDING, cancellable: false } })))
    expect(moving).toContain('moving to the trash now')
    expect(moving).not.toContain('data-testid="erase-banner-cancel"')
    expect(draw(null)).toBe('')
  })

  test('the banner is mounted in the unlocked app shell', () => {
    const layout = read('components/drive-layout.tsx')
    expect(layout).toContain("import { EraseRequestBanner } from './erase-request-banner'")
    expect(layout).toContain('<EraseRequestBanner />')
  })
})

describe('4a. a confirmed request past its due time stays cancellable until the move starts', () => {
  test('the card says the move starts shortly, nothing moved yet, and offers Cancel', () => {
    const html = renderCard({ card: eraseCard(status({ request: PENDING })), nowMs: Date.parse('2026-10-22T00:00:00Z') } as never)
    expect(html).toContain('data-testid="erase-past-due"')
    expect(html).toContain('moves to the trash shortly. Nothing has moved yet.')
    expect(html).toContain('data-testid="erase-cancel-button"')
  })
})

describe('4b. a cancel that finds nothing says what the server holds now', () => {
  const deps = (st: () => Promise<unknown>) => ({
    create: async () => ({}),
    cancel: async () => Promise.reject(apiError(404, 'no_pending_erase_request')),
    status: st,
  })

  test('404 and the request already ran: "it had already run", never "nothing will be moved"', async () => {
    const m = await lib()
    const out = (await (m.cancelErase as Fn)(deps(async () => status({ last_executed: EXECUTED })), REQ)) as { kind: string; status?: unknown }
    expect(out.kind).toBe('already_executed')
    const note = (m.cancelNote as Fn)(out) as string
    expect(note).toContain('It had already run')
    expect(note).not.toContain('Nothing will be moved')
  })

  test('404 and nothing pending, nothing ran: nothing_pending with the fresh status', async () => {
    const m = await lib()
    const fresh = status({ live_items: 1240 })
    const out = (await (m.cancelErase as Fn)(deps(async () => fresh), REQ)) as { kind: string; status?: unknown }
    expect(out.kind).toBe('nothing_pending')
    expect(out.status).toEqual(fresh)
  })

  test('404 and the status cannot be read: unknown, no claim', async () => {
    const m = await lib()
    const out = (await (m.cancelErase as Fn)(deps(async () => Promise.reject(new TypeError('offline'))), REQ)) as { kind: string; message: string }
    expect(out.kind).toBe('unknown')
    expect(out.message).not.toMatch(/nothing will be moved/i)
  })

  test('the locked screen and the banner apply the fresh status and pass the shown request id', async () => {
    // the banner cancels the request it shows: a 404 whose fresh status shows THAT request ran
    // says it ran (which needs the id)
    const b = await bannerCtl()
    const ran = status({ last_executed: EXECUTED })
    let answer = status({ request: PENDING })
    const banner = (b.createBannerController as Fn)({
      cache: { read: async () => answer, invalidate: () => {}, subscribe: () => () => {} },
      key: 'u1',
      deps: { create: async () => ({}), cancel: async () => Promise.reject(fakeApiError(404, 'no_pending_erase_request')), status: async () => ran },
      win: new EventTarget(),
      doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
      timers: manualTimers().hooks,
    }) as { attach(): void; cancel(): Promise<void>; getState(): { note: string; card: unknown } }
    banner.attach()
    await flush()
    answer = ran
    await banner.cancel()
    expect(banner.getState().note).toContain('It had already run')
    expect(banner.getState().card).toBeNull()
    // Source check (no DOM): the locked screen passes the shown id and applies the fresh status.
    const screen = read('components/vault-locked-no-key.tsx')
    expect(screen).toContain('cancelErase(ERASE_DEPS, shownId)')
    expect(screen).toContain('setEraseStatus(outcome.status)')
  })
})

describe('4c. the confirmation page promises no email the server did not send', () => {
  test('verifyByLink carries confirmation_email_sent', async () => {
    const m = await link()
    const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
    const base = { verified: true, already: false, request: PENDING, cancel_token: TOKEN, trash_retention_days: 30 }
    const notSent = (await (m.verifyByLink as Fn)(TOKEN, { fetchImpl: answer({ ...base, confirmation_email_sent: false }), apiUrl: 'x' })) as Mod
    expect(notSent.confirmationEmailSent).toBe(false)
    const sent = (await (m.verifyByLink as Fn)(TOKEN, { fetchImpl: answer({ ...base, confirmation_email_sent: true }), apiUrl: 'x' })) as Mod
    expect(sent.confirmationEmailSent).toBe(true)
  })

  test('not sent: the page says so and points at the first email and the signed-in places', async () => {
    const m = await verifyPage()
    const View = m.EraseVerifyView as React.FC<Record<string, unknown>>
    const view = { kind: 'verified', dueAt: PENDING.due_at, itemCount: 1240, retentionDays: 30, cancelToken: TOKEN, confirmationEmailSent: false, cancel: 'idle' }
    const html = decode(renderToStaticMarkup(React.createElement(View, { view, onConfirm: () => {}, onCancel: () => {} })))
    expect(html).toContain('We could not send the confirmation email')
    expect(html).not.toContain('the email we just sent')
    const sent = decode(
      renderToStaticMarkup(React.createElement(View, { view: { ...view, confirmationEmailSent: true }, onConfirm: () => {}, onCancel: () => {} })),
    )
    expect(sent).toContain('the email we just sent')
  })
})

// ── 5. restore everything from the erase ───────────────────────────────────────────────────

describe('5. "Restore everything from the erase on <date>"', () => {
  test('the status carries the trash time, what is left in the trash and the restore', () => {
    const parsed = parseEraseStatus(
      status({ last_executed: { ...EXECUTED, in_trash: 110, restore: { state: 'running', requested_at: '2026-10-19T08:00:00Z', rows_restored: 40, finished_at: null } } }),
    )
    expect(parsed?.last_executed).toEqual({
      ...EXECUTED,
      in_trash: 110,
      restore: { state: 'running', requested_at: '2026-10-19T08:00:00Z', rows_restored: 40, finished_at: null },
    } as never)
  })

  test('the offer: something in the trash → offer; a restore running → running; all back → done; old server → none', async () => {
    const m = await lib()
    const offer = m.restoreOffer as Fn
    expect(offer(EXECUTED)).toBe('offer')
    expect(offer({ ...EXECUTED, in_trash: 110, restore: { state: 'running', requested_at: null, rows_restored: 40, finished_at: null } })).toBe('running')
    expect(offer({ ...EXECUTED, in_trash: 0, restore: { state: 'done', requested_at: null, rows_restored: 150, finished_at: 'x' } })).toBe('done')
    expect(offer({ ...EXECUTED, in_trash: 0 })).toBe('none')
    expect(offer({ ...EXECUTED, in_trash: null })).toBe('none')
    expect(offer(null)).toBe('none')
  })

  test('the label names the day of the erase', async () => {
    const m = await lib()
    expect((m.restoreLabel as Fn)(EXECUTED)).toBe('Restore everything from the erase on Sunday 18 October 2026')
  })

  test('restoreEverything: 200 done, 202 running, 404/409 refused, a lost answer asks the server', async () => {
    const m = await lib()
    const run = m.restoreEverything as Fn
    const ok = (body: unknown) => ({ restore: async () => body, status: async () => status() })
    expect(await run(ok({ restore: { state: 'done', rows_restored: 150 }, in_trash: 0 }), REQ)).toEqual({ kind: 'done', rowsRestored: 150 })
    expect(await run(ok({ restore: { state: 'running', rows_restored: 50 }, in_trash: 100 }), REQ)).toEqual({ kind: 'running', rowsRestored: 50, inTrash: 100 })
    const refused = (code: string, s: number) => ({ restore: async () => Promise.reject(apiError(s, code)), status: async () => status() })
    expect(((await run(refused('erase_request_not_found', 404), REQ)) as Mod).kind).toBe('refused')
    expect(((await run(refused('erase_not_finished', 409), REQ)) as Mod).message).toContain('still running')
    const lostButRunning = {
      restore: async () => Promise.reject(apiError(0, '')),
      status: async () =>
        status({ last_executed: { ...EXECUTED, in_trash: 100, restore: { state: 'running', requested_at: null, rows_restored: 50, finished_at: null } } }),
    }
    expect(await run(lostButRunning, REQ)).toEqual({ kind: 'running', rowsRestored: 50, inTrash: 100 })
    const lost = { restore: async () => Promise.reject(apiError(0, '')), status: async () => Promise.reject(new TypeError('x')) }
    expect(((await run(lost, REQ)) as Mod).kind).toBe('unknown')
  })

  test('the block: the button, the progress ("40 restored, 110 still in the trash"), the done line', async () => {
    const m = await restoreMod()
    const View = m.RestoreFromEraseView as React.FC<Record<string, unknown>>
    const draw = (p: Record<string, unknown>) =>
      decode(renderToStaticMarkup(React.createElement(View, { executed: EXECUTED, busy: false, rowsRestored: 0, inTrash: 150, error: '', onRestore: () => {}, ...p })))
    const offer = draw({ offer: 'offer' })
    expect(openTag(offer, 'erase-restore-button')).toContain('<button')
    expect(offer).toContain('Restore everything from the erase on Sunday 18 October 2026')
    const running = draw({ offer: 'running', rowsRestored: 40, inTrash: 110 })
    expect(running).toContain('40 restored, 110 still in the trash')
    expect(running).not.toContain('data-testid="erase-restore-button"')
    // Round 4b: counts, never "everything is back" (items may have been deleted for good one by one).
    expect(draw({ offer: 'done', inTrash: 0 })).toContain('Nothing from this erase is left in the trash.')
    expect(draw({ offer: 'none' })).toBe('')
  })

  test('it polls every 5 s while a restore runs', async () => {
    const m = await lib()
    expect(m.RESTORE_POLL_MS).toBe(5_000)
    const r = await restoreCtl()
    const timers = manualTimers()
    let reads = 0
    const ctl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: {
        restore: async () => ({ restore: { state: 'running', rows_restored: 40 }, in_trash: 110 }),
        status: async () => {
          reads++
          return status({ last_executed: { ...EXECUTED, in_trash: 60, restore: { state: 'running', requested_at: null, rows_restored: 90, finished_at: null } } })
        },
      },
      timers,
    }) as { start(): Promise<void>; getState(): { view: string; shown: { in_trash: number } } }
    expect(timers.intervals()).toEqual([])
    await ctl.start()
    expect(ctl.getState().view).toBe('running')
    expect(timers.intervals()).toEqual([5_000])
    timers.tickIntervals()
    await flush()
    expect(reads).toBe(1)
    expect(ctl.getState().shown.in_trash).toBe(60)
  })
  // Source check (no DOM): placement inside the locked screen, Trash and the drive.
  test('it is drawn where the owner looks: the locked screen, Trash, the empty drive', () => {
    const screen = read('components/vault-locked-no-key.tsx')
    expect(screen).toMatch(/<RestoreFromErase\s+key=\{slotExecuted\.id\}\s+executed=\{slotExecuted\}\s+gate=\{eraseGate\.current\}\s+onStatus=\{applyRestoreStatus\}\s+onDone=\{reloadAfterRestore\}/)
    expect(screen).toContain('restore={restoreSlot}')
    expect(read('pages/trash.tsx')).toContain('<RestoreFromEraseOffer className="px-5 pt-3" onDone={fetchTrash} />')
    expect(read('pages/drive.tsx')).toContain('notice={<RestoreFromEraseOffer className="mb-6" />}')
  })
  test('the transport: POST /account/erase-request/{id}/restore; a 202 folder restore is "in the background"', () => {
    const api = read('lib/api.ts')
    expect(api).toContain('/api/v1/account/erase-request/${encodeURIComponent(requestId)}/restore')
    expect(api).toContain('complete: b.complete !== false')
    expect(read('pages/trash.tsx')).toContain("title: 'Restoring in the background'")
  })
})

// ── 6. accessibility ───────────────────────────────────────────────────────────────────────

describe('6. outcomes are announced, the result takes the focus, errors are alerts', () => {
  test('the card: one status region (always there), errors and load errors as alerts', () => {
    const quiet = renderCard()
    expect(openTag(quiet, 'erase-note')).toContain('role="status"')
    expect(openTag(quiet, 'erase-note')).toContain('aria-live="polite"')
    expect(openTag(quiet, 'erase-note')).toContain('tabindex="-1"')
    const failed = renderCard({ error: 'The password confirmation expired.' })
    expect(openTag(failed, 'erase-error')).toContain('role="alert"')
    const loadFailed = renderCard({ card: null, loadError: 'We could not check what this account holds.' })
    expect(loadFailed).toContain('<p role="alert"')
  })

  test('the card moves the focus to the outcome after an action', () => {
    const src = read('components/erase-request-card.tsx')
    expect(src).toContain('if (focusTick > 0) (errorRef.current ?? noteRef.current)?.focus()')
    expect(read('components/vault-locked-no-key.tsx')).toContain('focusTick={eraseFocusTick}')
  })

  test('both link pages: a status region in every state, the title focusable, the focus moved after an action', async () => {
    const v = await verifyPage()
    const c = await cancelPage()
    const VView = v.EraseVerifyView as React.FC<Record<string, unknown>>
    const CView = c.EraseCancelView as React.FC<Record<string, unknown>>
    const titleRef = React.createRef<HTMLHeadingElement>()
    const verified = decode(
      renderToStaticMarkup(
        React.createElement(VView, {
          view: { kind: 'verified', dueAt: PENDING.due_at, itemCount: 1, retentionDays: 30, cancelToken: TOKEN, confirmationEmailSent: true, cancel: 'idle' },
          onConfirm: () => {},
          onCancel: () => {},
          titleRef,
        }),
      ),
    )
    expect(openTag(verified, 'erase-verify-live')).toContain('role="status"')
    expect(verified).toContain('Erase confirmed. Every file moves to the trash on')
    expect(verified).toContain('<h2 tabindex="-1"')
    const cancelled = decode(renderToStaticMarkup(React.createElement(CView, { view: { kind: 'cancelled' }, onCancel: () => {}, titleRef })))
    expect(openTag(cancelled, 'erase-link-live')).toContain('aria-live="polite"')
    expect(cancelled).toContain('Erase cancelled. Nothing will be moved to the trash.')
    for (const rel of ['pages/erase-request-verify.tsx', 'pages/erase-request-cancel.tsx']) {
      expect(read(rel)).toContain('titleRef.current?.focus()')
    }
  })

  test('the restore block and the banner: status regions and alerts', async () => {
    const r = await restoreMod()
    const b = await bannerMod()
    const RView = r.RestoreFromEraseView as React.FC<Record<string, unknown>>
    const html = decode(
      renderToStaticMarkup(
        React.createElement(RView, { executed: EXECUTED, offer: 'running', busy: false, rowsRestored: 1, inTrash: 2, error: 'x', onRestore: () => {} }),
      ),
    )
    expect(openTag(html, 'erase-restore-status')).toContain('role="status"')
    expect(openTag(html, 'erase-restore-error')).toContain('role="alert"')
    const BView = b.EraseRequestBannerView as React.FC<Record<string, unknown>>
    const banner = decode(
      renderToStaticMarkup(React.createElement(BView, { card: eraseCard(status({ request: PENDING })), busy: false, note: '', error: 'e', onCancel: () => {} })),
    )
    expect(openTag(banner, 'erase-banner-note')).toContain('role="status"')
    expect(openTag(banner, 'erase-banner-error')).toContain('role="alert"')
  })
})

// ── 7. sequencing ──────────────────────────────────────────────────────────────────────────

describe('7. a late status read never overwrites a newer action', () => {
  test('the gate: an older read is stale once a newer read or an action came', async () => {
    const m = await lib()
    const gate = (m.createLatestGate as Fn)() as { begin(): number; isLatest(n: number): boolean; supersede(): void }
    const a = gate.begin()
    const b = gate.begin()
    expect(gate.isLatest(a)).toBe(false)
    expect(gate.isLatest(b)).toBe(true)
    const c = gate.begin()
    gate.supersede() // a cancel's answer was applied while `c` was in flight
    expect(gate.isLatest(c)).toBe(false)
  })

  test('the race from the review: a poll in flight, Cancel applied, the old answer is dropped', async () => {
    const m = await lib()
    const gate = (m.createLatestGate as Fn)() as { begin(): number; isLatest(n: number): boolean; supersede(): void }
    let shown: EraseStatus | null = status({ request: PENDING })
    let resolvePoll!: (s: EraseStatus) => void
    const poll = (async () => {
      const seq = gate.begin()
      const s = await new Promise<EraseStatus>((r) => {
        resolvePoll = r
      })
      if (gate.isLatest(seq)) shown = s
    })()
    // Cancel answers first: applied, and every earlier read superseded.
    shown = (m.applyCancelled as Fn)(shown) as EraseStatus
    gate.supersede()
    resolvePoll(status({ request: PENDING }))
    await poll
    expect(shown?.request).toBeNull()
  })

  test('the locked screen reads through the gate and supersedes on applied actions', () => {
    const screen = read('components/vault-locked-no-key.tsx')
    expect(screen).toContain('const seq = eraseGate.current.begin()')
    expect(screen).toContain('if (!alive.current || !eraseGate.current.isLatest(seq)) return')
    // Round 4b: the request and the cancel supersede here; the restore block supersedes the SAME
    // gate itself (test/1918-erase-request-r4b.test.tsx), so applying its status needs no extra one.
    expect(screen.match(/eraseGate\.current\.supersede\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  test('"Check again" stays until the request shows up or the follow-up read ran', async () => {
    const m = await lib()
    const keep = m.keepCheckAgain as Fn
    // Round 4b: a mode ('request' waits for the request to show up), not a boolean.
    expect(keep('request', status(), false)).toBe('request')
    expect(keep('request', status({ request: AWAITING }), false)).toBe(null)
    expect(keep('request', status(), true)).toBe(null)
    expect(keep(null, status(), false)).toBe(null)
    expect(m.FOLLOW_UP_MS).toBe(10_000)
    const screen = read('components/vault-locked-no-key.tsx')
    expect(screen).toContain('setEraseCheckAgain((mode) => keepCheckAgain(mode, status, followUp))')
    expect(screen).toContain('void loadEraseStatus({ followUp: true })')
    expect(screen.match(/scheduleFollowUp\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

// ── 8. the typed number ────────────────────────────────────────────────────────────────────

describe('8. parseTypedCount accepts real thousands grouping only', () => {
  test('accepted', async () => {
    const m = await lib()
    const p = m.parseTypedCount as Fn
    for (const [typed, n] of [
      ['1240', 1240],
      ['1,240', 1240],
      ['1.240', 1240],
      ['1 240', 1240],
      ["1'240", 1240],
      ['1 240', 1240],
      ['1,240,000', 1240000],
      [' 1240 ', 1240],
      ['7', 7],
    ] as const) {
      expect(`${typed} → ${p(typed)}`).toBe(`${typed} → ${n}`)
    }
  })

  test('refused', async () => {
    const m = await lib()
    const p = m.parseTypedCount as Fn
    for (const typed of ['12.40', '1,2,4,0', '1.5', '1,24', '1,240.5', '1.240,000', '1,2400', ',240', '1,240,', '-1240', '1e3', '']) {
      expect(`${JSON.stringify(typed)} → ${p(typed)}`).toBe(`${JSON.stringify(typed)} → null`)
    }
  })
})
