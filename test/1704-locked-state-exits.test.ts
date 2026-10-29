import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

/**
 * Task 1704 SLICE 2 — locked-state self-service exits: the pure logic that
 * the honest "Vault locked (no vault key)" surface is built from.
 *
 * Governing spec: decisions/2026-10-02-vault-key-password-recovery-and-admin-
 * reset-policy.md — Amendment + Decision 4 + the §6 exits table. A user who
 * just completed the email password reset (SLICE 1, /set-password) holds a
 * FRESH account credential but no vault key: the device's wrapped vault can
 * never open under the new password. This slice routes that state to an
 * honest locked-state surface (instead of VaultUnlock's dead-end password
 * form) with re-entry via the 12-word phrase and self-service exits.
 *
 * This suite covers the pieces that are testable WITHOUT a browser harness
 * (this repo has no jsdom/@testing-library — see test/1471's header note):
 *   1. the post-reset lock marker + the locked-vault surface decision
 *      (the "routing brain" factored into a pure function, mirroring
 *      shouldReconcileLock() in impersonation-context.tsx);
 *   2. (task 1918: the "delete all data" wipe orchestration this file used to
 *      pin was removed; the erase is a server-side request now, tested in
 *      test/1918-erase-request.test.tsx.)
 * Component copy, confirmation gates, and click wiring are pinned in
 * test/1704-vault-locked-no-key.test.tsx; the browser rung is lead-gated
 * and stays OPEN.
 */

// ── sessionStorage stub ──────────────────────────────────────────────────────
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
}

const originalSessionStorage = (globalThis as Record<string, unknown>).sessionStorage
let storage: MemoryStorage
beforeEach(() => {
  storage = new MemoryStorage()
  ;(globalThis as Record<string, unknown>).sessionStorage = storage
})
afterEach(() => {
  ;(globalThis as Record<string, unknown>).sessionStorage = originalSessionStorage
})

// ── 1. The routing brain ─────────────────────────────────────────────────────

describe('post-reset lock marker (task 1704 SLICE 2)', () => {
  test('markPasswordResetCompleted sets the marker; isPostResetLockedDevice reads it', async () => {
    const { markPasswordResetCompleted, isPostResetLockedDevice, POST_RESET_LOCK_KEY } =
      await import('../src/lib/post-reset-lock')
    expect(isPostResetLockedDevice()).toBe(false)
    markPasswordResetCompleted()
    expect(storage.getItem(POST_RESET_LOCK_KEY)).not.toBeNull()
    expect(isPostResetLockedDevice()).toBe(true)
  })

  test('clearPostResetLock removes it again (the escape hatch / unlock cleanup)', async () => {
    const {
      markPasswordResetCompleted,
      clearPostResetLock,
      isPostResetLockedDevice,
    } = await import('../src/lib/post-reset-lock')
    markPasswordResetCompleted()
    expect(isPostResetLockedDevice()).toBe(true)
    clearPostResetLock()
    expect(isPostResetLockedDevice()).toBe(false)
  })

  test('absent storage never throws and reads false (privacy modes, non-DOM)', async () => {
    ;(globalThis as Record<string, unknown>).sessionStorage = undefined
    const { isPostResetLockedDevice, markPasswordResetCompleted } = await import(
      '../src/lib/post-reset-lock'
    )
    expect(() => markPasswordResetCompleted()).not.toThrow()
    expect(isPostResetLockedDevice()).toBe(false)
  })

  test('a value left by something else counts only when it is the real marker value', async () => {
    const { POST_RESET_LOCK_KEY, isPostResetLockedDevice } = await import(
      '../src/lib/post-reset-lock'
    )
    storage.setItem(POST_RESET_LOCK_KEY, 'garbage')
    expect(isPostResetLockedDevice()).toBe(false)
  })
})

describe('resolveLockedVaultSurface() — the ProtectedRoute decision, pure', () => {
  test('impersonation wins FIRST: 1693 semantics preserved even with a reset marker', async () => {
    const { resolveLockedVaultSurface } = await import('../src/lib/post-reset-lock')
    expect(
      resolveLockedVaultSurface({ impersonating: true, postResetMarker: true, unlockFormRequested: false }),
    ).toBe('impersonated')
  })

  test('post-reset marker (no dismiss) → the honest no-key surface, NOT the password form', async () => {
    const { resolveLockedVaultSurface } = await import('../src/lib/post-reset-lock')
    expect(
      resolveLockedVaultSurface({ impersonating: false, postResetMarker: true, unlockFormRequested: false }),
    ).toBe('no_key')
  })

  test('escape hatch (unlockFormRequested) → the normal VaultUnlock password form', async () => {
    const { resolveLockedVaultSurface } = await import('../src/lib/post-reset-lock')
    expect(
      resolveLockedVaultSurface({ impersonating: false, postResetMarker: true, unlockFormRequested: true }),
    ).toBe('unlock_form')
  })

  test('no marker → the normal VaultUnlock password form (normal users untouched)', async () => {
    const { resolveLockedVaultSurface } = await import('../src/lib/post-reset-lock')
    expect(
      resolveLockedVaultSurface({ impersonating: false, postResetMarker: false, unlockFormRequested: false }),
    ).toBe('unlock_form')
  })
})

// ── 2. (removed by task 1918) ────────────────────────────────────────────────
//
// The "Delete all data" wipe orchestration this section pinned (`planFileWipe`,
// `executeDeleteAllData`: trash, then `/files/permanent` per 500 ids, one step-up
// token per batch) is GONE. Guus, 2026-10-17: "Files should NEVER go missing" /
// "the code and all apps should just not delete random stuff" — superseding the
// 1704 open-question #7 default ("explicit confirmation, no time delay"). The
// locked screen now files a server-side erase request (72 h, email with a cancel
// link, then the files move to the TRASH). Its tests: test/1918-erase-request.test.tsx.
