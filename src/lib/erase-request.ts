/**
 * Task 1918 [P0] — "Erase all files" on the locked screen is a REQUEST, not a delete.
 *
 * Guus, 2026-10-17: "Files should NEVER go missing" / "the code and all apps should just not
 * delete random stuff". This supersedes the 1704 open-question #7 default the screen was built
 * on ("explicit confirmation, no time delay"): before this, one checkbox and the password just
 * set by email trashed and then permanently erased the whole vault, batch by batch, from the
 * browser (`/files/trash` + `/files/permanent`).
 *
 * Now the browser only files a request with the server (server task 1918,
 * `/api/v1/account/erase-request`):
 *   - the person types the number of items the SERVER says the account holds, and confirms
 *     with their password (step-up); the server checks the number again;
 *   - the server emails the account address at once, with a one-click cancel link;
 *   - after the cooldown (72 h, server-side) every file and folder moves to the TRASH, where
 *     the normal retention applies. Nothing in this flow deletes anything;
 *   - until then any signed-in session (and this screen) can cancel it.
 *
 * Round 3, Guus 2026-10-18: "Mm erase all files then requires email verify", and how:
 * "Verify link + 72 h". A new request waits for the owner's click on the emailed verification
 * link (`/erase-request/verify`); only then does the 72-hour countdown start. Unconfirmed after
 * 24 hours, it expires. The card shows "check your email to confirm", then the due time and
 * Cancel, or that the confirmation link expired.
 *
 * Round 4 (server#232 / web#174 review): cancel works until the move has STARTED (a request
 * past its due time on a frozen account stays cancellable); the owner can restore everything one
 * erase moved in one action ("Restore everything from the erase on <date>", server-side and
 * batched); a status read never overwrites a newer action's state; the typed number accepts only
 * real thousands grouping.
 *
 * Everything here is pure (no React, no `./api` import) so the decisions are unit-tested
 * without a browser; `vault-locked-no-key.tsx` and `erase-request-card.tsx` are thin shells.
 */

export interface EraseRequestView {
  id: string
  requested_at: string
  /** `null` until the owner confirmed by email; then the confirmation + 72 h. */
  due_at: string | null
  /** The number the person confirmed. */
  item_count: number
  /**
   * True until the executor has STARTED moving files (round 4: even past the due time, e.g. while
   * the account is frozen); afterwards the files are moving to the trash.
   */
  cancellable: boolean
  /** The owner clicked the emailed verification link (round 3). */
  verified: boolean
  /** Until when the verification link works; `null` once verified. */
  verify_expires_at: string | null
}

/** A request that expired because nobody confirmed it by email (round 3). */
export interface EraseExpired {
  id: string
  expired_at: string
}

/** "Restore everything from the erase" (round 4): the server restores it in batches. */
export interface EraseRestore {
  state: 'running' | 'done'
  requested_at: string | null
  rows_restored: number
  finished_at: string | null
}

export interface EraseExecuted {
  id: string
  executed_at: string
  items_trashed: number
  /** The trash time every row of this erase carries (round 4; `null` from an older server). */
  trashed_at: string | null
  /** `trashed_at` + the trash retention: true for every row (round 4). */
  restorable_until: string | null
  /** Rows of this erase still in the trash; `null` from an older server (no restore offer then). */
  in_trash: number | null
  restore: EraseRestore | null
}

export interface EraseStatus {
  request: EraseRequestView | null
  /** Live files and folders the account holds right now (what the person types). */
  live_items: number
  cooldown_hours: number
  trash_retention_days: number
  last_executed: EraseExecuted | null
  /** The last request that expired unconfirmed, within the last day (round 3). */
  last_expired: EraseExpired | null
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function parseEraseRequest(raw: unknown): EraseRequestView | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  const requested = str(raw.requested_at)
  const due = raw.due_at === null || raw.due_at === undefined ? null : str(raw.due_at)
  const count = int(raw.item_count)
  if (!id || !requested || count === null || typeof raw.cancellable !== 'boolean') return null
  if (raw.due_at !== null && raw.due_at !== undefined && !due) return null
  // A server from before round 3 sends no `verified`: its requests had a due time at once.
  const verified = typeof raw.verified === 'boolean' ? raw.verified : due !== null
  // A confirmed request always has a due time; an unconfirmed one never does.
  if (verified !== (due !== null)) return null
  const verifyUntil = raw.verify_expires_at === null || raw.verify_expires_at === undefined ? null : str(raw.verify_expires_at)
  return {
    id,
    requested_at: requested,
    due_at: due,
    item_count: count,
    cancellable: raw.cancellable,
    verified,
    verify_expires_at: verifyUntil,
  }
}

