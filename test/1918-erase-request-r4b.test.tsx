/**
 * Task 1918 round 4b — the web half of the /code-review pass on eebd97e..15e51ae (no P1, 2 P2,
 * 11 P3), fixed on top of 9f2c6d6. One describe per item of the coordinator's list:
 *
 *  1. [P2] the locked screen reads the status again when a restore finishes;
 *  2. [P2] the reload copy on both link pages claims nothing about what happened before;
 *  3. one sequencing authority: the restore block reads and supersedes through the screen's gate;
 *  4. a status that no longer carries the erase stops the polling; a 403 frozen refusal shows its
 *     message, with no "follows in the background";
 *  5. "Check again": a superseded follow-up reschedules, a click counts as the follow-up, and
 *     after an unknown CANCEL a read without a request clears it;
 *  6. counts, not "everything": "<n> items from this erase are still in the trash", and
 *     "Nothing from this erase is left in the trash.";
 *  7. a stale restore error clears on progress; unknown outcomes get a real "Check again" button;
 *  8. the note after `requested` depends on what came back;
 *  9. a cancel miss with a NEWER pending request says so and shows it;
 * 10. a 401 / account-state answer to the one POST is followed by a status read through the
 *     shared client (its global handlers), never by a second POST;
 * 11. one cached status read (30 s, in-flight shared) for the banner and the two restore offers;
 * 12. Trash bulk restores keep large folders restoring in the background in the list;
 * 13. after an action the error (if any) takes the focus, else the result line.
 *
 * New modules and exports are imported dynamically, so on 9f2c6d6 each test fails on its own.
 *
 * Round 4d (web#174 review, finding 5): tests that read the source of the restore block and the
 * banner now drive their controllers. Kept as source checks (no DOM to exercise them): the focus
 * moves (refs), and the locked screen's wiring.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { eraseCard, type EraseStatus } from '../src/lib/erase-request'
import { apiError as fakeApiError, deferred, flush, manualTimers } from './helpers/erase-request-fakes'

const SRC = path.resolve(import.meta.dir, '../src')
const REQ = '6f1c2b8e-0000-4000-8000-000000000005'
const OTHER = '6f1c2b8e-0000-4000-8000-000000000006'

type Mod = Record<string, unknown>
type Fn = (...args: unknown[]) => unknown
const lib = async () => (await import('../src/lib/erase-request')) as unknown as Mod
const transport = async () => (await import('../src/lib/erase-request-transport')) as unknown as Mod
const store = async () => (await import('../src/lib/erase-status-store')) as unknown as Mod
const summary = async () => (await import('../src/lib/trash-restore-summary')) as unknown as Mod
const restoreMod = async () => (await import('../src/components/restore-from-erase')) as unknown as Mod
const bannerMod = async () => (await import('../src/components/erase-request-banner')) as unknown as Mod
const restoreCtl = async () => (await import('../src/lib/restore-controller')) as unknown as Mod
const bannerCtl = async () => (await import('../src/lib/erase-banner-controller')) as unknown as Mod

function bannerOpts(cacheRead: (k: string, o?: { force?: boolean }) => Promise<unknown>, cancel: () => Promise<unknown>, extra: Record<string, unknown> = {}) {
  return {
    cache: { read: cacheRead, invalidate: () => {}, subscribe: () => () => {} },
    key: 'u1',
    deps: { create: async () => ({}), cancel, status: async () => Promise.reject(new TypeError('x')) },
    win: new EventTarget(),
    doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    timers: manualTimers().hooks,
    ...extra,
  }
}

const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const AWAITING = {
  id: REQ,
  requested_at: '2026-10-18T10:00:00Z',
  due_at: null,
  item_count: 1240,
  cancellable: true,
  verified: false,
  verify_expires_at: '2026-10-19T10:00:00Z',
}
const PENDING = { ...AWAITING, due_at: '2026-10-21T12:00:00Z', verified: true, verify_expires_at: null }
const EXECUTED = {
  id: REQ,
  executed_at: '2026-10-18T12:00:00Z',
  items_trashed: 150,
  trashed_at: '2026-10-18T11:59:00Z',
  restorable_until: '2026-11-17T11:59:00Z',
  in_trash: 150,
  restore: null,
}
/** A restore running for EXECUTED (round 4d controller tests). */
const RUNNING_FOR_GATE = { ...EXECUTED, in_trash: 100, restore: { state: 'running', requested_at: null, rows_restored: 50, finished_at: null } }

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

