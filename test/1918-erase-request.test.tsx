/**
 * Task 1918 [P0] — the locked screen's "Erase all files" cannot make files go missing.
 *
 * Guus, 2026-10-17: "Files should NEVER go missing" / "the code and all apps should just not
 * delete random stuff" (supersedes the 1704 open-question #7 default, "explicit confirmation,
 * no time delay"). The browser no longer erases anything: it files a server-side request
 * (typed item count + password step-up), the server emails the owner a cancel link, waits 72 h,
 * then moves everything to the TRASH. These tests pin the web half:
 *
 *  1. the typed number must be exactly the server's live item count;
 *  2. the card shows the right state (ask / pending with due time + Cancel / moving / done);
 *  3. requesting sends the typed count + the step-up token and nothing else; a changed count,
 *     a rate limit and a failed notice are told honestly;
 *  4. cancelling calls the cancel endpoint and is told honestly;
 *  5. the locked screen has no path to `/files/permanent` (or the old wipe orchestration);
 *  6. the email link page reads the token from the fragment and cancels without credentials.
 *
 * The browser rung (Playwright against a local API) is `e2e/1918-erase-request.spec.ts`.
 */
import { describe, expect, mock, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EraseRequestCard, type EraseRequestCardProps } from '../src/components/erase-request-card'
import {
  cancelErase,
  eraseCard,
  formatDue,
  parseEraseStatus,
  parseTypedCount,
  requestErase,
  typedCountMatches,
  type EraseStatus,
} from '../src/lib/erase-request'
import { cancelByLink, readCancelToken } from '../src/lib/erase-request-link'
import { isVaultFreePath } from '../src/lib/vault-free-paths'

const SRC = path.resolve(import.meta.dir, '../src')

const PENDING = {
  id: '6f1c2b8e-0000-4000-8000-000000000001',
  requested_at: '2026-10-18T10:00:00Z',
  due_at: '2026-10-21T10:00:00Z',
  item_count: 1240,
  cancellable: true,
}

