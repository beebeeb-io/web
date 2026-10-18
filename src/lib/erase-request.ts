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
 * Everything here is pure (no React, no `./api` import) so the decisions are unit-tested
 * without a browser; `vault-locked-no-key.tsx` and `erase-request-card.tsx` are thin shells.
 */

export interface EraseRequestView {
  id: string
  requested_at: string
  due_at: string
  /** The number the person confirmed. */
  item_count: number
  /** True until the due time; afterwards the files are moving to the trash. */
  cancellable: boolean
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
  const due = str(raw.due_at)
  const count = int(raw.item_count)
  if (!id || !requested || !due || count === null || typeof raw.cancellable !== 'boolean') return null
  return { id, requested_at: requested, due_at: due, item_count: count, cancellable: raw.cancellable }
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
  /** Nothing pending; the account holds `liveItems` (> 0): type the number to ask. */
  | { kind: 'ask'; liveItems: number }
  /** Nothing to erase. */
  | { kind: 'empty' }
  /** Asked; cancellable until `due_at`. */
  | { kind: 'pending'; request: EraseRequestView }
  /** The wait is over: the files are moving to the trash. */
  | { kind: 'moving'; request: EraseRequestView }
  /** Done recently: everything is in the trash. */
  | { kind: 'done'; executed: EraseExecuted }

export function eraseCard(status: EraseStatus): EraseCard {
  if (status.request) {
    return status.request.cancellable
      ? { kind: 'pending', request: status.request }
      : { kind: 'moving', request: status.request }
  }
  if (status.live_items === 0) {
    return status.last_executed ? { kind: 'done', executed: status.last_executed } : { kind: 'empty' }
  }
  return { kind: 'ask', liveItems: status.live_items }
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
}

export type RequestOutcome =
  | { kind: 'requested'; request: EraseRequestView; created: boolean }
  /** The number changed since it was shown (an upload elsewhere); show the new one. */
  | { kind: 'count_changed'; liveItems: number }
  | { kind: 'refused'; message: string }

const GENERIC_REQUEST_FAILURE = 'The erase request did not go through. Nothing was scheduled. Try again.'

export async function requestErase(deps: EraseDeps, confirmCount: number, confirmToken: string): Promise<RequestOutcome> {
  try {
    const body = await deps.create(confirmCount, confirmToken)
    const request = isObj(body) ? parseEraseRequest(body.request) : null
    if (!request) return { kind: 'refused', message: GENERIC_REQUEST_FAILURE }
    return { kind: 'requested', request, created: isObj(body) && body.created === true }
  } catch (e) {
    const err = asError(e)
    if (err.status === 409 && err.code === 'count_mismatch') {
      const live = int(err.details?.live_items)
      if (live !== null) return { kind: 'count_changed', liveItems: live }
    }
    if (err.status === 403 && err.code === 'confirmation_required') {
      return { kind: 'refused', message: 'The password confirmation expired. Try again.' }
    }
    // The server's own message is written for people (rate limit, notice email failed,
    // nothing to erase, frozen account); use it when there is one.
    if (err.status && err.status < 500 && err.message) return { kind: 'refused', message: err.message }
    if (err.status === 503 && err.code === 'erase_notice_failed' && err.message) {
      return { kind: 'refused', message: err.message }
    }
    return { kind: 'refused', message: GENERIC_REQUEST_FAILURE }
  }
}

export type CancelOutcome =
  | { kind: 'cancelled' }
  /** The wait was already over; the files are moving to the trash. */
  | { kind: 'already_started' }
  /** There was nothing to cancel (cancelled elsewhere, e.g. by the email link). */
  | { kind: 'nothing_pending' }
  | { kind: 'failed'; message: string }

export async function cancelErase(deps: EraseDeps): Promise<CancelOutcome> {
  try {
    await deps.cancel()
    return { kind: 'cancelled' }
  } catch (e) {
    const err = asError(e)
    if (err.status === 409 && err.code === 'erase_already_started') return { kind: 'already_started' }
    if (err.status === 404 && err.code === 'no_pending_erase_request') return { kind: 'nothing_pending' }
    return { kind: 'failed', message: 'Cancelling did not go through. Try again, or use the link in the email.' }
  }
}
