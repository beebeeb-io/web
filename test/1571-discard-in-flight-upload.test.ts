import { describe, expect, test } from 'bun:test'
import { discardInFlightUpload } from '../src/lib/upload-discard'

/** A controllable promise the test can settle on its own schedule, to
 *  simulate a save (init/upload) that is genuinely still in flight when
 *  Discard is pressed. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('discardInFlightUpload (task 1571 web PR #106, Codex P1)', () => {
  // The core regression: web PR #106's Codex P1. Pre-fix, `abortInFlightSave`
  // called `abandonUpload` immediately (fire-and-forget) on discard, racing
  // whatever save work — most dangerously `initUpload` — was still in
  // flight. If that save's own promise (standing in for `initUpload`'s
  // fetch) settles LATE ("init resolving after the discard"), abandon must
  // still not have fired before that — otherwise it can see
  // `is_uploading = false`, no-op, and the late init then wedges the file.
  test('waits for the in-flight save to settle before calling abandon, even when it settles LATE — init resolving after the discard', async () => {
    const order: string[] = []
    const controller = new AbortController()
    const pending = deferred<void>()
    const abandon = async (fileId: string) => {
      order.push(`abandon:${fileId}`)
    }

    const discardPromise = discardInFlightUpload(controller, 'file-1', pending.promise, abandon)

    // Abort must happen synchronously...
    expect(controller.signal.aborted).toBe(true)

    // ...but abandon must NOT fire while the save is still pending, no
    // matter how many microtask turns pass.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual([])

    // NOW simulate init's response landing, well after the discard.
    order.push('init-settles-late')
    pending.resolve()

    await discardPromise
    expect(order).toEqual(['init-settles-late', 'abandon:file-1'])
  })

  test('still calls abandon when the pending save rejects (e.g. its own AbortError) — outcome does not matter, only that it settled', async () => {
    const order: string[] = []
    const controller = new AbortController()
    const pending = deferred<void>()
    const abandon = async (fileId: string) => {
      order.push(`abandon:${fileId}`)
    }

    const discardPromise = discardInFlightUpload(controller, 'file-2', pending.promise, abandon)
    await Promise.resolve()
    expect(order).toEqual([])

    pending.reject(new DOMException('Upload cancelled', 'AbortError'))
    await discardPromise
    expect(order).toEqual(['abandon:file-2'])
  })

  test('is a no-op when there is no file id — nothing was ever registered for this save', async () => {
    const controller = new AbortController()
    let called = false
    await discardInFlightUpload(controller, null, null, async () => {
      called = true
    })
    expect(called).toBe(false)
    expect(controller.signal.aborted).toBe(true)
  })

  test('calls abandon immediately when there is no pending save to wait for', async () => {
    const controller = new AbortController()
    let calledWith: string | null = null
    await discardInFlightUpload(controller, 'file-3', null, async (fileId) => {
      calledWith = fileId
    })
    expect(calledWith).toBe('file-3')
  })

  test('swallows an abandon failure — best-effort only, never throws', async () => {
    const controller = new AbortController()
    await expect(
      discardInFlightUpload(controller, 'file-4', null, async () => {
        throw new Error('network down')
      }),
    ).resolves.toBeUndefined()
  })
})