/** The visible text: tags and React's `<!-- -->` text separators removed. */
function textOf(html: string): string {
  return html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '')
}

function openTag(html: string, id: string): string {
  const at = html.indexOf(`data-testid="${id}"`)
  if (at < 0) return ''
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

function apiError(statusCode: number, codeName: string, message = '') {
  return Object.assign(new Error(message || codeName), { status: statusCode, code: codeName, message: message || codeName })
}

async function drawRestore(p: Record<string, unknown>): Promise<string> {
  const m = await restoreMod()
  const View = m.RestoreFromEraseView as React.FC<Record<string, unknown>>
  return decode(
    renderToStaticMarkup(
      React.createElement(View, { executed: EXECUTED, offer: 'offer', busy: false, rowsRestored: 0, inTrash: 150, error: '', onRestore: () => {}, ...p }),
    ),
  )
}

// ── 1 ──────────────────────────────────────────────────────────────────────────────────────

describe('1. the locked screen reads the status again when a restore finishes', () => {
  test('the block gets onDone (a fresh read) and its statuses go into the screen', () => {
    const screen = read('components/vault-locked-no-key.tsx')
    expect(screen).toMatch(/const reloadAfterRestore = useCallback\(\(\) => \{\s*void loadEraseStatus\(\)\s*\}, \[loadEraseStatus\]\)/)
    expect(screen).toContain('onDone={reloadAfterRestore}')
    expect(screen).toMatch(/const applyRestoreStatus = useCallback\(\(status: EraseStatus\) => \{\s*setEraseStatus\(status\)/)
    expect(screen).toContain('onStatus={applyRestoreStatus}')
  })

  test('the block calls onDone once when nothing of the erase is left in the trash', async () => {
    const r = await restoreCtl()
    const onDone = mock(() => {})
    const done = { ...EXECUTED, in_trash: 0, restore: { state: 'done', requested_at: null, rows_restored: 150, finished_at: 'x' } }
    const ctl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: { restore: async () => ({ restore: { state: 'running', rows_restored: 50 }, in_trash: 100 }), status: async () => status({ last_executed: done }) },
      timers: manualTimers(),
      onDone,
    }) as { start(): Promise<void>; poll(): Promise<void> }
    await ctl.start()
    expect(onDone).toHaveBeenCalledTimes(0)
    await ctl.poll()
    await ctl.poll()
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

// ── 2 ──────────────────────────────────────────────────────────────────────────────────────

describe('2. after a reload the link pages claim nothing about what happened before', () => {
  async function renderAt(file: string, name: string, url: string) {
    const m = (await import(`../src/pages/${file}`)) as unknown as Mod
    const Page = m[name] as React.FC
    return decode(renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, React.createElement(Page))))
  }

  test('the cancel page: it cannot tell; open the link again and click', async () => {
    const html = await renderAt('erase-request-cancel', 'EraseRequestCancelPage', '/erase-request/cancel')
    expect(html).toContain("After a reload it can't tell what happened before.")
    expect(html).toContain('Open the cancel link in the email again')
    expect(html).not.toMatch(/Nothing has been (changed|confirmed|cancelled)/)
  })

  test('the confirmation page: it cannot tell; a second Confirm says so and changes nothing', async () => {
    const html = await renderAt('erase-request-verify', 'EraseRequestVerifyPage', '/erase-request/verify')
    expect(html).toContain("After a reload it can't tell what happened before.")
    expect(html).toContain('If you already confirmed, clicking Confirm says so and changes nothing.')
    expect(html).not.toMatch(/Nothing has been (changed|confirmed|cancelled)/)
  })
})

// ── 3 ──────────────────────────────────────────────────────────────────────────────────────

describe('3. one sequencing authority for the screen and its restore block', () => {
  test('the block reads and supersedes through the gate it is given; the screen gives its own', async () => {
    const m = await lib()
    const r = await restoreCtl()
    const gate = (m.createLatestGate as Fn)() as { begin(): number; isLatest(n: number): boolean; supersede(): void }
    const onStatus = mock((_s: unknown) => {})
    let answer!: (v: unknown) => void
    const ctl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: {
        restore: async () => ({ restore: { state: 'running', rows_restored: 1 }, in_trash: 149 }),
        status: () =>
          new Promise((res) => {
            answer = res
          }),
      },
      gate,
      timers: manualTimers(),
      onStatus,
    }) as { start(): Promise<void>; poll(): Promise<void> }
    // a screen read in flight loses to the block's restore answer
    const screenRead = gate.begin()
    await ctl.start()
    expect(gate.isLatest(screenRead)).toBe(false)
    // a block poll in flight loses to a newer screen read
    const poll = ctl.poll()
    gate.begin()
    answer(status({ last_executed: RUNNING_FOR_GATE }))
    await poll
    expect(onStatus).toHaveBeenCalledTimes(0)
    // Source check (no DOM): the locked screen hands its gate to the block.
    expect(read('components/vault-locked-no-key.tsx')).toContain('gate={eraseGate.current}')
  })
  test('with one gate, a screen read in flight loses to the restore answer, and a block poll in flight loses to a cancel', async () => {
    const m = await lib()
    const gate = (m.createLatestGate as Fn)() as { begin(): number; isLatest(n: number): boolean; supersede(): void }
    const screenRead = gate.begin()
    gate.supersede() // the block applied a restore 202
    expect(gate.isLatest(screenRead)).toBe(false)
    const blockPoll = gate.begin()
    gate.supersede() // the screen applied a cancel
    expect(gate.isLatest(blockPoll)).toBe(false)
  })
})

// ── 4 ──────────────────────────────────────────────────────────────────────────────────────

describe('4. a status without this erase stops the polling; a frozen refusal shows its words', () => {
  test('restoreUpdate: no last erase, or another one, is lost; the same one updates', async () => {
    const m = await lib()
    const update = m.restoreUpdate as Fn
    expect(update(REQ, status())).toEqual({ kind: 'lost' })
    expect(update(REQ, status({ last_executed: { ...EXECUTED, id: OTHER } }))).toEqual({ kind: 'lost' })
    expect(((update(REQ, status({ last_executed: EXECUTED })) as Mod).kind)).toBe('update')
  })

  test('the lost view: a neutral line, no button, no progress promise', async () => {
    const html = await drawRestore({ offer: 'lost' })
    expect(html).toContain("The restore can't be followed here any more. Trash shows what is still there.")
    expect(html).not.toContain('data-testid="erase-restore-button"')
    expect(html).not.toContain('follows in the background')
  })

  test('the block stops polling once lost (polling runs only while the view is running)', async () => {
    const r = await restoreCtl()
    const timers = manualTimers()
    let answer: unknown = status({ last_executed: RUNNING_FOR_GATE })
    const ctl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: { restore: async () => ({ restore: { state: 'running', rows_restored: 1 }, in_trash: 149 }), status: async () => answer },
      timers,
      pollMs: 5_000,
    }) as { start(): Promise<void>; getState(): { view: string } }
    await ctl.start()
    expect(timers.intervals()).toEqual([5_000])
    answer = status({ last_executed: null })
    timers.tickIntervals()
    await flush()
    expect(ctl.getState().view).toBe('lost')
    expect(timers.intervals()).toEqual([])
  })
  test('403 account_frozen: refused in the server words; the view shows it with no background line', async () => {
    const m = await lib()
    const frozenMsg = 'This account is frozen, so nothing can be restored right now.'
    const out = await (m.restoreEverything as Fn)(
      { restore: async () => Promise.reject(apiError(403, 'account_frozen', frozenMsg)), status: async () => status() },
      REQ,
    )
    expect(out).toEqual({ kind: 'refused', message: frozenMsg })
    const html = await drawRestore({ offer: 'offer', error: frozenMsg })
    expect(html).toContain(frozenMsg)
    expect(html).not.toContain('follows in the background')
  })
})

