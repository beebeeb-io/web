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
  /** True until the due time; afterwards the files are moving to the trash. */
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

export interface EraseExecuted {
  id: string
  executed_at: string
  items_trashed: number
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

function parseExecuted(raw: unknown): EraseExecuted | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  const at = str(raw.executed_at)
  const n = int(raw.items_trashed)
  return id && at && n !== null ? { id, executed_at: at, items_trashed: n } : null
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
 * The number as typed: digits, optionally grouped with spaces, commas, dots or apostrophes
 * ("1240", "1,240", "1.240", "1 240"). Anything else (signs, letters, decimals) is `null`.
 */
export function parseTypedCount(typed: string): number | null {
  const compact = typed.trim().replace(/[\s,.'  ]/g, '')
  if (!/^\d{1,12}$/.test(compact)) return null
  return Number(compact)
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
  /** Confirmed by email; cancellable until `due_at`. */
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

export const UNKNOWN_REQUEST_MESSAGE =
  'We could not confirm whether the request went through. If it did, the account address gets an email with a link to cancel, and it shows here within a minute. Check again.'

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
    if (err.status === 403 && err.code === 'confirmation_required') {
      return { kind: 'refused', message: 'The password confirmation expired. Nothing was scheduled. Try again.' }
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
  /** The wait was already over; the files are moving to the trash. */
  | { kind: 'already_started' }
  /** There was nothing to cancel (cancelled elsewhere, e.g. by the email link). */
  | { kind: 'nothing_pending' }
  /** The cancel did not reach the server or failed there, and the request is still pending. */
  | { kind: 'still_pending'; request: EraseRequestView; message: string }
  /** We could not learn what happened. */
  | { kind: 'unknown'; message: string }

export async function cancelErase(deps: EraseDeps): Promise<CancelOutcome> {
  try {
    await deps.cancel()
    return { kind: 'cancelled' }
  } catch (e) {
    const err = asError(e)
    if (err.status === 409 && err.code === 'erase_already_started') return { kind: 'already_started' }
    if (err.status === 404 && err.code === 'no_pending_erase_request') return { kind: 'nothing_pending' }
    // Unknown outcome: ask the server what it holds now instead of guessing.
    const request = await reconcile(deps)
    if (request === null) return { kind: 'nothing_pending' }
    if (request) {
      return {
        kind: 'still_pending',
        request,
        message: 'Cancelling did not go through: the request is still pending. Try again, or use the link in the email.',
      }
    }
    return {
      kind: 'unknown',
      message: 'We could not confirm the cancel. Check again, or use the link in the email.',
    }
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