function parseExpired(raw: unknown): EraseExpired | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  const at = str(raw.expired_at)
  return id && at ? { id, expired_at: at } : null
}

export function parseRestore(raw: unknown): EraseRestore | null {
  if (!isObj(raw)) return null
  const state = raw.state === 'running' || raw.state === 'done' ? raw.state : null
  const rows = int(raw.rows_restored)
  if (!state || rows === null) return null
  return {
    state,
    requested_at: str(raw.requested_at),
    rows_restored: rows,
    finished_at: str(raw.finished_at),
  }
}

function parseExecuted(raw: unknown): EraseExecuted | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  const at = str(raw.executed_at)
  const n = int(raw.items_trashed)
  if (!id || !at || n === null) return null
  return {
    id,
    executed_at: at,
    items_trashed: n,
    trashed_at: str(raw.trashed_at),
    restorable_until: str(raw.restorable_until),
    in_trash: int(raw.in_trash),
    restore: parseRestore(raw.restore),
  }
}

/** `GET /api/v1/account/erase-request`, read defensively. `null` = not a status we understand. */
export function parseEraseStatus(raw: unknown): EraseStatus | null {
  if (!isObj(raw)) return null
  const live = int(raw.live_items)
  const cooldown = int(raw.cooldown_hours)
  const retention = int(raw.trash_retention_days)
  if (live === null || cooldown === null || retention === null) return null
  const request = raw.request === null || raw.request === undefined ? null : parseEraseRequest(raw.request)
  if (raw.request && !request) return null
  return {
    request,
    live_items: live,
    cooldown_hours: cooldown,
    trash_retention_days: retention,
    last_executed: parseExecuted(raw.last_executed),
    last_expired: parseExpired(raw.last_expired),
  }
}

/**
 * The number as typed: digits, or digits in real thousands groups with ONE kind of separator
 * (comma, dot, space, apostrophe, no-break space): "1240", "1,240", "1.240", "1 240", "1'240".
 * Round 4 (web#174 review): anything else is `null`, including decimals and loose groupings
 * ("12.40", "1,2,4,0", "1.5", "1,24", "1,240.5", "1.240,000"), so the typed number is the shown
 * number and nothing else.
 */
