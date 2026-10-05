/**
 * Task 1713 FIX B — post-login routing priority: the /set-password completion
 * marker must outrank the bare "Set up this device" provisioning screen.
 *
 * The 1704 slice-2 browser walk (task 1713, lead evidence 2026-10-02) found
 * that after an email-reset sign-in the pre-existing 'Set up this device'
 * screen renders even though the marker
 * beebeeb_password_reset_completed='set_password_completed' IS stamped in
 * sessionStorage — the provisioning branch in login.tsx never consulted
 * post-reset-lock.ts. For a user who lost their phrase that screen is a
 * dead end: its only way forward is the phrase, and the 1704 slice-2
 * self-service exits (cancel billing / delete all data / delete account)
 * are unreachable.
 *
 * TASK 1810 SUPERSEDES THE ROUTING BELOW: the locked surface's phrase button opened
 * /recover-with-phrase, i.e. the password RESET, so "unlock with recovery phrase"
 * looped back to a reset. The branch now always shows the phrase screen (the
 * password is already proven) and offers the exits behind "I've lost my recovery
 * phrase". Original 1713 text follows.
 *
 * The fix: the needs-provision branch of the Login page, factored into an
 * exported `LoginProvisionBranch` component so this pin can render it
 * directly, checks `isPostResetLockedDevice()` and renders VaultLockedNoKey
 * instead of DeviceProvision when the marker is present. The surface's
 * phrase CTA already targets /recover-with-phrase — the same re-wrap
 * ceremony DeviceProvision's phrase entry provides (verify phrase →
 * re-wrap the vault under the new password).
 *
 * Pins:
 *   1. marker present → the locked no-key surface (with the exits), NOT
 *      device setup;
 *   2. its phrase CTA targets the canonical /recover-with-phrase route;
 *   3. no marker → device setup, byte-for-byte unchanged (fresh device on a
 *      normal login);
 *   4. the 1693 impersonation pin (test/1704-vault-locked-no-key.test.tsx,
 *      'impersonated session + (even) a reset marker → the 1693 view') keeps
 *      passing — ProtectedRoute's impersonation-first priority is NOT
 *      duplicated or weakened here; this branch is only reachable after a
 *      fresh OPAQUE sign-in on the login form.
 *
 * Harness: renderToStaticMarkup over the real branch component with the
 * auth/key contexts mocked (pattern: test/1704-vault-locked-no-key.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const TARGET = 'user-target0-0000-0000-0000-000000000000'

class PersistentSessionStorage {
  store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.get(k) ?? null }
  setItem(k: string, v: string): void { this.store.set(k, v) }
  removeItem(k: string): void { this.store.delete(k) }
}

let restoreDom: (() => void) | null = null
beforeEach(() => {
  restoreDom = () => {
    const g = globalThis as Record<string, unknown>
    delete g.window
    delete g.document
    delete g.sessionStorage
    delete g.localStorage
    delete g.navigator
  }
})
afterEach(() => {
  restoreDom?.()
  restoreDom = null
})

async function renderProvisionBranch(opts: { marker?: boolean; staleVault?: boolean } = {}): Promise<string> {
  const storage = new PersistentSessionStorage()
  if (opts.marker) {
    const { POST_RESET_LOCK_KEY, MARKER_VALUE } = await import('../src/lib/post-reset-lock')
    storage.store.set(POST_RESET_LOCK_KEY, MARKER_VALUE)
  }
  const g = globalThis as Record<string, unknown>
  g.sessionStorage = storage
  // Minimal DOM/global stubs for module import + SSR (pattern: 1704 harness).
  const win: Record<string, unknown> = {
    addEventListener() {}, removeEventListener() {},
    location: { href: 'http://localhost/', pathname: '/', search: '', hash: '', origin: 'http://localhost' },
    navigator: { onLine: true, userAgent: 'bun-test' },
    matchMedia: () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {} }),
    history: { state: { idx: 0 }, replaceState() {}, pushState() {} },
  }
  ;(win as Record<string, unknown>).localStorage = {
    getItem: () => null, setItem() {}, removeItem() {},
  }
  g.window = win
  g.navigator = { onLine: true, userAgent: 'bun-test' }
  g.localStorage = (win as Record<string, unknown>).localStorage
  g.document = {
    createElement: () => ({}),
    createTextNode: () => ({}),
    addEventListener() {}, removeEventListener() {},
  }

  // VaultLockedNoKey reads useAuth().logout; DeviceProvision reads
  // useAuth().user and useKeys().setMasterKey/setMasterKeyDirect.
  // StepUpAuth (rendered by VaultLockedNoKey even when closed) calls
  // useToast() — mocked like the 1704 harness does for the same reason.
  await mockModuleScoped('../src/components/toast.tsx', import.meta.dir, (real: Record<string, unknown>) => ({
    ...real,
    useToast: (): unknown => ({ showToast: () => {} }),
  }))
  await mockModuleScoped('../src/lib/auth-context.tsx', import.meta.dir, (real: Record<string, unknown>) => ({
    ...real,
    useAuth: (): unknown => ({
      user: { user_id: TARGET, email: 'target@example.com', email_verified: true, created_at: '2026-01-01T00:00:00Z', totp_enabled: false },
      loading: false, refreshUser: async () => {}, logout: async () => {},
      login: async () => ({}), verify2fa: async () => ({}),
    }),
  }))
  await mockModuleScoped('../src/lib/key-context.tsx', import.meta.dir, (real: Record<string, unknown>) => ({
    ...real,
    useKeys: (): unknown => ({
      cryptoReady: true, cryptoLoading: false, cryptoError: null,
      isUnlocked: false, vaultExists: true, vaultChecked: true,
      setMasterKey: async () => {}, setMasterKeyDirect: () => {}, setMasterKeyFromPasskey: async () => {},
      unlockVault: async () => 'needs_provisioning' as const,
      unlockVaultWithPasskey: async () => false,
      unlock: async () => {}, isUnlockedFor: () => false, getResidentUserId: () => null,
      getFileKey: async () => new Uint8Array(0), getFileKeyForFile: async () => new Uint8Array(0),
      getMasterKey: () => new Uint8Array(0), lock: () => {}, fullLogout: async () => {},
    }),
  }))

  const { LoginProvisionBranch } = (await import('../src/pages/login')) as unknown as {
    LoginProvisionBranch: React.FC<{
      password: string
      authMethod: 'opaque' | 'passkey'
      email?: string
      onProvisioned: () => void
      staleVault?: boolean
    }>
  }
  const rr = (await import('react-router-dom')) as unknown as { MemoryRouter: React.FC<{ children?: React.ReactNode }> }
  const { renderToStaticMarkup } = (await import('react-dom/server')) as unknown as {
    renderToStaticMarkup: (n: React.ReactNode) => string
  }

  const html = renderToStaticMarkup(
    React.createElement(
      rr.MemoryRouter,
      null,
      React.createElement(LoginProvisionBranch, {
        password: '',
        authMethod: 'opaque',
        email: 'target@example.com',
        onProvisioned: () => {},
        staleVault: opts.staleVault,
      }),
    ),
  )
  restoreDom?.()
  restoreDom = null
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

describe('task 1713 FIX B / task 1810: post-login provisioning is the phrase screen, with the exits one click away', () => {
  test('marker present → the 12-word phrase screen (the password is already proven), NOT the locked surface', async () => {
    const html = await renderProvisionBranch({ marker: true })
    expect(html).toContain('Set up this device')
    expect(html).toContain('Recovery word 1')
    expect(html).toContain('Restore vault')
    // The way out for a person who lost the phrase is one click away:
    expect(html).toContain("I've lost my recovery phrase")
    // The exits themselves open on that click, not before:
    expect(html).not.toContain('Delete all data')
    expect(html).not.toContain('Vault locked')
  })

  test('task 1810: nothing on this screen leads to the password-reset page', async () => {
    const html = await renderProvisionBranch({ marker: true })
    expect(html).not.toContain('/recover-with-phrase')
  })

  test('task 1810: a stale vault that was just removed is explained above the phrase boxes', async () => {
    const html = await renderProvisionBranch({ marker: true, staleVault: true })
    expect(html).toContain('sealed under your previous password, so it was removed')
    expect(html).toContain('Recovery word 1')
  })

  test('task 1810 round 2 (Codex P1): a stale vault removed at sign-in offers the lost-phrase exits even WITHOUT the tab marker', async () => {
    // A reset/change made in another tab or on another device leaves no marker here.
    const html = await renderProvisionBranch({ staleVault: true })
    expect(html).toContain("I've lost my recovery phrase")
    expect(html).toContain('sealed under your previous password, so it was removed')
  })

  test('no marker → device setup, UNTOUCHED (fresh device on a normal login)', async () => {
    const html = await renderProvisionBranch({})
    expect(html).toContain('Set up this device')
    expect(html).not.toContain("I've lost my recovery phrase")
    expect(html).not.toContain('Cancel subscription')
    expect(html).not.toContain('Vault locked')
  })
})
