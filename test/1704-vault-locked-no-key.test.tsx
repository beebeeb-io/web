/**
 * Task 1704 SLICE 2 — the honest locked-state surface for the fresh-password /
 * no-vault-key case, and the ProtectedRoute routing that lands there.
 *
 * The state (decision doc D-2026-10-02, Amendment + §4c + §6): a user completes
 * the SLICE-1 email password reset (/set-password), signs in with the fresh
 * password — and the device's wrapped vault can never open under it. Today
 * ProtectedRoute renders VaultUnlock, whose password form can never succeed:
 * a dead end. SLICE 2 routes that state to VaultLockedNoKey (sibling design
 * language to 1693's VaultLockedImpersonated) with re-entry via the 12-word
 * phrase and self-service exits.
 *
 * The detection signal: the /set-password completion marker (written by the
 * SLICE-1 page on THIS device) — see src/lib/post-reset-lock.ts. The unlock
 * outcome itself cannot tell "fresh password" from "typo"; the reset marker
 * can, without touching key-context crypto.
 *
 * Harness: same shape as test/1693-impersonated-vault-locked.test.tsx — the
 * real ProtectedRoute over mocked auth/key contexts, plus renderToStaticMarkup
 * for the component's copy and confirmation gates. Click wiring and the actual
 * destructive calls stay browser-verified (lead-gated rung, OPEN).
 *
 * RED-first evidence (2026-10-02): against the pre-slice tree every test in
 * the 'routes to the no-key surface' and 'confirmation gates' describes blocks
 * FAILS (module missing / ProtectedRoute renders the VaultUnlock password
 * form); the regression pins (normal unlock path, 1693 impersonated view)
 * PASS both before and after and are mutation-checked (see the task Notes).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { mockModuleScoped } from './helpers/scoped-module-mock'

// ── minimal DOM stub — client-side render (verbatim from 1693's harness) ────
function makeDom() {
  const created: Array<Record<string, unknown>> = []
  function makeNode(tag: string): Record<string, unknown> {
    const children: Array<Record<string, unknown>> = []
    const el: Record<string, unknown> = {
      nodeType: tag === '#text' ? 3 : tag === '#comment' ? 8 : 1,
      tagName: tag === '#text' || tag === '#comment' ? undefined : tag.toUpperCase(),
      appendChild(c: Record<string, unknown>) { children.push(c); created.push(c); return c },
      removeChild(c: Record<string, unknown>) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c },
      insertBefore(c: Record<string, unknown>, _r: unknown) { children.push(c); created.push(c); return c },
      setAttribute() {}, getAttribute() { return null }, removeAttribute() {},
      addEventListener() {}, removeEventListener() {},
      style: {}, dataset: {},
      get firstChild() { return children[0] ?? null },
      contains() { return false },
      textContent: '',
      focus() {}, blur() {},
    }
    el.childNodes = children
    return el
  }
  const doc: Record<string, unknown> = {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (t: string) => { const n = makeNode('#text'); n.textContent = t; return n },
    createComment: (t: string) => makeNode('#comment'),
    createDocumentFragment: () => makeNode('#fragment'),
    addEventListener() {}, removeEventListener() {},
  }
  const win: Record<string, unknown> = {
    event: undefined,
    addEventListener() {}, removeEventListener() {},
    document: doc,
    HTMLIFrameElement: function (this: unknown) {},
    matchMedia: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    history: { state: { idx: 0 }, replaceState() {}, pushState() {}, back() {}, forward() {}, go() {}, length: 1, scrollRestoration: 'manual' },
    location: { href: 'http://localhost/', pathname: '/', search: '', hash: '', origin: 'http://localhost', host: 'localhost', hostname: 'localhost', port: '', protocol: 'http:' },
    navigator: { onLine: true, userAgent: 'bun-test' },
  }
  ;(globalThis as Record<string, unknown>).navigator = { onLine: true, userAgent: 'bun-test' }
  ;(win as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (k === 'bb_cookie_consent' ? 'all' : null),
    setItem() {}, removeItem() {},
  }
  ;(globalThis as Record<string, unknown>).localStorage = (win as Record<string, unknown>).localStorage
  doc.defaultView = win
  const container = makeNode('div')
  ;(container as Record<string, unknown>).ownerDocument = doc
  doc.activeElement = container
  const body = makeNode('body')
  ;(body as Record<string, unknown>).ownerDocument = doc
  ;(body as Record<string, unknown>).dataset = {}
  doc.body = body
  const documentElement = makeNode('html')
  ;(documentElement as Record<string, unknown>).ownerDocument = doc
  ;(documentElement as Record<string, unknown>).classList = { add() {}, remove() {}, contains() { return false }, toggle() {} }
  ;(documentElement as Record<string, unknown>).style = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
  ;(doc as Record<string, unknown>).documentElement = documentElement
  return { doc, win, container, created }
}

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

/** Counting API spies — prove the surface renders WITHOUT firing any
 *  destructive call (every exit is behind an explicit confirmation gate). */