const GROUPED_COUNT = /^\d{1,3}([,. '\u00a0\u202f])\d{3}(?:\1\d{3})*$/

export function parseTypedCount(typed: string): number | null {
  const t = typed.trim()
  let digits: string
  if (/^\d+$/.test(t)) digits = t
  else if (GROUPED_COUNT.test(t)) digits = t.replace(/[,. '\u00a0\u202f]/g, '')
  else return null
  if (digits.length > 12) return null
  return Number(digits)
}

/** The erase button is enabled only when this is true. */
export function typedCountMatches(typed: string, liveItems: number): boolean {
  return liveItems > 0 && parseTypedCount(typed) === liveItems
}

export function itemsLabel(n: number): string {
  return n === 1 ? '1 item' : `${n} items`
}

/** A due time people read: "Wednesday 21 October 2026, 14:05 CEST" (their own time zone). */
export function formatDue(iso: string, opts: { locale?: string; timeZone?: string } = {}): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(opts.locale ?? 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: opts.timeZone,
  }).format(d)
}

/**
 * A day people read, without the time: "Sunday 18 October 2026" (their own time zone), the way the
 * emails write it.
 */
export function formatEraseDate(iso: string, opts: { locale?: string; timeZone?: string } = {}): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const parts = new Intl.DateTimeFormat(opts.locale ?? 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: opts.timeZone,
  }).formatToParts(d)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`
}

/** What the erase card shows. */
export type EraseCard =
  /**
   * Nothing pending; the account holds `liveItems` (> 0): type the number to ask. `expiredAt`:
   * the last request lapsed because nobody confirmed it by email (round 3).
   */
  | { kind: 'ask'; liveItems: number; expiredAt: string | null }
  /** Nothing to erase. */
  | { kind: 'empty' }
  /** Asked, waiting for the owner's click on the emailed verification link (round 3). */
  | { kind: 'awaiting'; request: EraseRequestView }
  /**
   * Confirmed by email; cancellable until the move starts (round 4: also past `due_at`, e.g. on a
   * frozen account, until the executor has begun).
   */
  | { kind: 'pending'; request: EraseRequestView }
  /** The wait is over: the files are moving to the trash. */
  | { kind: 'moving'; request: EraseRequestView }
  /** Done recently: everything is in the trash. */
  | { kind: 'done'; executed: EraseExecuted }

export function eraseCard(status: EraseStatus): EraseCard {
  if (status.request) {
    if (!status.request.verified) return { kind: 'awaiting', request: status.request }
    return status.request.cancellable
      ? { kind: 'pending', request: status.request }
      : { kind: 'moving', request: status.request }
  }
  if (status.live_items === 0) {
    return status.last_executed ? { kind: 'done', executed: status.last_executed } : { kind: 'empty' }
  }
  return { kind: 'ask', liveItems: status.live_items, expiredAt: status.last_expired?.expired_at ?? null }
}

/** The error shape the shared `request()` client throws (`ApiError`), read structurally. */
export interface ErrorLike {
  status?: number
  code?: string
  message?: string
  details?: Record<string, unknown>
}

function asError(e: unknown): ErrorLike {
  return isObj(e) ? (e as ErrorLike) : {}
}

export interface EraseDeps {
  /** `POST /api/v1/account/erase-request` with `X-Confirm-Token`. */
  create: (confirmCount: number, confirmToken: string) => Promise<unknown>
  /** `POST /api/v1/account/erase-request/cancel`. */
  cancel: () => Promise<unknown>
  /** `GET /api/v1/account/erase-request`: asked when a POST's outcome is unknown. */
  status: () => Promise<unknown>
}

/**
 * Did the server ANSWER with a refusal (so nothing changed)? A 4xx is a decision; so is the
 * typed 503 `erase_notice_failed` (the server cancelled the request itself). Anything else (no
 * response at all, a 5xx, a proxy page, a body we could not read) is an UNKNOWN outcome: the
 * request may have been stored. Round 2, web#174 review: never say "not scheduled" then.
 */
function isDefiniteRefusal(err: ErrorLike): boolean {
  if (typeof err.status !== 'number') return false
  if (err.status >= 400 && err.status < 500) return true
  return err.status === 503 && err.code === 'erase_notice_failed'
}

/** The pending request as the server holds it now, or `undefined` when it could not be read. */
async function reconcile(deps: EraseDeps): Promise<EraseRequestView | null | undefined> {
  try {
    const status = parseEraseStatus(await deps.status())
    return status ? status.request : undefined
  } catch {
    return undefined
  }
}

export type RequestOutcome =
  /** The server holds the request. `created` is `null` when we learned it from a status read. */
  | { kind: 'requested'; request: EraseRequestView; created: boolean | null }
  /** The number changed since it was shown (an upload elsewhere); show the new one. */
  | { kind: 'count_changed'; liveItems: number }
  /** The server answered no. Nothing was scheduled. */
  | { kind: 'refused'; message: string }
  /** We could not learn what happened. The request may exist; say so, and check again. */
  | { kind: 'unknown'; message: string }
  /**
   * A request was made moments ago and its email is still going out (409
   * `erase_request_in_progress`): it shows here shortly. Round 4: treated like an unknown
   * outcome (keep "Check again" up and look again), not as a refusal.
   */
  | { kind: 'in_progress'; message: string }

export const UNKNOWN_REQUEST_MESSAGE =
  "We couldn't confirm whether it was scheduled. If it was, the account address gets an email with a link to confirm and a link to cancel, and the request shows here within a minute. Check again."

export async function requestErase(deps: EraseDeps, confirmCount: number, confirmToken: string): Promise<RequestOutcome> {
  let ambiguous = false
  try {
    const body = await deps.create(confirmCount, confirmToken)
    const request = isObj(body) ? parseEraseRequest(body.request) : null
    if (request) return { kind: 'requested', request, created: isObj(body) && body.created === true }
    // A success we could not read: the request may well exist.
    ambiguous = true
  } catch (e) {
    const err = asError(e)
    if (err.status === 409 && err.code === 'count_mismatch') {
      const live = int(err.details?.live_items)
      if (live !== null) return { kind: 'count_changed', liveItems: live }
    }
    // Round 4: the POST is sent exactly once (`createEraseRequest` never retries with the spent
    // step-up token), so this 403 is the server refusing THIS attempt, never a retry's answer.
    if (err.status === 403 && err.code === 'confirmation_required') {
      return { kind: 'refused', message: 'The password confirmation expired. Nothing was scheduled. Try again.' }
    }
    if (err.status === 409 && err.code === 'erase_request_in_progress') {
      return {
        kind: 'in_progress',
        message: err.message || 'An erase request was just made and its email is still being sent. Check again in a minute.',
      }
    }
    if (isDefiniteRefusal(err)) {
      // The server's own message is written for people (rate limit, notice email failed,
      // nothing to erase, frozen account, a request already in flight).
      return { kind: 'refused', message: err.message || 'The erase request was refused. Nothing was scheduled.' }
    }
    ambiguous = true
  }
  if (ambiguous) {
    const request = await reconcile(deps)
    if (request) return { kind: 'requested', request, created: null }
  }
  return { kind: 'unknown', message: UNKNOWN_REQUEST_MESSAGE }
}

export type CancelOutcome =
  | { kind: 'cancelled' }
  /** The move has started; the files are going to the trash. */
  | { kind: 'already_started' }
  /**
   * Nothing to cancel, CONFIRMED by a fresh status read: no request pending and the one being
   * cancelled did not run (cancelled elsewhere, e.g. by the email link, or it lapsed).
   */
  | { kind: 'nothing_pending'; status: EraseStatus }
  /** Round 4: the request being cancelled had already run; every file is in the trash. */
  | { kind: 'already_executed'; status: EraseStatus }
  /** The cancel did not reach the server or failed there, and the request is still pending. */
  | { kind: 'still_pending'; request: EraseRequestView; message: string }
  /** We could not learn what happened. */
  | { kind: 'unknown'; message: string }

/** The status as the server holds it now, or `undefined` when it could not be read. */
async function readStatus(deps: EraseDeps): Promise<EraseStatus | undefined> {
  try {
    return parseEraseStatus(await deps.status()) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Round 4 (web#174 review): a cancel that found nothing (404) or whose answer was lost says what
 * the server holds NOW, never "nothing will be moved" on a guess: the request may have run.
 */
function afterCancelMiss(status: EraseStatus | undefined, requestId: string | null): CancelOutcome {
  if (!status) {
    return { kind: 'unknown', message: "We couldn't confirm what happened to the request. Check again, or use the link in the email." }
  }
  if (status.request) {
    return {
      kind: 'still_pending',
      request: status.request,
      message: 'Cancelling did not go through: the request is still pending. Try again, or use the link in the email.',
    }
  }
  if (requestId !== null && status.last_executed?.id === requestId) return { kind: 'already_executed', status }
  return { kind: 'nothing_pending', status }
}

/** `requestId`: the request the screen showed (so a 404 can tell "it ran" from "it is gone"). */
export async function cancelErase(deps: EraseDeps, requestId: string | null = null): Promise<CancelOutcome> {
  try {
    await deps.cancel()
    return { kind: 'cancelled' }
  } catch (e) {
    const err = asError(e)
    if (err.status === 409 && err.code === 'erase_already_started') return { kind: 'already_started' }
    // Any other answer (a 404, or none at all): ask the server what it holds now.
    return afterCancelMiss(await readStatus(deps), requestId)
  }
}

/** The note the screen shows for a cancel outcome (`null`: the outcome carries its own text). */
export function cancelNote(outcome: CancelOutcome): string | null {
  switch (outcome.kind) {
    case 'cancelled':
      return 'Cancelled. Nothing will be moved to the trash.'
    case 'nothing_pending':
      return 'There is no erase request any more, and none ran. Nothing will be moved.'
    case 'already_executed':
      return 'It had already run: every file is in the trash, where it can still be restored.'
    case 'already_started':
      return 'The move to the trash has started, so it can no longer be cancelled. Everything can be restored from the trash.'
    case 'unknown':
      return outcome.message
    default:
      return null
  }
}

/**
 * Round 2 (web#174 review): what a successful POST returned is applied to the shown status at
 * once, so the screen never depends on a refresh that may fail. `null` stays `null`.
 */
export function applyRequest(status: EraseStatus | null, request: EraseRequestView): EraseStatus | null {
  return status ? { ...status, request } : null
}

export function applyCancelled(status: EraseStatus | null): EraseStatus | null {
  return status ? { ...status, request: null } : null
}

/** How the screen keeps the shown status in step with the server while it stays open. */
export interface EraseRefreshPlan {
  /** Refresh every this many ms (a light poll), or never. */
  pollMs: number | null
  /** Refresh once this many ms from now (just after the due time), or never. */
  dueInMs: number | null
}

/** setTimeout's ceiling (2^31 - 1 ms, about 24.8 days); 72 h is far below it. */
const MAX_TIMER_MS = 2_147_483_647
export const ERASE_POLL_MS = 60_000

function msUntil(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : Math.min(Math.max(at - nowMs, 0) + 1_000, MAX_TIMER_MS)
}

export function eraseRefreshPlan(card: EraseCard | null, nowMs: number): EraseRefreshPlan {
  if (card?.kind === 'pending') {
    return { pollMs: ERASE_POLL_MS, dueInMs: msUntil(card.request.due_at, nowMs) }
  }
  // Waiting for the email click: the poll shows the confirmation (made in another tab or on a
  // phone), and the timer shows the expiry when the link stops working (round 3).
  if (card?.kind === 'awaiting') {
    return { pollMs: ERASE_POLL_MS, dueInMs: msUntil(card.request.verify_expires_at, nowMs) }
  }
  if (card?.kind === 'moving') return { pollMs: ERASE_POLL_MS, dueInMs: null }
  return { pollMs: null, dueInMs: null }
}

export interface RefreshHooks {
  /** `window`: its `focus` event refreshes. */
  win: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  /** `document`: `visibilitychange` to visible refreshes. */
  doc: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { visibilityState?: string }
  refresh: () => void
  plan: EraseRefreshPlan
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (id: unknown) => void
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (id: unknown) => void
}

/** Wire the refresh triggers; returns the function that removes them all. */
export function attachEraseRefresh(h: RefreshHooks): () => void {
  const setT = h.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearT = h.clearTimeoutFn ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>))
  const setI = h.setIntervalFn ?? ((fn: () => void, ms: number) => setInterval(fn, ms))
  const clearI = h.clearIntervalFn ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>))
  const onFocus = () => h.refresh()
  const onVisibility = () => {
    if (h.doc.visibilityState === undefined || h.doc.visibilityState === 'visible') h.refresh()
  }
  h.win.addEventListener('focus', onFocus)
  h.doc.addEventListener('visibilitychange', onVisibility)
  const due = h.plan.dueInMs === null ? null : setT(h.refresh, h.plan.dueInMs)
  const poll = h.plan.pollMs === null ? null : setI(h.refresh, h.plan.pollMs)
  return () => {
    h.win.removeEventListener('focus', onFocus)
    h.doc.removeEventListener('visibilitychange', onVisibility)
    if (due !== null) clearT(due)
    if (poll !== null) clearI(poll)
  }
}

// ── Round 4: "Restore everything from the erase" ────────────────────────────────────────────

export interface RestoreDeps {
  /** `POST /api/v1/account/erase-request/{id}/restore`. */
  restore: (requestId: string) => Promise<unknown>
  /** `GET /api/v1/account/erase-request`: asked when the POST's outcome is unknown. */
  status: () => Promise<unknown>
}

/** Poll this often while a restore runs (the server continues about every minute). */
export const RESTORE_POLL_MS = 5_000

export type RestoreOffer =
  /** Nothing to offer (no recent erase, nothing of it left in the trash, or an older server). */
  | 'none'
  /** Something of the erase is still in the trash: offer "Restore everything". */
  | 'offer'
  /** A restore runs: show progress. */
  | 'running'
  /** A restore finished and nothing of the erase is left in the trash. */
  | 'done'

export function restoreOffer(executed: EraseExecuted | null): RestoreOffer {
  if (!executed || executed.in_trash === null) return 'none'
  if (executed.in_trash > 0) return executed.restore?.state === 'running' ? 'running' : 'offer'
  return executed.restore ? 'done' : 'none'
}

export function restoreLabel(executed: Pick<EraseExecuted, 'executed_at'>): string {
  return `Restore everything from the erase on ${formatEraseDate(executed.executed_at)}`
}

export function restoreProgressText(rowsRestored: number, inTrash: number | null): string {
  return inTrash === null ? `${rowsRestored} restored` : `${rowsRestored} restored, ${inTrash} still in the trash`
}

export const RESTORE_DONE_TEXT = 'Everything from the erase is back.'

export type RestoreOutcome =
  /** Everything came back (at once, or the server says so now). */
  | { kind: 'done'; rowsRestored: number }
  /** The server continues in the background. */
  | { kind: 'running'; rowsRestored: number; inTrash: number | null }
  /** The server answered no (unknown erase, not finished yet, …); nothing was restored. */
  | { kind: 'refused'; message: string }
  /** We could not learn whether the restore started. */
  | { kind: 'unknown'; message: string }

function outcomeFrom(restore: EraseRestore | null, inTrash: number | null): RestoreOutcome {
  const rows = restore?.rows_restored ?? 0
  if (inTrash === 0 || (restore?.state === 'done' && inTrash === null)) return { kind: 'done', rowsRestored: rows }
  return { kind: 'running', rowsRestored: rows, inTrash }
}

export async function restoreEverything(deps: RestoreDeps, requestId: string): Promise<RestoreOutcome> {
  try {
    const body = await deps.restore(requestId)
    if (isObj(body)) {
      const restore = parseRestore(body.restore)
      if (restore) return outcomeFrom(restore, int(body.in_trash))
    }
  } catch (e) {
    const err = asError(e)
    if (err.status === 404 && err.code === 'erase_request_not_found') {
      return {
        kind: 'refused',
        message: "We couldn't find that erase any more, so nothing was restored. What is still in the trash can be restored from Trash.",
      }
    }
    if (err.status === 409 && err.code === 'erase_not_finished') {
      return { kind: 'refused', message: 'The erase is still running. Restore everything once it has finished.' }
    }
    if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
      return { kind: 'refused', message: err.message || 'The restore was refused. Nothing was restored.' }
    }
  }
  // No answer we could read: ask the server what it holds now.
  try {
    const status = parseEraseStatus(await deps.status())
    const executed = status?.last_executed
    if (executed && executed.id === requestId && executed.restore) return outcomeFrom(executed.restore, executed.in_trash)
  } catch {
    // fall through to unknown
  }
  return { kind: 'unknown', message: "We couldn't confirm whether the restore started. Check again." }
}

// ── Round 4: a status read never overwrites a newer action's state ─────────────────────────

/**
 * Sequencing for status reads (web#174 review): `begin()` numbers a read, `isLatest(n)` says
 * whether its answer may still be applied, and `supersede()` marks every read started before a
 * newer action (a POST whose answer was just applied) as stale.
 */
export interface LatestGate {
  begin(): number
  isLatest(n: number): boolean
  supersede(): void
}

export function createLatestGate(): LatestGate {
  let seq = 0
  return {
    begin: () => ++seq,
    isLatest: (n) => n === seq,
    supersede: () => {
      seq += 1
    },
  }
}

/** After an unknown outcome the screen looks again once, this much later. */
export const FOLLOW_UP_MS = 10_000

/**
 * "Check again" stays until the request shows up or the follow-up read ran (round 4): a status
 * read that finds nothing yet, right after the unknown outcome, must not hide it.
 */
export function keepCheckAgain(shown: boolean, status: EraseStatus, followUp: boolean): boolean {
  return shown && !followUp && status.request === null
}