// ── 5 ──────────────────────────────────────────────────────────────────────────────────────

describe('5. "Check again" waits for the right thing and counts the click', () => {
  test('after an unknown CANCEL: a read without a request clears it; with the request it stays', async () => {
    const m = await lib()
    const keep = m.keepCheckAgain as Fn
    expect(keep('cancel', status(), false)).toBe(null)
    expect(keep('cancel', status({ request: PENDING }), false)).toBe('cancel')
    expect(keep('request', status(), false)).toBe('request')
    expect(keep('request', status({ request: AWAITING }), false)).toBe(null)
    expect(keep('cancel', status({ request: PENDING }), true)).toBe(null)
  })

  test('the screen: unknown cancel waits for "gone", a superseded follow-up reschedules, a click is the follow-up', () => {
    const screen = read('components/vault-locked-no-key.tsx')
    expect(screen).toContain("setEraseCheckAgain('cancel')")
    expect(screen).toContain("setEraseCheckAgain('request')")
    expect(screen).toMatch(/if \(!eraseGate\.current\.isLatest\(seq\)\) \{\s*if \(followUp\) scheduleFollowUpRef\.current\(\)/)
    expect(screen).toContain('onCheckAgain={() => void loadEraseStatus({ followUp: true })}')
    expect(read('components/erase-request-card.tsx')).toContain('onClick={props.onCheckAgain ?? props.onRetryLoad}')
  })
})

// ── 6 ──────────────────────────────────────────────────────────────────────────────────────

describe('6. counts, not "everything"', () => {
  test('what is left: "<n> items from this erase are still in the trash"', async () => {
    const m = await lib()
    const text = m.inTrashText as Fn
    expect(text(150)).toBe('150 items from this erase are still in the trash')
    expect(text(1)).toBe('1 item from this erase is still in the trash')
    expect(text(null)).toBe(null)
    expect(m.RESTORE_DONE_TEXT).toBe('Nothing from this erase is left in the trash.')
  })

  test('the offer names the count and the date; the button keeps the email\'s words', async () => {
    const html = await drawRestore({ offer: 'offer', inTrash: 150 })
    expect(textOf(html)).toContain('150 items from this erase are still in the trash until Tuesday 17 November 2026')
    expect(openTag(html, 'erase-restore-button')).toContain('<button')
    expect(html).toContain('Restore everything from the erase on Sunday 18 October 2026')
    expect(await drawRestore({ offer: 'done', inTrash: 0 })).toContain('Nothing from this erase is left in the trash.')
  })

  test('no surface says everything is back', () => {
    for (const rel of ['lib/erase-request.ts', 'components/restore-from-erase.tsx']) {
      expect(`${rel}: ${/Everything from the erase is back/.test(code(rel))}`).toBe(`${rel}: false`)
    }
  })
})

// ── 7 ──────────────────────────────────────────────────────────────────────────────────────

describe('7. a stale error clears on progress; unknown outcomes get a real "Check again"', () => {
  // Round 4c changed this rule (test/1918-erase-request-r4c.test.tsx has the full table): an
  // UNKNOWN outcome's error is replaced by any fresh status; a refusal's error stays until the next
  // click. `restoreUpdate` no longer decides it; `restoreErrorAfterRead` does.
  test('after an unknown outcome the error clears once the restore runs or is done', async () => {
    const m = await lib()
    const after = m.restoreErrorAfterRead as Fn
    const running = { ...EXECUTED, in_trash: 100, restore: { state: 'running', requested_at: null, rows_restored: 50, finished_at: null } }
    const done = { ...EXECUTED, in_trash: 0, restore: { state: 'done', requested_at: null, rows_restored: 150, finished_at: 'x' } }
    expect((after('unknown', running) as Mod).clear).toBe(true)
    expect((after('unknown', done) as Mod).clear).toBe(true)
  })

  test('the restore block and the banner draw "Check again" after an unknown outcome', async () => {
    const r = await drawRestore({ offer: 'offer', error: "We couldn't confirm whether the restore started. Check again.", checkAgain: true, onCheckAgain: () => {} })
    expect(openTag(r, 'erase-restore-check-again')).toContain('<button')
    const b = await bannerMod()
    const View = b.EraseRequestBannerView as React.FC<Record<string, unknown>>
    const banner = decode(
      renderToStaticMarkup(
        React.createElement(View, {
          card: eraseCard(status({ request: PENDING })),
          busy: false,
          note: "We couldn't confirm what happened to the request. Check again, or use the link in the email.",
          error: '',
          onCancel: () => {},
          checkAgain: true,
          onCheckAgain: () => {},
        }),
      ),
    )
    expect(openTag(banner, 'erase-banner-check-again')).toContain('<button')
  })

  test('the stateful parts set it on unknown and clear it on the next read', async () => {
    // the restore block: an unknown outcome sets "Check again"; a read showing it running clears it
    const r = await restoreCtl()
    let reads = 0
    const held = deferred<unknown>()
    const ctl = (r.createRestoreController as Fn)({
      executed: EXECUTED,
      deps: {
        restore: async () => Promise.reject(fakeApiError(0, '')),
        // the reconcile inside restoreEverything sees no restore yet (unknown); the block's own
        // read right after sees it running
        status: () => (++reads === 1 ? Promise.resolve(status({ last_executed: EXECUTED })) : held.promise),
      },
      timers: manualTimers(),
    }) as { start(): Promise<void>; getState(): { checkAgain: boolean; error: string } }
    await ctl.start()
    expect(ctl.getState().checkAgain).toBe(true)
    expect(ctl.getState().error).not.toBe('')
    held.resolve(status({ last_executed: RUNNING_FOR_GATE }))
    await flush()
    expect(ctl.getState().checkAgain).toBe(false) // the read showed it running: no doubt left
    expect(ctl.getState().error).toBe('')
    // the banner: an unknown cancel sets it; a read without a request clears it
    const b = await bannerCtl()
    let answer = status({ request: PENDING })
    const banner = (b.createBannerController as Fn)(
      bannerOpts(async () => answer, async () => Promise.reject(fakeApiError(0, ''))),
    ) as { attach(): void; cancel(): Promise<void>; load(): Promise<void>; getState(): { checkAgain: boolean } }
    banner.attach()
    await flush()
    await banner.cancel()
    await flush()
    expect(banner.getState().checkAgain).toBe(true)
    answer = status()
    await banner.load()
    expect(banner.getState().checkAgain).toBe(false)
  })
})

// ── 8 ──────────────────────────────────────────────────────────────────────────────────────

describe('8. the note after "requested" says what came back', () => {
  test('created, existing awaiting, existing confirmed, learned from a read', async () => {
    const m = await lib()
    const note = m.requestedNote as Fn
    expect(note({ kind: 'requested', request: AWAITING, created: true })).toBe('Requested. Check your email to confirm it.')
    expect(note({ kind: 'requested', request: AWAITING, created: false })).toBe('A request is already waiting for confirmation by email.')
    expect(note({ kind: 'requested', request: PENDING, created: false })).toBe('There is already a confirmed erase request.')
    for (const created of [false, null]) {
      for (const request of [AWAITING, PENDING]) {
        expect(note({ kind: 'requested', request, created }) as string).not.toContain('Check your email')
      }
    }
    expect(read('components/vault-locked-no-key.tsx')).toContain('setEraseNote(requestedNote(outcome))')
  })
})

// ── 9 ──────────────────────────────────────────────────────────────────────────────────────

describe('9. a cancel miss with a newer pending request', () => {
  const deps = (st: () => Promise<unknown>) => ({
    create: async () => ({}),
    cancel: async () => Promise.reject(apiError(404, 'no_pending_erase_request')),
    status: st,
  })

  test('another request is pending: "replaced" with the fresh status, not "did not go through"', async () => {
    const m = await lib()
    const newer = status({ request: { ...PENDING, id: OTHER } })
    const out = (await (m.cancelErase as Fn)(deps(async () => newer), REQ)) as Mod
    expect(out).toEqual({ kind: 'replaced', status: newer })
    expect((m.cancelNote as Fn)(out)).toBe('That request is gone; a newer request is pending.')
  })

  test('the same request still pending: still_pending', async () => {
    const m = await lib()
    const out = (await (m.cancelErase as Fn)(deps(async () => status({ request: PENDING })), REQ)) as Mod
    expect(out.kind).toBe('still_pending')
  })

  test('the screen shows the new request', async () => {
    // the banner: a 404 with a newer request pending shows the newer one
    const b = await bannerCtl()
    const newer = status({ request: { ...PENDING, id: OTHER } })
    let answer = status({ request: PENDING })
    const banner = (b.createBannerController as Fn)(
      bannerOpts(async () => answer, async () => Promise.reject(fakeApiError(404, 'no_pending_erase_request')), {
        deps: { create: async () => ({}), cancel: async () => Promise.reject(fakeApiError(404, 'no_pending_erase_request')), status: async () => newer },
      }),
    ) as { attach(): void; cancel(): Promise<void>; getState(): { card: { request: { id: string } } | null; note: string } }
    banner.attach()
    await flush()
    answer = newer
    await banner.cancel()
    expect(banner.getState().card?.request.id).toBe(OTHER)
    expect(banner.getState().note).toBe('That request is gone; a newer request is pending.')
    // Source check (no DOM): the locked screen applies the fresh status for 'replaced'.
    expect(read('components/vault-locked-no-key.tsx')).toContain(
      "outcome.kind === 'nothing_pending' || outcome.kind === 'already_executed' || outcome.kind === 'replaced'",
    )
  })
})

// ── 10 ─────────────────────────────────────────────────────────────────────────────────────

describe('10. an account-state answer is followed by a read through the shared client, never a second POST', () => {
  async function post(statusCode: number, body: unknown) {
    const m = await transport()
    let posts = 0
    let followUps = 0
    const fetchImpl = (async () => {
      posts++
      return new Response(JSON.stringify(body), { status: statusCode })
    }) as unknown as typeof fetch
    const err = (await (m.postEraseRequestOnce as Fn)(1240, 'tok', {
      fetchImpl,
      apiUrl: 'x',
      token: null,
      extraHeaders: {},
      afterAuthFailure: async () => {
        followUps++
      },
    }).then(
      () => null,
      (e: unknown) => e,
    )) as { status?: number } | null
    return { posts, followUps, err }
  }

  test('401, 403 account_deleted / account_suspended, 409 account_mismatch: one POST, one read', async () => {
    for (const [s, c] of [
      [401, 'unauthorized'],
      [403, 'account_deleted'],
      [403, 'account_suspended'],
      [409, 'account_mismatch'],
    ] as const) {
      const r = await post(s, { error: c, message: c })
      expect(`${s} ${c}: posts=${r.posts} reads=${r.followUps} status=${r.err?.status}`).toBe(`${s} ${c}: posts=1 reads=1 status=${s}`)
    }
  })

  test('other refusals: no extra read', async () => {
    for (const [s, c] of [
      [403, 'confirmation_required'],
      [429, 'erase_request_rate_limited'],
      [409, 'count_mismatch'],
    ] as const) {
      const r = await post(s, { error: c, message: c })
      expect(`${s} ${c}: posts=${r.posts} reads=${r.followUps}`).toBe(`${s} ${c}: posts=1 reads=0`)
    }
  })
})

// ── 11 ─────────────────────────────────────────────────────────────────────────────────────

describe('11. one cached status read for the unlocked app', () => {
  type Cache = { read(key: string, opts?: { force?: boolean }): Promise<EraseStatus | null>; invalidate(): void }

  test('a fresh answer is reused for 30 s; after that, or forced, or for another account, it is read again', async () => {
    const m = await store()
    expect(m.ERASE_STATUS_TTL_MS).toBe(30_000)
    let fetches = 0
    let clock = 1_000
    const cache = (m.createEraseStatusCache as Fn)(
      async () => {
        fetches++
        return status()
      },
      { ttlMs: 30_000, now: () => clock },
    ) as Cache
    await cache.read('u1')
    await cache.read('u1')
    expect(fetches).toBe(1)
    clock += 29_000
    await cache.read('u1')
    expect(fetches).toBe(1)
    clock += 2_000
    await cache.read('u1')
    expect(fetches).toBe(2)
    await cache.read('u1', { force: true })
    expect(fetches).toBe(3)
    await cache.read('u2')
    expect(fetches).toBe(4)
    cache.invalidate()
    await cache.read('u2')
    expect(fetches).toBe(5)
  })

  test('reads while one is in flight share it', async () => {
    const m = await store()
    let fetches = 0
    const pending: Array<(v: unknown) => void> = []
    const cache = (m.createEraseStatusCache as Fn)(
      () => {
        fetches++
        return new Promise((r) => {
          pending.push(r)
        })
      },
      { ttlMs: 30_000, now: () => 0 },
    ) as Cache
    const a = cache.read('u1')
    const b = cache.read('u1')
    for (const r of pending) r(status())
    await Promise.all([a, b])
    expect(fetches).toBe(1)
  })

  test('the banner and both restore offers read through it; focus and visibility respect it', async () => {
    const b = await bannerCtl()
    const reads: Array<{ force?: boolean }> = []
    const win = new EventTarget()
    const banner = (b.createBannerController as Fn)(
      bannerOpts(
        async (_k, o = {}) => {
          reads.push(o)
          return status({ request: PENDING })
        },
        async () => ({}),
        { win },
      ),
    ) as { attach(): void }
    banner.attach()
    await flush()
    win.dispatchEvent(new Event('focus'))
    await flush()
    // mount and focus go through the cache (not forced)
    expect(reads).toEqual([{ force: false }, { force: false }])
    // the offers read through it, fresh (test/1918-erase-request-r4c.test.tsx, item 1)
    const m = await store()
    expect(typeof m.watchLastExecuted).toBe('function')
  })
})

// ── 12 ─────────────────────────────────────────────────────────────────────────────────────

describe('12. Trash bulk restores: large folders restore in the background and stay listed', () => {
  test('splitRestored and the toast', async () => {
    const m = await summary()
    expect((m.splitRestored as Fn)(['a', 'b', 'c'], [{ complete: true }, { complete: false }, { complete: true }])).toEqual({
      done: ['a', 'c'],
      background: ['b'],
    })
    expect((m.restoreToast as Fn)(3, 0)).toEqual({ title: '3 files restored', description: 'Moved back to your vault' })
    const mixed = (m.restoreToast as Fn)(2, 1) as { title: string; description: string }
    expect(mixed.title).toBe('2 restored; 1 large folder restoring in the background')
    expect(mixed.description).not.toContain('Moved back to your vault')
  })

  test('the Trash page removes only what came back', () => {
    const trash = code('pages/trash.tsx')
    expect(trash).toContain('applyBulkRestore(await restoreInWaves(ids))')
    expect(trash).toContain('const gone = new Set(outcome.done)')
    const all = trash.slice(trash.indexOf('const handleRestoreAll'), trash.indexOf('function buildDetailsMeta'))
    expect(all).not.toContain('setFiles([])')
  })
})

// ── 13 ─────────────────────────────────────────────────────────────────────────────────────

describe('13. after an action the error takes the focus when there is one', () => {
  // Source check (no DOM): the focus moves use refs; the controllers only count the actions.
  test('the restore block and the banner focus the error first', () => {
    expect(code('components/restore-from-erase.tsx')).toContain('if (state.focusTick > 0) (errorRef.current ?? resultRef.current)?.focus()')
    expect(code('components/erase-request-banner.tsx')).toContain('if (state.focusTick > 0) (errorRef.current ?? noteRef.current)?.focus()')
  })
  test('their error lines are focusable alerts', async () => {
    const r = await drawRestore({ offer: 'offer', error: 'x' })
    expect(openTag(r, 'erase-restore-error')).toContain('tabindex="-1"')
    const b = await bannerMod()
    const View = b.EraseRequestBannerView as React.FC<Record<string, unknown>>
    const banner = decode(
      renderToStaticMarkup(React.createElement(View, { card: eraseCard(status({ request: PENDING })), busy: false, note: '', error: 'e', onCancel: () => {} })),
    )
    expect(openTag(banner, 'erase-banner-error')).toContain('tabindex="-1"')
    expect(openTag(banner, 'erase-banner-error')).toContain('role="alert"')
  })
})