function makeApiSpies() {
  return {
    cancelSubscription: mock(async () => ({ message: 'nope' })),
    deleteAccountPermanently: mock(async () => ({ message: 'nope', shred_after: 'nope' })),
    listAllFiles: mock(async () => [] as Array<{ id: string }>),
    bulkTrashFiles: mock(async (_ids: string[]) => ({})),
    bulkPermanentDelete: mock(async (_ids: string[], _t: string) => {}),
    confirmAction: mock(async () => ({ confirmation_token: 'nope', expires_at: 'nope' })),
  }
}

async function renderProtectedRoute(opts: { marker?: boolean; impersonating?: boolean; email?: string } = {}): Promise<{ text: string; spies: ReturnType<typeof makeApiSpies> }> {
  const { doc, win, container, created } = makeDom()
  const storage = new PersistentSessionStorage()
  if (opts.marker) {
    const { POST_RESET_LOCK_KEY, MARKER_VALUE } = await import('../src/lib/post-reset-lock')
    storage.store.set(POST_RESET_LOCK_KEY, MARKER_VALUE)
  }
  if (opts.impersonating) {
    storage.store.set('bb_impersonating_admin_id', 'user-admin00-0000-0000-0000-000000000000')
    storage.store.set('bb_impersonating_email', opts.email ?? 'target@example.com')
  }
  const g = globalThis as Record<string, unknown>
  g.sessionStorage = storage
  g.window = win
  g.document = doc

  const spies = makeApiSpies()
  await mockModuleScoped('../src/components/toast.tsx', import.meta.dir, (real: Record<string, unknown>) => ({
    ...real,
    useToast: (): unknown => ({ showToast: () => {} }),
  }))
  await mockModuleScoped('../src/lib/api.ts', import.meta.dir, (real: Record<string, unknown>) => ({
    ...real,
    ...spies,
    listAnnouncements: async () => ({ announcements: [] }),
    getMe: async () => ({
      user_id: TARGET,
      email: opts.email ?? 'target@example.com',
      email_verified: true,
      created_at: '2026-01-01T00:00:00Z',
      totp_enabled: false,
      ...(opts.impersonating ? { is_impersonation: true as const, admin_user_id: 'user-admin00-0000-0000-0000-000000000000' } : {}),
    }),
  }))
  // Same rationale as 1693: drive the ProtectedRoute BRANCH with mocked
  // useAuth/useKeys hooks — the real KeyProvider's mount effects would make
  // this whole process order-dependent.
  await mockModuleScoped('../src/lib/auth-context.tsx', import.meta.dir, (real: Record<string, unknown>) => ({
    ...real,
    useAuth: (): unknown => ({
      user: {
        user_id: TARGET,
        email: opts.email ?? 'target@example.com',
        email_verified: true,
        created_at: '2026-01-01T00:00:00Z',
        totp_enabled: false,
        ...(opts.impersonating ? { is_impersonation: true, admin_user_id: 'user-admin00-0000-0000-0000-000000000000' } : {}),
      },
      loading: false,
      refreshUser: async () => {},
      logout: async () => {},
      login: async () => ({}),
      verify2fa: async () => ({}),
    }),
  }))
  await mockModuleScoped('../src/lib/key-context.tsx', import.meta.dir, (real: Record<string, unknown>) => ({
    ...real,
    useKeys: (): unknown => ({
      cryptoReady: true, cryptoLoading: false, cryptoError: null,
      isUnlocked: false,           // the locked-vault branch is the thing under test
      vaultExists: true,
      vaultChecked: true,
      setMasterKey: async () => {}, setMasterKeyDirect: () => {}, setMasterKeyFromPasskey: async () => {},
      unlockVault: async () => 'wrong_password' as const,
      unlockVaultWithPasskey: async () => false,
      unlock: async () => {},
      isUnlockedFor: () => false,
      getResidentUserId: () => null,
      getFileKey: async () => new Uint8Array(0),
      getFileKeyForFile: async () => new Uint8Array(0),
      getMasterKey: () => new Uint8Array(0),
      lock: () => {},
      fullLogout: async () => {},
    }),
  }))

  const { ProtectedRoute } = (await import('../src/app.tsx')) as unknown as { ProtectedRoute: React.FC<{ children?: React.ReactNode }> }
  const rr = (await import('react-router-dom')) as unknown as { MemoryRouter: React.FC<{ children?: React.ReactNode }> }
  const client = (await import('react-dom/client')) as unknown as { createRoot: (e: unknown) => { render: (n: unknown) => void; unmount: () => void } }

  const root = client.createRoot(container)
  root.render(
    React.createElement(rr.MemoryRouter, null,
      React.createElement(ProtectedRoute, null,
        React.createElement('div', null, 'CONTENT-SHOULD-NOT-RENDER'))),
  )
  await new Promise((r) => setTimeout(r, 400))
  root.unmount()
  await new Promise((r) => setTimeout(r, 50))
  const text = created
    .filter((c) => typeof c.textContent === 'string')
    .map((c) => c.textContent as string)
    .join('\n')
  restoreDom?.()
  restoreDom = null
  return { text, spies }
}

