// ─── Swept upload sessions (task 1589) ──────────────
// A v2 upload session holds a server-side lease. When the client goes quiet
// for longer than the lease (a closed tab, laptop sleep, the "paused uploads
// → Resume" banner clicked an hour later), the server's sweeper abandons the
// session: its chunk and complete routes then answer 404, or — for a session
// row that survives with `status = 'expired'` — 400 "upload session is not
// writable: expired".
//
// Such a session is dead for good. The client must not keep offering it for
// resume, and must never fall back to the legacy `/files/{id}/…` routes
// (they would write against whatever upload the file holds NOW). Instead it
// drops its IndexedDB resume entry and re-inits ONCE with the same file id,
// then uploads from the start.
//
// The re-init is bounded to ONE attempt per resume click, never a retry
// loop: if the freshly re-inited session is ALSO swept (a second sleep
// during the restarted transfer, or an unlucky short lease), there is
// nothing left to retry — the dead entry is dropped and the failure
// surfaces the same {@link UploadRestartFailedError} as a failed re-init,
// so the caller's single typed-error branch removes the row with an
// honest message instead of resetting it to a "Queued" state with no
// backing resume entry and no way to actually retry.
//
// Kept free of any `./api` import (duck-typed status) so it is unit-testable
// without bun's process-global `mock.module('./api')` (see task 1590).

/**
 * Thrown when a swept upload session cannot be resumed: the fresh re-init
 * itself failed, or the freshly re-inited session was swept too. Either
 * way the resume attempt is over — the dead resume entry has already been
 * dropped by the time this is thrown, and the caller must remove the row
 * and tell the user to upload the file again, never leave it "Queued".
 */
export class UploadRestartFailedError extends Error {
  readonly cause: unknown
  constructor(cause: unknown) {
    super(
      'This upload expired on the server and could not be restarted. ' +
        'Upload the file again.',
    )
    this.name = 'UploadRestartFailedError'
    this.cause = cause
  }
}

function field(err: unknown, key: string): unknown {
  return typeof err === 'object' && err !== null ? (err as Record<string, unknown>)[key] : undefined
}

const NOT_WRITABLE_EXPIRED = /not writable:\s*expired/i

/**
 * True when `err` says the upload session no longer exists server-side:
 * HTTP 404 from a session route, or HTTP 400 "not writable: expired".
 * Network failures (status 0), 409s, quota errors and every other 400 are
 * NOT a swept session.
 */
export function isUploadSessionGone(err: unknown): boolean {
  const status = field(err, 'status')
  if (status === 404) return true
  if (status !== 400) return false
  const message = field(err, 'message')
  const code = field(err, 'code')
  return (
    (typeof message === 'string' && NOT_WRITABLE_EXPIRED.test(message)) ||
    (typeof code === 'string' && NOT_WRITABLE_EXPIRED.test(code))
  )
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || field(err, 'name') === 'AbortError'
}

export interface SessionReinitOptions<T> {
  /** Transfer every chunk and complete the upload against the current session. */
  attempt: () => Promise<T>
  /** Whether the upload is on a v2 session at all (v1 has no lease). */
  hasSession: () => boolean
  /** Remove the IndexedDB resume entry for the dead session. */
  dropResumeEntry: () => Promise<void>
  /** Init a fresh session for the same file (and persist its resume entry). */
  reinit: () => Promise<void>
  signal?: AbortSignal
}

/**
 * Run `attempt`. If it fails because the v2 session was swept, drop the
 * resume entry, re-init once and run `attempt` again from the start.
 * Bounded to ONE re-init per call — never a retry loop. A second
 * swept-session failure (the re-inited session was swept too) drops the
 * (new) entry and surfaces as {@link UploadRestartFailedError}, exactly
 * like a failed re-init.
 */
export async function runWithSessionReinit<T>(opts: SessionReinitOptions<T>): Promise<T> {
  const { attempt, hasSession, dropResumeEntry, reinit, signal } = opts

  try {
    return await attempt()
  } catch (err) {
    if (isAbort(err, signal) || !hasSession() || !isUploadSessionGone(err)) throw err
  }

  // The session is dead: never offer it for resume again, whatever happens next.
  await dropResumeEntry().catch(() => {})

  try {
    await reinit()
  } catch (err) {
    if (isAbort(err, signal)) throw err
    throw new UploadRestartFailedError(err)
  }

  try {
    return await attempt()
  } catch (err) {
    if (isAbort(err, signal) || !hasSession() || !isUploadSessionGone(err)) throw err
    // The freshly re-inited session was swept too. Bounded to one re-init
    // per resume attempt — do NOT reinit again — so this is terminal
    // exactly like a failed reinit: drop the (new) dead entry and surface
    // the same typed error the caller already maps to a removed row.
    await dropResumeEntry().catch(() => {})
    throw new UploadRestartFailedError(err)
  }
}
