import { describe, expect, test } from 'bun:test'
import {
  isUploadSessionGone,
  runWithSessionReinit,
  UploadRestartFailedError,
} from '../src/lib/upload-session-reinit'

// Task 1589 — the server sweeps a v2 upload session whose lease expired. The
// session's chunk / complete routes then answer 404 (or 400 "upload session is
// not writable: expired"). The web client must drop the dead IndexedDB resume
// entry, re-init ONCE for the same file and upload from chunk 0 — never keep
// offering the dead session, never fall back to the legacy routes.
//
// No mock.module here: the helper takes its effects as callbacks.

/** Shape-compatible with ApiError (status + message + code). */
function httpError(status: number, message = 'x', code?: string) {
  const e = new Error(message) as Error & { status: number; code?: string }
  e.status = status
  e.code = code
  return e
}

describe('isUploadSessionGone', () => {
  test('404 from a session route is a swept session', () => {
    expect(isUploadSessionGone(httpError(404, 'Not found'))).toBe(true)
  })
  test('400 "not writable: expired" is a swept session (message or code)', () => {
    expect(isUploadSessionGone(httpError(400, 'upload session is not writable: expired'))).toBe(true)
    expect(isUploadSessionGone(httpError(400, 'Bad request', 'upload session is not writable: expired'))).toBe(true)
  })
  test('other failures are not', () => {
    expect(isUploadSessionGone(httpError(400, 'upload session is not writable: completed'))).toBe(false)
    expect(isUploadSessionGone(httpError(400, 'chunk index 3 out of range (expected 0..2)'))).toBe(false)
    expect(isUploadSessionGone(httpError(409, 'upload already in progress'))).toBe(false)
    expect(isUploadSessionGone(httpError(0, 'Could not reach the server.'))).toBe(false)
    expect(isUploadSessionGone(httpError(500, 'boom'))).toBe(false)
    expect(isUploadSessionGone(new Error('plain'))).toBe(false)
    expect(isUploadSessionGone(null)).toBe(false)
  })
})

/** A scripted upload: `attempts` answers each attempt() in turn. */
function harness(attempts: Array<() => unknown>, opts: { reinitFails?: unknown; hasSession?: boolean } = {}) {
  const log: string[] = []
  let n = 0
  let session = 'sess-old'
  const run = runWithSessionReinit({
    attempt: async () => {
      log.push(`attempt:${session}`)
      const step = attempts[n++]
      if (!step) throw new Error('unexpected extra attempt')
      return step() as string
    },
    hasSession: () => opts.hasSession ?? true,
    dropResumeEntry: async () => { log.push(`drop:${session}`) },
    reinit: async () => {
      log.push('reinit')
      if (opts.reinitFails !== undefined) throw opts.reinitFails
      session = 'sess-new'
    },
  })
  return { run, log }
}

describe('runWithSessionReinit', () => {
  test('success on the first attempt: no drop, no re-init', async () => {
    const { run, log } = harness([() => 'file'])
    expect(await run).toBe('file')
    expect(log).toEqual(['attempt:sess-old'])
  })

  test('404 → drop the dead resume entry, re-init once, upload again from the start', async () => {
    const { run, log } = harness([
      () => { throw httpError(404, 'Not found') },
      () => 'file',
    ])
    expect(await run).toBe('file')
    expect(log).toEqual(['attempt:sess-old', 'drop:sess-old', 'reinit', 'attempt:sess-new'])
  })

  test('400 "not writable: expired" takes the same path', async () => {
    const { run, log } = harness([
      () => { throw httpError(400, 'upload session is not writable: expired') },
      () => 'file',
    ])
    expect(await run).toBe('file')
    expect(log).toEqual(['attempt:sess-old', 'drop:sess-old', 'reinit', 'attempt:sess-new'])
  })

  test('re-inits only ONCE: a second swept session (re-inited session also swept) drops the new entry and surfaces as UploadRestartFailedError', async () => {
    const second = httpError(404, 'Not found again')
    const { run, log } = harness([
      () => { throw httpError(404) },
      () => { throw second },
    ])
    const err = await run.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UploadRestartFailedError)
    expect((err as UploadRestartFailedError).cause).toBe(second)
    expect((err as Error).message).toMatch(/expired on the server/)
    expect(log).toEqual(['attempt:sess-old', 'drop:sess-old', 'reinit', 'attempt:sess-new', 'drop:sess-new'])
  })

  test('a failed re-init surfaces as UploadRestartFailedError, and the dead entry is already gone', async () => {
    const conflict = httpError(409, 'upload already in progress')
    const { run, log } = harness([() => { throw httpError(404) }], { reinitFails: conflict })
    const err = await run.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UploadRestartFailedError)
    expect((err as UploadRestartFailedError).cause).toBe(conflict)
    expect((err as Error).message).toMatch(/expired on the server/)
    expect(log).toEqual(['attempt:sess-old', 'drop:sess-old', 'reinit'])
  })

  test('non-session errors are rethrown untouched (no drop, no re-init)', async () => {
    for (const e of [httpError(409), httpError(0), httpError(500), httpError(400, 'quota', 'quota_exceeded')]) {
      const { run, log } = harness([() => { throw e }])
      await expect(run).rejects.toBe(e)
      expect(log).toEqual(['attempt:sess-old'])
    }
  })

  test('a v1 upload (no session) never re-inits on 404', async () => {
    const e = httpError(404)
    const { run, log } = harness([() => { throw e }], { hasSession: false })
    await expect(run).rejects.toBe(e)
    expect(log).toEqual(['attempt:sess-old'])
  })

  test('an abort is never turned into a re-init', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const log: string[] = []
    const e = httpError(404)
    const run = runWithSessionReinit({
      attempt: async () => { log.push('attempt'); throw e },
      hasSession: () => true,
      dropResumeEntry: async () => { log.push('drop') },
      reinit: async () => { log.push('reinit') },
      signal: ctrl.signal,
    })
    await expect(run).rejects.toBe(e)
    expect(log).toEqual(['attempt'])
  })
})

describe('userFriendlyError(UploadRestartFailedError)', () => {
  test('shows the honest restart message, not a generic fallback', async () => {
    const { userFriendlyError } = await import('../src/lib/user-friendly-error')
    const msg = userFriendlyError(new UploadRestartFailedError(new Error('409')))
    expect(msg).toBe('This upload expired on the server and could not be restarted. Upload the file again.')
  })
})