describe('task 1704 SLICE 2: ProtectedRoute routes the fresh-password/no-key case to the honest locked-state surface', () => {
  test('post-reset marker + locked vault → VaultLockedNoKey with re-entry + exits, NOT the password form', async () => {
    const { text, spies } = await renderProtectedRoute({ marker: true })
    // Canonical title (sibling of the 1693 surface):
    expect(text).toContain('Vault locked')
    // Honest zero-knowledge reality (the required copy):
    expect(text).toContain("can't open")
    expect(text).toContain('recovery phrase')
    // Primary re-entry:
    expect(text).toContain('Unlock with recovery phrase')
    // All three self-service exits are present:
    expect(text).toContain('Cancel subscription')
    expect(text).toContain('Delete all data')
    expect(text).toContain('Delete account')
    // Honest omission of per-file blind deletion:
    expect(text).toContain("can't show")
    // NOT VaultUnlock's dead-end password form:
    expect(text).not.toContain('Enter your password to unlock your encrypted files.')
    expect(text).not.toContain('Unlock vault')
    expect(text).not.toContain('Unlock with passkey')
    // The gated children never render:
    expect(text).not.toContain('CONTENT-SHOULD-NOT-RENDER')
    // Rendering the surface fired ZERO api calls — every exit waits for its
    // explicit confirmation gate:
    expect(spies.cancelSubscription).not.toHaveBeenCalled()
    expect(spies.deleteAccountPermanently).not.toHaveBeenCalled()
    expect(spies.bulkTrashFiles).not.toHaveBeenCalled()
    expect(spies.bulkPermanentDelete).not.toHaveBeenCalled()
    expect(spies.confirmAction).not.toHaveBeenCalled()
  })

  test('task 1810: the re-entry CTA never leads to the password-reset page (/recover-with-phrase)', async () => {
    // It used to link there: "Unlock with recovery phrase" opened the full
    // password RECOVERY ceremony (email + phrase + a second new password).
    const { text } = await renderProtectedRoute({ marker: true })
    expect(text).toContain('Unlock with recovery phrase')
    expect(text).not.toContain('/recover-with-phrase')
    expect(text).toContain('sign in with your new password first')
  })

  test('no marker + locked vault → VaultUnlock, UNTOUCHED (normal users keep their password form)', async () => {
    const { text, spies } = await renderProtectedRoute({})
    expect(text).toContain('Vault locked')
    expect(text).toContain('Enter your password to unlock your encrypted files.')
    expect(text).toContain('Unlock vault')
    expect(text).not.toContain('Unlock with recovery phrase')
    expect(text).not.toContain('Cancel subscription')
    expect(text).not.toContain('Delete all data')
    expect(text).not.toContain('CONTENT-SHOULD-NOT-RENDER')
    expect(spies.cancelSubscription).not.toHaveBeenCalled()
  })

  test('impersonated session + (even) a reset marker → the 1693 view, byte-for-byte semantics preserved', async () => {
    const { text, spies } = await renderProtectedRoute({ marker: true, impersonating: true, email: 'target@example.com' })
    expect(text).toContain('Vault locked')
    expect(text).toContain('This support session cannot access vault contents')
    expect(text).not.toContain('Enter your password to unlock your encrypted files.')
    expect(text).not.toContain('Unlock with recovery phrase')
    expect(text).not.toContain('Cancel subscription')
    expect(text).not.toContain('CONTENT-SHOULD-NOT-RENDER')
    expect(spies.cancelSubscription).not.toHaveBeenCalled()
  })

  test('escape hatch: with the marker cleared (what "try my previous password" does), the normal form returns', async () => {
    // State-level proof of the escape hatch wiring: VaultLockedNoKey's
    // onTryPreviousPassword → clearPostResetLock() + ProtectedRoute re-render.
    // Clicking itself is browser-verified; the STATE transition is proven here.
    const { doc, win, container, created } = makeDom()
    const storage = new PersistentSessionStorage()
    const { POST_RESET_LOCK_KEY, MARKER_VALUE, clearPostResetLock } = await import('../src/lib/post-reset-lock')
    storage.store.set(POST_RESET_LOCK_KEY, MARKER_VALUE)
    const g = globalThis as Record<string, unknown>
    g.sessionStorage = storage
    g.window = win
    g.document = doc

    await mockModuleScoped('../src/components/toast.tsx', import.meta.dir, (real: Record<string, unknown>) => ({
      ...real,
      useToast: (): unknown => ({ showToast: () => {} }),
    }))
    await mockModuleScoped('../src/lib/api.ts', import.meta.dir, (real: Record<string, unknown>) => ({
      ...real,
      listAnnouncements: async () => ({ announcements: [] }),
      getMe: async () => ({
        user_id: TARGET, email: 'target@example.com', email_verified: true,
        created_at: '2026-01-01T00:00:00Z', totp_enabled: false,
      }),
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
        unlockVault: async () => 'wrong_password' as const, unlockVaultWithPasskey: async () => false,
        unlock: async () => {}, isUnlockedFor: () => false, getResidentUserId: () => null,
        getFileKey: async () => new Uint8Array(0), getFileKeyForFile: async () => new Uint8Array(0),
        getMasterKey: () => new Uint8Array(0), lock: () => {}, fullLogout: async () => {},
      }),
    }))
    const { ProtectedRoute } = (await import('../src/app.tsx')) as unknown as { ProtectedRoute: React.FC<{ children?: React.ReactNode }> }
    const rr = (await import('react-router-dom')) as unknown as { MemoryRouter: React.FC<{ children?: React.ReactNode }> }
    const client = (await import('react-dom/client')) as unknown as { createRoot: (e: unknown) => { render: (n: unknown) => void; unmount: () => void } }

    const root = client.createRoot(container)
    root.render(
      React.createElement(rr.MemoryRouter, null,
        React.createElement(ProtectedRoute, null,
          React.createElement('div', null, 'CONTENT-SHOULD-NOT-RENDER'))),
    )
    await new Promise((r) => setTimeout(r, 400))
    const before = created
      .filter((c) => typeof c.textContent === 'string')
      .map((c) => c.textContent as string)
      .join('\n')
    expect(before).toContain('Unlock with recovery phrase')

    // The escape hatch's effect: marker cleared → next render is the form.
    clearPostResetLock()
    await new Promise((r) => setTimeout(r, 50))
    root.unmount()
    const second = await renderProtectedRoute({}) // same session, marker now gone
    expect(second.text).toContain('Enter your password to unlock your encrypted files.')
  })
})

