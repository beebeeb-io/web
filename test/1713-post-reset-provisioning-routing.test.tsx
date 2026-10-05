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

async function renderProvisionBranch(opts: { marker?: boolean } = {}): Promise<string> {
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
      onTryPreviousPassword?: () => void
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
        onTryPreviousPassword: () => {},
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

describe('task 1713 FIX B: post-login provisioning defers to the post-reset marker', () => {
  test('marker present → the locked no-key surface (with the exits) renders, NOT device setup', async () => {
    const html = await renderProvisionBranch({ marker: true })
    // The honest locked-state surface (1704 slice 2), not 'Set up this device':
    expect(html).toContain('Vault locked')
    expect(html).toContain('Unlock with recovery phrase')
    // The self-service exits ARE reachable from the post-login state:
    expect(html).toContain('Cancel subscription')
    expect(html).toContain('Delete all data')
    expect(html).toContain('Delete account')
    // NOT the bare provisioning screen:
    expect(html).not.toContain('Set up this device')
  })

  test('the locked surface\'s phrase CTA targets the canonical /recover-with-phrase re-wrap ceremony', async () => {
    const html = await renderProvisionBranch({ marker: true })
    expect(html).toContain('href="/recover-with-phrase"')
  })

  test('no marker → device setup, UNTOUCHED (fresh device on a normal login)', async () => {
    const html = await renderProvisionBranch({})
    expect(html).toContain('Set up this device')
    expect(html).not.toContain('Cancel subscription')
    expect(html).not.toContain('Delete all data')
    expect(html).not.toContain('Vault locked')
  })
})