function status(over: Partial<EraseStatus> = {}): EraseStatus {
  return {
    request: null,
    live_items: 1240,
    cooldown_hours: 72,
    trash_retention_days: 30,
    last_executed: null,
    ...over,
  }
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

// ── 1. the typed count ──────────────────────────────────────────────────────

describe('the typed number must be the server count, exactly', () => {
  test('the exact count enables the request', () => {
    expect(typedCountMatches('1240', 1240)).toBe(true)
    expect(typedCountMatches(' 1240 ', 1240)).toBe(true)
  })

  test('grouped the way people write it is the same number', () => {
    for (const t of ['1,240', '1.240', '1 240', "1'240", '1 240']) {
      expect(parseTypedCount(t)).toBe(1240)
      expect(typedCountMatches(t, 1240)).toBe(true)
    }
  })

  test('anything else is refused', () => {
    for (const t of ['', '124', '12400', '1239', '1241', '-1240', '1240.5x', 'all', '1240 files', '0x4d8']) {
      expect(typedCountMatches(t, 1240)).toBe(false)
    }
  })

  test('nothing to erase: even "0" does not enable it', () => {
    expect(typedCountMatches('0', 0)).toBe(false)
  })
})

// ── 2. the card state ───────────────────────────────────────────────────────

describe('what the card shows comes from the server status', () => {
  test('parses the server answer and refuses a malformed one', () => {
    const ok = parseEraseStatus({ ...status(), request: PENDING })
    expect(ok?.request?.id).toBe(PENDING.id)
    expect(parseEraseStatus({ ...status(), live_items: -1 })).toBeNull()
    expect(parseEraseStatus({ ...status(), request: { id: 'x' } })).toBeNull()
    expect(parseEraseStatus(null)).toBeNull()
  })

  test('no request: ask with the live count; nothing live: empty', () => {
    expect(eraseCard(status())).toEqual({ kind: 'ask', liveItems: 1240 })
    expect(eraseCard(status({ live_items: 0 }))).toEqual({ kind: 'empty' })
  })

  test('a cancellable request is pending; once the wait is over it is moving', () => {
    expect(eraseCard(status({ request: PENDING })).kind).toBe('pending')
    expect(eraseCard(status({ request: { ...PENDING, cancellable: false } })).kind).toBe('moving')
  })

  test('done recently and nothing live: done', () => {
    const executed = { id: PENDING.id, executed_at: '2026-10-21T10:03:00Z', items_trashed: 1240 }
    expect(eraseCard(status({ live_items: 0, last_executed: executed }))).toEqual({ kind: 'done', executed })
  })
})

describe('the card says what happens and when (SSR markup)', () => {
  test('ask: the wait, the email, the trash, the retention, and the number to type', () => {
    const html = renderCard()
    expect(html).toContain('Erase all files')
    expect(html).toContain('moves to the trash after a 72-hour wait')
    expect(html).toContain('We email ')
    expect(html).toContain('owner@example.org')
    expect(html).toContain('with a link to cancel')
    expect(html).toContain('stay in the trash for 30 days')
    expect(html).toContain('Type <span class="font-mono">1240</span> to confirm')
    expect(html).not.toContain('permanently')
    expect(html).not.toContain('cannot be recovered')
  })

  test('the request button stays disabled until the exact number is typed', () => {
    expect(buttonTag(renderCard({ typed: '' }), 'erase-request-button')).toContain('disabled=""')
    expect(buttonTag(renderCard({ typed: '1239' }), 'erase-request-button')).toContain('disabled=""')
    const ready = buttonTag(renderCard({ typed: '1240' }), 'erase-request-button')
    expect(ready).toContain('data-testid="erase-request-button"')
    expect(ready).not.toContain('disabled')
  })

  test('pending: the due time, the item count and a Cancel button', () => {
    const html = renderCard({ card: eraseCard(status({ request: PENDING })) })
    expect(html).toContain('Erase requested.')
    expect(html).toContain(formatDue(PENDING.due_at))
    expect(html).toContain('(1240 items) moves to the trash')
    expect(html).toContain('We emailed ')
    expect(buttonTag(html, 'erase-cancel-button')).toContain('Cancel the erase')
    expect(buttonTag(html, 'erase-cancel-button')).not.toContain('disabled')
    expect(html).not.toContain('erase-request-button')
  })

  test('moving: no cancel button, and the trash is named as where the files are', () => {
    const html = renderCard({ card: eraseCard(status({ request: { ...PENDING, cancellable: false } })) })
    expect(html).toContain('the files are moving to the trash now')
    expect(html).not.toContain('erase-cancel-button')
  })

  test('the due time reads as a date people know, in their own zone', () => {
    // ICU builds differ in punctuation ("Wednesday, 21 October" vs "Wednesday 21 October"); the
    // facts are what matter: weekday, date, local time, zone.
    const due = formatDue('2026-10-21T10:00:00Z', { timeZone: 'Europe/Amsterdam' })
    for (const part of ['Wednesday', '21 October 2026', '12:00', 'CEST']) expect(due).toContain(part)
    expect(formatDue('not a date')).toBe('not a date')
  })
})

// ── 3. requesting ───────────────────────────────────────────────────────────

describe('requestErase() sends the typed count and the step-up token, nothing else', () => {
  test('201: the request comes back as pending', async () => {
    const create = mock(async (_c: number, _t: string) => ({ request: PENDING, created: true }))
    const cancel = mock(async () => ({}))
    const out = await requestErase({ create, cancel }, 1240, 'confirm-token')
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]).toEqual([1240, 'confirm-token'])
    expect(cancel).toHaveBeenCalledTimes(0)
    expect(out).toEqual({ kind: 'requested', request: PENDING, created: true })
  })

  test('a second request while one is pending returns the pending one', async () => {
    const out = await requestErase(
      { create: async () => ({ request: PENDING, created: false }), cancel: async () => ({}) },
      1240,
      't',
    )
    expect(out).toEqual({ kind: 'requested', request: PENDING, created: false })
  })

  test('409 count_mismatch: the new number, nothing scheduled', async () => {
    const err = { status: 409, code: 'count_mismatch', message: 'x', details: { live_items: 1241 } }
    const out = await requestErase({ create: async () => Promise.reject(err), cancel: async () => ({}) }, 1240, 't')
    expect(out).toEqual({ kind: 'count_changed', liveItems: 1241 })
  })

  test('429 and the failed notice are told in the server words', async () => {
    const rate = { status: 429, code: 'erase_request_rate_limited', message: 'You asked 3 times. Try again later.' }
    expect(await requestErase({ create: async () => Promise.reject(rate), cancel: async () => ({}) }, 1, 't')).toEqual({
      kind: 'refused',
      message: rate.message,
    })
    const notice = { status: 503, code: 'erase_notice_failed', message: 'We could not send the notice email, so nothing was scheduled.' }
    expect(await requestErase({ create: async () => Promise.reject(notice), cancel: async () => ({}) }, 1, 't')).toEqual({
      kind: 'refused',
      message: notice.message,
    })
  })

  test('an expired step-up and a network failure say nothing was scheduled', async () => {
    const expired = { status: 403, code: 'confirmation_required', message: 'confirmation required' }
    const a = await requestErase({ create: async () => Promise.reject(expired), cancel: async () => ({}) }, 1, 't')
    expect(a).toEqual({ kind: 'refused', message: 'The password confirmation expired. Try again.' })
    const b = await requestErase({ create: async () => Promise.reject(new TypeError('Failed to fetch')), cancel: async () => ({}) }, 1, 't')
    expect(b.kind).toBe('refused')
    expect((b as { message: string }).message).toContain('Nothing was scheduled')
  })
})

// ── 4. cancelling ───────────────────────────────────────────────────────────