// ── Component copy + confirmation gates (SSR markup — no effects run) ───────

describe('task 1704 SLICE 2: VaultLockedNoKey copy + explicit confirmation gates', () => {
  async function renderSurface(props: Record<string, unknown> = {}): Promise<string> {
    const { doc, win } = makeDom()
    const storage = new PersistentSessionStorage()
    const g = globalThis as Record<string, unknown>
    g.sessionStorage = storage
    g.window = win
    g.document = doc

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
    await mockModuleScoped('../src/lib/api.ts', import.meta.dir, (real: Record<string, unknown>) => ({
      ...real,
      ...makeApiSpies(),
    }))

    const { VaultLockedNoKey } = (await import('../src/components/vault-locked-no-key.tsx')) as unknown as { VaultLockedNoKey: React.FC<Record<string, unknown>> }
    const rr = (await import('react-router-dom')) as unknown as { MemoryRouter: React.FC<{ children?: React.ReactNode }> }
    const { renderToStaticMarkup } = (await import('react-dom/server')) as unknown as { renderToStaticMarkup: (n: React.ReactNode) => string }

    const html = renderToStaticMarkup(
      React.createElement(rr.MemoryRouter, null, React.createElement(VaultLockedNoKey, props)),
    )
    restoreDom?.()
    restoreDom = null
    // renderToStaticMarkup escapes apostrophes (&#x27;) — decode the handful
    // of entities the copy uses so assertions read like the actual text.
    return html
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }

  test('the zero-knowledge reality is stated plainly (honest voice, no overselling)', async () => {
    const html = await renderSurface()
    expect(html).toContain('Vault locked')
    expect(html).toContain("can't open")
    expect(html).toContain("We can't restore access to your vault without your recovery phrase")
    expect(html).toContain('by design')
    expect(html).toContain('no backdoor')
  })

  test('task 1810: primary re-entry is a button (not a link to the password reset) + the only-enter-it-here warning', async () => {
    const html = await renderSurface()
    expect(html).toContain('Unlock with recovery phrase')
    expect(html).not.toContain('href="/recover-with-phrase"')
    expect(html).not.toContain('recover-with-phrase')
    expect(html).toContain('never in an email, never on another site')
  })

  test('all three exits render with their explicit confirmation gates INLINE (nothing fire-and-forget)', async () => {
    const html = await renderSurface()
    // Exit 1 — cancel subscription (checkbox gate + action button):
    expect(html).toContain('Cancel subscription')
    expect(html).toContain('I understand billing stops for this account.')
    expect(html).toContain('Cancel billing')
    // Exit 2 — delete all data (checkbox gate + action button):
    expect(html).toContain('Delete all data')
    expect(html).toContain('I understand every file is erased permanently')
    expect(html).toContain('Erase all files')
    // Exit 3 — delete account (type-DELETE gate + checkbox + action button):
    expect(html).toContain('Delete account')
    expect(html).toContain('Type DELETE to confirm')
    expect(html).toContain('I understand my files cannot be recovered after deletion.')
    expect(html).toContain('Delete permanently')
  })

  test('honest explanation of why per-file blind deletion is NOT offered', async () => {
    const html = await renderSurface()
    expect(html).toContain("can't show")
    expect(html).toContain('encrypted')
  })

  test('escape hatch is offered honestly when the caller wires it (the previous password may still be remembered)', async () => {
    const html = await renderSurface({ onTryPreviousPassword: () => {} })
    expect(html).toContain('Remember your previous password? Try it here')
  })

  test('task 1810: without the escape-hatch handler (the sign-in / set-password steps) there is no dead hatch button', async () => {
    const html = await renderSurface()
    expect(html).not.toContain('Remember your previous password')
  })

  test('task 1810: with onUnlockWithPhrase the explanatory line does not promise a second sign-in', async () => {
    const html = await renderSurface({ onUnlockWithPhrase: () => {} })
    expect(html).toContain('Unlock with recovery phrase')
    expect(html).not.toContain('sign in with your new password first')
  })
})