import { describe, test, expect, beforeEach } from 'bun:test'

/**
 * Task 1693 (Part A) — the impersonated session must NOT lock the admin's
 * own resident key.
 *
 * The reconciliation effect (key-context.tsx) auto-lock()s the resident key
 * whenever its bound user_id differs from the authenticated user. Under an
 * impersonation (support view) session, the TARGET account's id resolves
 * while the ADMIN's key is still resident — a mismatch by design — so the
 * effect clobbered the admin's unlock the moment the impersonated session
 * landed (the "impersonation werkt niet" end state, ruling
 * D-2026-10-02: option A, everything unchanged except an explicit locked
 * state).
 *
 * The effect's decision is factored into `shouldReconcileLock()`
 * (impersonation-context.tsx) — key-context.tsx is a React component and
 * this repo's `bun test` harness has no React-rendering harness for the
 * provider chain with a settled auth+key state (see 1531-account-binding's
 * header for the standing pattern). These tests pin the decision function:
 *
 *   (1) impersonating + settled mismatch → NOT lock (the fix)
 *   (2) non-impersonated identity change → STILL lock (unchanged behavior)
 * plus the boot guards that must keep working for both.
 *
 * `isImpersonationSessionActive()` is tested against the same sessionStorage
 * markers the redemption page / provider write — RED-first note: both tests
 * were seen red against the pre-fix code (shouldReconcileLock did not exist;
 * the effect locked unconditionally on mismatch; the probe function did not
 * exist).
 */

const ADMIN = 'user-admin00-0000-0000-0000-000000000000'
const TARGET = 'user-target0-0000-0000-0000-000000000000'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.get(k) ?? null }
  setItem(k: string, v: string): void { this.store.set(k, v) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
}

function settled(): Parameters<typeof shouldReconcileLock>[0] {
  return {
    vaultChecked: true,
    authLoading: false,
    hasResidentKey: true,
    residentUserId: ADMIN,
    currentUserId: TARGET,
    impersonating: false,
  }
}

const { shouldReconcileLock, isImpersonationSessionActive } = await import('../src/lib/impersonation-context')

describe('task 1693 Part A: shouldReconcileLock — the reconciliation effect decision', () => {
  test('RED (the clobber): impersonating session + settled mismatch → do NOT lock the admin key', () => {
    expect(
      shouldReconcileLock({ ...settled(), impersonating: true }),
    ).toBe(false)
  })

  test('non-impersonated identity switch + mismatch → STILL lock (task 1531/1534 behavior unchanged)', () => {
    expect(
      shouldReconcileLock({ ...settled(), impersonating: false }),
    ).toBe(true)
  })

  test('boot unsettled (authLoading) → never judge, impersonating or not', () => {
    expect(
      shouldReconcileLock({ ...settled(), impersonating: true, authLoading: true }),
    ).toBe(false)
    expect(
      shouldReconcileLock({ ...settled(), impersonating: false, authLoading: true }),
    ).toBe(false)
  })

  test('boot unsettled (vault not checked) → never judge', () => {
    expect(
      shouldReconcileLock({ ...settled(), impersonating: false, vaultChecked: false }),
    ).toBe(false)
  })

  test('ids match → nothing to protect (both real, both null)', () => {
    expect(
      shouldReconcileLock({ ...settled(), impersonating: false, residentUserId: TARGET, currentUserId: TARGET }),
    ).toBe(false)
    expect(
      shouldReconcileLock({ ...settled(), impersonating: true, residentUserId: null, currentUserId: null }),
    ).toBe(false)
  })

  test('no key resident → nothing to misattribute, even on mismatch', () => {
    expect(
      shouldReconcileLock({ ...settled(), impersonating: false, hasResidentKey: false }),
    ).toBe(false)
  })
})

describe('task 1693 Part A: isImpersonationSessionActive — sessionStorage markers', () => {
  let storage: MemoryStorage
  beforeEach(() => {
    storage = new MemoryStorage()
    ;(globalThis as { sessionStorage?: unknown }).sessionStorage = storage
  })

  test('no markers → not impersonating', () => {
    expect(isImpersonationSessionActive()).toBe(false)
  })

  test('bb_impersonating_email marker (written by /auth/impersonate redeem + provider) → impersonating', () => {
    storage.setItem('bb_impersonating_email', 'target@example.com')
    expect(isImpersonationSessionActive()).toBe(true)
  })

  test('bb_impersonating_admin_id marker alone (direct-link boot before /me resolves) → impersonating', () => {
    storage.setItem('bb_impersonating_admin_id', ADMIN)
    expect(isImpersonationSessionActive()).toBe(true)
  })

  test('both markers cleared on stop-impersonation → not impersonating again', () => {
    storage.setItem('bb_impersonating_email', 'target@example.com')
    storage.setItem('bb_impersonating_admin_id', ADMIN)
    expect(isImpersonationSessionActive()).toBe(true)
    storage.removeItem('bb_impersonating_email')
    storage.removeItem('bb_impersonating_admin_id')
    expect(isImpersonationSessionActive()).toBe(false)
  })
})