describe('cancelErase() calls the cancel endpoint', () => {
  test('200: cancelled', async () => {
    const cancel = mock(async () => ({ cancelled: true }))
    const create = mock(async () => ({}))
    expect(await cancelErase({ create, cancel })).toEqual({ kind: 'cancelled' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(0)
  })

  test('409 already started, 404 nothing pending, anything else failed', async () => {
    const deps = (err: unknown) => ({ create: async () => ({}), cancel: async () => Promise.reject(err) })
    expect(await cancelErase(deps({ status: 409, code: 'erase_already_started' }))).toEqual({ kind: 'already_started' })
    expect(await cancelErase(deps({ status: 404, code: 'no_pending_erase_request' }))).toEqual({ kind: 'nothing_pending' })
    expect((await cancelErase(deps(new TypeError('x')))).kind).toBe('failed')
  })
})

// ── 5. no path to /files/permanent from the locked screen ───────────────────

/** Every local module reachable from `entry` through relative imports (as in 1920's review test). */
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

describe('the locked screen cannot erase anything itself', () => {
  const screen = readFileSync(path.join(SRC, 'components/vault-locked-no-key.tsx'), 'utf8')
  const card = readFileSync(path.join(SRC, 'components/erase-request-card.tsx'), 'utf8')
  const logic = readFileSync(path.join(SRC, 'lib/erase-request.ts'), 'utf8')

  test('no permanent-delete or bulk-trash call, no old wipe orchestration', () => {
    for (const [name, src] of [
      ['vault-locked-no-key.tsx', screen],
      ['erase-request-card.tsx', card],
      ['erase-request.ts', logic],
    ] as const) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const banned of ['bulkPermanentDelete', 'permanentDeleteFile', '/files/permanent', 'bulkTrashFiles', 'executeDeleteAllData', 'locked-state-exits']) {
        expect(`${name}: ${code.includes(banned) ? banned : 'clean'}`).toBe(`${name}: clean`)
      }
    }
  })

  test('the old wipe module is gone from the tree', () => {
    expect(existsSync(path.join(SRC, 'lib/locked-state-exits.ts'))).toBe(false)
    expect(localImportClosure(path.join(SRC, 'components/vault-locked-no-key.tsx'))).not.toContain('lib/locked-state-exits.ts')
  })

  test('the screen files the request through the erase-request endpoints', () => {
    expect(screen).toContain('createEraseRequest')
    expect(screen).toContain('cancelEraseRequest')
    expect(screen).toContain('getEraseRequest')
  })
})

// ── 6. the email link ───────────────────────────────────────────────────────

describe('the cancel link: token in the fragment, no credentials', () => {
  const TOKEN = 'Qm9vbS1ib29tLWJvb20tYm9vbS1ib29tLWJvb20tYm9v'

  test('reads #t=<token>, refuses anything else', () => {
    expect(readCancelToken(`#t=${TOKEN}`)).toBe(TOKEN)
    expect(readCancelToken(`t=${TOKEN}`)).toBe(TOKEN)
    expect(readCancelToken('')).toBeNull()
    expect(readCancelToken('#t=short')).toBeNull()
    expect(readCancelToken('#t=<script>alert(1)</script>xxxxxxxxxxxxx')).toBeNull()
    expect(readCancelToken(`#x=${TOKEN}`)).toBeNull()
  })

  test('POSTs the token in the body, never the URL, with no cookies', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ cancelled: true }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await cancelByLink(TOKEN, { fetchImpl, apiUrl: 'https://api.example' })).toEqual({ kind: 'cancelled' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.example/api/v1/account/erase-request/cancel-by-token')
    expect(calls[0].url).not.toContain(TOKEN)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.credentials).toBe('omit')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ token: TOKEN })
  })

  test('404 is one "invalid" answer; 429 and network failures are "try again"', async () => {
    const answer = (status: number) =>
      (async () => new Response('{}', { status })) as unknown as typeof fetch
    expect(await cancelByLink(TOKEN, { fetchImpl: answer(404), apiUrl: 'x' })).toEqual({ kind: 'invalid' })
    expect(await cancelByLink(TOKEN, { fetchImpl: answer(429), apiUrl: 'x' })).toEqual({ kind: 'unavailable', rateLimited: true })
    const down = (async () => {
      throw new TypeError('offline')
    }) as unknown as typeof fetch
    expect(await cancelByLink(TOKEN, { fetchImpl: down, apiUrl: 'x' })).toEqual({ kind: 'unavailable', rateLimited: false })
  })

  test('the page is vault-free and its imports never reach the credentialed client', () => {
    expect(isVaultFreePath('/erase-request/cancel')).toBe(true)
    expect(isVaultFreePath('/erase-request/cancel/extra')).toBe(false)
    const closure = localImportClosure(path.join(SRC, 'pages/erase-request-cancel.tsx'))
    expect(closure).toContain('lib/erase-request-link.ts')
    for (const banned of ['lib/api.ts', 'components/auth-shell.tsx', 'lib/key-context.tsx', 'lib/crypto.ts']) {
      expect(closure).not.toContain(banned)
    }
  })
})
